import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';
import { SOCKET_PATH } from './config.js';

interface ApiSocket {
  _buf?: string;
  write(data: string | Uint8Array): number | boolean;
  end?: () => void;
}

export interface ApiRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
  params?: Record<string, string>;
}

export interface ApiResponse {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface ApiDeps {
  getOrchestratorStatus: () => {
    status: string;
    uptime: number;
    startTime: number;
    memory: { used: number; total: number };
    platform: string;
    tasksToday: number;
    successCount: number;
    failedCount: number;
    costToday: number;
  };
  getAgents: () => unknown[];
  addAgent: (agent: { id: string; role: string; model: string; fallbackModel?: string; systemPrompt?: string }) => boolean;
  updateAgent: (id: string, updates: Record<string, unknown>) => boolean;
  removeAgent: (id: string) => boolean;
  renameAgent: (oldId: string, newId: string) => boolean;
  getTasks: () => unknown[];
  getTask: (id: string) => unknown | undefined;
  getConfig: () => unknown;
  updateConfig: (updates: Record<string, unknown>) => void;
  resetConfig: () => void;
  reloadConfig: () => void;
  getLogs: (params: { lines?: number; agent?: string; level?: string; since?: string }) => unknown[];
  getTeamChannel: () => unknown;
  setTeamChannel: (config: unknown) => void;
}

let server: ReturnType<typeof Bun.listen> | null = null;

// Active stream sockets — nhận log mới realtime
const logStreamSockets: Set<ApiSocket> = new Set();

// Max buffer size per connection (1MB)
const MAX_BUFFER_SIZE = 1024 * 1024;

export function startApiServer(deps: ApiDeps): void {
  if (fs.existsSync(SOCKET_PATH)) {
    try {
      fs.unlinkSync(SOCKET_PATH);
      logger.debug({ path: SOCKET_PATH }, 'Removed stale socket file');
    } catch (err) {
      logger.warn({ err, path: SOCKET_PATH }, 'Failed to remove stale socket file');
    }
  }

  fs.mkdirSync(path.dirname(SOCKET_PATH), { recursive: true });

  server = Bun.listen({
    unix: SOCKET_PATH,
    socket: {
      data(socket, data) {
        const apiSocket = socket as ApiSocket;
        
        // Buffer per-connection để xử lý TCP fragmentation
        if (!apiSocket._buf) apiSocket._buf = '';
        apiSocket._buf += data.toString();

        // Prevent buffer overflow from malformed requests
        if (apiSocket._buf.length > MAX_BUFFER_SIZE) {
          logger.warn('API client buffer overflow, closing connection');
          socket.write(JSON.stringify({ ok: false, error: 'BUFFER_OVERFLOW', limit: MAX_BUFFER_SIZE }) + '\n');
          socket.end();
          return;
        }

        // Process tất cả complete JSON lines (newline-delimited)
        const lines: string[] = apiSocket._buf.split('\n');
        // Dòng cuối có thể chưa hoàn chỉnh — giữ lại trong buffer
        apiSocket._buf = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          let req: ApiRequest;
          try {
            req = JSON.parse(trimmed) as ApiRequest;
          } catch (err) {
            socket.write(JSON.stringify({ ok: false, error: 'Invalid JSON' }) + '\n');
            continue;
          }

          // /logs/stream: socket ở lại mở, push log entries realtime
          const [reqPath] = req.path.split('?');
          if (reqPath === '/logs/stream' && req.method === 'GET') {
            logStreamSockets.add(apiSocket);
            socket.write(JSON.stringify({ ok: true, streaming: true }) + '\n');
            return; // không parse thêm từ socket này
          }

          handleRequest(req, deps)
            .then((res) => socket.write(JSON.stringify(res) + '\n'))
            .catch((err) => {
              logger.error({ err }, 'API request error');
              socket.write(JSON.stringify({ ok: false, error: String(err) }) + '\n');
            });
        }
      },
      open(socket) {
        logger.debug('API client connected');
      },
      close(socket) {
        logStreamSockets.delete(socket as ApiSocket);
        logger.debug('API client disconnected');
      },
      error(socket, err) {
        logger.error({ err }, 'API socket error');
      },
    },
  });

  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });

  logger.info({ path: SOCKET_PATH }, 'API server listening on Unix socket');
}

function cleanup(): void {
  if (fs.existsSync(SOCKET_PATH)) {
    try {
      fs.unlinkSync(SOCKET_PATH);
      logger.debug({ path: SOCKET_PATH }, 'Socket file cleaned up');
    } catch (err) {
      // Ignore cleanup errors on exit
    }
  }
}

/** Gọi từ logger để push log entry tới tất cả stream clients. */
export function pushLogToStreams(entry: Record<string, unknown>): void {
  if (logStreamSockets.size === 0) return;
  const line = JSON.stringify(entry) + '\n';
  const toDelete: ApiSocket[] = [];
  
  for (const socket of logStreamSockets) {
    try {
      socket.write(line);
    } catch (err) {
      logger.debug({ err }, 'Failed to write to log stream socket, removing');
      toDelete.push(socket);
    }
  }
  
  // Remove failed sockets
  for (const socket of toDelete) {
    logStreamSockets.delete(socket);
    try {
      socket.end?.();
    } catch {
      // Ignore errors on cleanup
    }
  }
}

export function stopApiServer(): void {
  if (server) {
    server.stop();
    server = null;
    cleanup();
    logger.info('API server stopped');
  }
}

async function handleRequest(req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const { method, body } = req;

  // Parse query string từ path (e.g. /logs?lines=50&agent=nam)
  const [path, qs] = req.path.split('?');
  const params: Record<string, string> = { ...(req.params || {}) };
  if (qs) {
    for (const [k, v] of new URLSearchParams(qs)) {
      params[k] = v;
    }
  }

  try {
    if (path === '/status' && method === 'GET') {
      return { ok: true, data: deps.getOrchestratorStatus() };
    }

    if (path === '/agents' && method === 'GET') {
      return { ok: true, data: deps.getAgents() };
    }

    if (path === '/agents' && method === 'POST') {
      const agent = body as { id: string; role: string; model: string };
      if (!agent?.id || !agent?.role || !agent?.model) {
        return { ok: false, error: 'Missing required fields: id, role, model' };
      }
      const success = deps.addAgent(agent);
      if (!success) {
        return { ok: false, error: `Agent "${agent.id}" đã tồn tại` };
      }
      return { ok: true, data: { id: agent.id } };
    }

    if (path.startsWith('/agents/') && method === 'PUT') {
      const id = path.slice(8);
      const updates = body as Record<string, unknown>;
      const success = deps.updateAgent(id, updates);
      if (!success) {
        return { ok: false, error: `Agent "${id}" không tồn tại` };
      }
      return { ok: true };
    }

    if (path.startsWith('/agents/') && method === 'DELETE') {
      const id = path.slice(8);
      const success = deps.removeAgent(id);
      if (!success) {
        return { ok: false, error: `Agent "${id}" không tồn tại` };
      }
      return { ok: true };
    }

    if (path.startsWith('/agents/') && path.endsWith('/rename') && method === 'POST') {
      const parts = path.split('/');
      const oldId = parts[2];
      const { newId } = body as { newId: string };
      if (!newId) {
        return { ok: false, error: 'Missing newId' };
      }
      const success = deps.renameAgent(oldId, newId);
      if (!success) {
        return { ok: false, error: `Cannot rename agent "${oldId}"` };
      }
      return { ok: true };
    }

    if (path === '/tasks' && method === 'GET') {
      return { ok: true, data: deps.getTasks() };
    }

    if (path.startsWith('/tasks/') && method === 'GET') {
      const id = path.slice(7);
      const task = deps.getTask(id);
      if (!task) {
        return { ok: false, error: `Task "${id}" không tồn tại` };
      }
      return { ok: true, data: task };
    }

    if (path === '/config' && method === 'GET') {
      return { ok: true, data: deps.getConfig() };
    }

    if (path === '/config' && method === 'PUT') {
      deps.updateConfig(body as Record<string, unknown>);
      return { ok: true };
    }

    if (path === '/config/reset' && method === 'POST') {
      deps.resetConfig();
      return { ok: true };
    }

    if (path === '/config/reload' && method === 'POST') {
      deps.reloadConfig();
      return { ok: true };
    }

    if (path === '/logs' && method === 'GET') {
      const logs = deps.getLogs(params);
      return { ok: true, data: logs };
    }

    if (path === '/channel' && method === 'GET') {
      return { ok: true, data: deps.getTeamChannel() };
    }

    if (path === '/channel' && method === 'PUT') {
      deps.setTeamChannel(body);
      return { ok: true };
    }

    return { ok: false, error: `Unknown endpoint: ${method} ${path}` };
  } catch (err) {
    logger.error({ err, method, path }, 'API handler error');
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
