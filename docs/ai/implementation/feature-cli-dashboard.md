---
phase: implementation
title: CLI Dashboard Implementation
description: Technical implementation guide for the CLI dashboard
---

# Implementation Guide: CLI Dashboard

## Development Setup

**Prerequisites:**
- Bun runtime
- JimmyClaw daemon đang chạy (để test socket API)

**Install dependencies:**
```bash
bun add commander @inquirer/prompts ink react chalk cli-table3
bun add -d @types/react
```

**Run CLI in dev mode:**
```bash
bun run src/cli/index.ts status
bun run src/cli/index.ts          # mở TUI
```

**Build:**
```bash
bun build src/cli/index.ts --outdir dist/cli --target bun
```

---

## Code Structure

```
src/
├── api-server.ts                  # Unix socket API (daemon side)
└── cli/
    ├── index.ts                   # Entry point: route command vs TUI
    ├── shared/
    │   ├── api-client.ts          # Connect Unix socket → request/response
    │   └── formatter.ts           # chalk colors, table rendering, duration format
    ├── commands/
    │   ├── status.ts              # jimmyclaw status
    │   ├── agents.ts              # jimmyclaw agents / agent add|remove|rename|model
    │   ├── tasks.ts               # jimmyclaw tasks
    │   ├── logs.ts                # jimmyclaw logs [--agent] [--level] [--since]
    │   ├── config.ts              # jimmyclaw config show|set|edit|reset|reload
    │   ├── channel.ts             # jimmyclaw channel show|set|test
    │   ├── service.ts             # jimmyclaw start|stop|restart|service install
    │   └── env.ts                 # jimmyclaw env show|set|unset
    ├── prompts/
    │   ├── agent-prompt.ts        # Wizard thêm/sửa agent
    │   └── config-prompt.ts       # Wizard sửa config settings
    └── tui/
        ├── app.tsx                # Root Ink component, keyboard routing
        ├── panels/
        │   ├── AgentsPanel.tsx    # Danh sách agents + status
        │   ├── ActivityPanel.tsx  # Stream log realtime
        │   ├── TasksPanel.tsx     # Pending/processing tasks
        │   └── SystemPanel.tsx    # Uptime, memory, cost, channel info
        └── hooks/
            ├── useAgents.ts       # Poll /agents mỗi 2s
            ├── useTasks.ts        # Poll /tasks mỗi 2s
            └── useLogs.ts         # Stream /logs/stream via socket
```

---

## Implementation Notes

### 1. Unix Socket API (`src/api-server.ts`)

Dùng `Bun.listen` với Unix socket thay vì TCP — không expose port ra ngoài:

```typescript
import { SOCKET_PATH } from './config.js';
import fs from 'fs';

export function startApiServer(deps: ApiDeps) {
  // Cleanup stale socket file nếu daemon crash trước đó
  if (fs.existsSync(SOCKET_PATH)) fs.unlinkSync(SOCKET_PATH);

  const server = Bun.listen({
    unix: SOCKET_PATH,
    socket: {
      async data(socket, data) {
        try {
          const req: ApiRequest = JSON.parse(data.toString());
          const res = await handleRequest(req, deps);
          socket.write(JSON.stringify(res) + '\n');
        } catch (err) {
          socket.write(JSON.stringify({ error: String(err) }) + '\n');
        }
      },
      close() {},
      error(socket, err) {
        logger.error({ err }, 'API socket error');
      }
    }
  });

  // Cleanup khi daemon exit
  process.on('exit', () => fs.existsSync(SOCKET_PATH) && fs.unlinkSync(SOCKET_PATH));
  process.on('SIGINT', () => { fs.existsSync(SOCKET_PATH) && fs.unlinkSync(SOCKET_PATH); process.exit(0); });

  logger.info({ path: SOCKET_PATH }, 'API server listening');
  return server;
}
```

**Request/Response format:**
```typescript
interface ApiRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;        // '/agents', '/config', '/logs', etc.
  body?: unknown;
  params?: Record<string, string>;  // query params
}

interface ApiResponse {
  ok: boolean;
  data?: unknown;
  error?: string;
}
```

### 2. API Client (`src/cli/shared/api-client.ts`)

```typescript
import { SOCKET_PATH } from '../../config.js';
import net from 'net';

export class ApiClient {
  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(SOCKET_PATH)) {
        reject(new Error('Daemon không chạy. Dùng: jimmyclaw start'));
        return;
      }

      const socket = net.createConnection(SOCKET_PATH);
      let buffer = '';

      socket.on('connect', () => {
        socket.write(JSON.stringify({ method, path, body }) + '\n');
      });

      socket.on('data', (data) => {
        buffer += data.toString();
        if (buffer.includes('\n')) {
          const res = JSON.parse(buffer.trim());
          socket.destroy();
          if (res.ok) resolve(res.data);
          else reject(new Error(res.error));
        }
      });

      socket.on('error', reject);
      socket.setTimeout(5000, () => {
        socket.destroy();
        reject(new Error('Timeout kết nối daemon'));
      });
    });
  }

  async get(path: string) { return this.request('GET', path); }
  async post(path: string, body: unknown) { return this.request('POST', path, body); }
  async put(path: string, body: unknown) { return this.request('PUT', path, body); }
  async delete(path: string) { return this.request('DELETE', path); }
}
```

### 3. Entry Point (`src/cli/index.ts`)

```typescript
import { program } from 'commander';

// Nếu không có argument → mở TUI
if (process.argv.length === 2) {
  const { openTui } = await import('./tui/app.js');
  await openTui();
  process.exit(0);
}

// Nếu có argument → parse commands
program.name('jimmyclaw').version('2.0.0').description('JimmyClaw CLI');

program.command('status').option('--json').action(...)
// ... register all commands

program.parse();
```

### 4. Status command (`src/cli/commands/status.ts`)

Output mặc định (human-readable):
```
● JimmyClaw  running  2d 4h 12m
  Channel:  Discord #team-workspace
  Agents:   4 (3 idle, 1 busy)
  Tasks:    47 today  (42 ✓  5 ✗)
  Cost:     $0.12 today
```

Output với `--json`:
```json
{
  "status": "running",
  "uptime": 191520,
  "channel": { "platform": "discord", "channelId": "123" },
  "agents": { "total": 4, "idle": 3, "busy": 1 },
  "tasks": { "today": 47, "success": 42, "failed": 5 },
  "cost": { "today": 0.12 }
}
```

### 5. Agent commands (`src/cli/commands/agents.ts`)

`jimmyclaw agents` — dùng `cli-table3`:
```
┌────────┬────────────┬──────────────────┬────────┬──────────┐
│ ID     │ Role       │ Model            │ Status │ Tasks    │
├────────┼────────────┼──────────────────┼────────┼──────────┤
│ nam    │ leader     │ claude-sonnet    │ idle   │ 120 (98%)│
│ linh   │ researcher │ glm-4.7-flash    │ idle   │ 89  (95%)│
│ duc    │ coder      │ glm-5            │ busy   │ 43  (91%)│
│ trang  │ reviewer   │ glm-4.7-flash    │ idle   │ 31  (97%)│
└────────┴────────────┴──────────────────┴────────┴──────────┘
```

`jimmyclaw agent add` — không có args → trigger `promptNewAgent()`:
```typescript
export async function agentAddCmd(id?: string, role?: string, model?: string) {
  const args = await promptNewAgent({ id, role, model });
  const client = new ApiClient();
  await client.post('/agents', args);
  console.log(chalk.green(`✓ Agent "${args.id}" đã thêm thành công`));
}
```

### 6. Logs streaming (`src/cli/commands/logs.ts`)

```typescript
// Dùng socket stream thay vì poll
const socket = net.createConnection(SOCKET_PATH);
socket.write(JSON.stringify({ method: 'GET', path: '/logs/stream', params: { agent, level, since } }) + '\n');

socket.on('data', (data) => {
  const lines = data.toString().split('\n').filter(Boolean);
  for (const line of lines) {
    const log = JSON.parse(line);
    printLogLine(log);   // chalk color theo level
  }
});

process.on('SIGINT', () => { socket.destroy(); process.exit(0); });
```

### 7. TUI với Ink (`src/cli/tui/app.tsx`)

Ink render React components ra terminal. Layout dùng flexbox giống CSS:

```tsx
import { render, Box, Text, useInput, useApp } from 'ink';

function App() {
  const { exit } = useApp();
  const [focused, setFocused] = useState<'agents' | 'activity' | 'tasks'>('agents');

  useInput((input, key) => {
    if (input === 'q') exit();
    if (key.tab) cycleFocus();
    if (input === 'a') openAddAgentFlow();
  });

  return (
    <Box flexDirection="column" height={process.stdout.rows}>
      {/* Header bar */}
      <Box borderStyle="single" paddingX={1}>
        <Text bold color="cyan">JimmyClaw</Text>
        <Text>  ● Running  </Text>
        <Text dimColor>[q]uit [a]dd [e]dit [r]emove [l]ogs [?]help</Text>
      </Box>

      {/* Main content */}
      <Box flexGrow={1}>
        {/* Left column */}
        <Box flexDirection="column" width="32%" borderStyle="single">
          <AgentsPanel focused={focused === 'agents'} />
          <TasksPanel focused={focused === 'tasks'} />
        </Box>

        {/* Right column */}
        <Box flexDirection="column" flexGrow={1} borderStyle="single">
          <ActivityPanel focused={focused === 'activity'} />
          <SystemPanel />
        </Box>
      </Box>
    </Box>
  );
}

render(<App />);
```

### 8. `package.json` — bin field

```json
{
  "bin": {
    "jimmyclaw": "./dist/cli/index.js"
  },
  "scripts": {
    "build:cli": "bun build src/cli/index.ts --outdir dist/cli --target bun --sourcemap"
  }
}
```

Để dùng globally:
```bash
bun link         # link jimmyclaw vào PATH
# hoặc
npm install -g . # nếu dùng npm
```

---

## Lưu ý khi implement

1. **Socket path** phải nhất quán giữa daemon và CLI — export từ `src/config.ts`
2. **Daemon không chạy** → CLI phải in thông báo rõ ràng, không crash với stack trace
3. **TUI resize** → Ink tự handle `SIGWINCH`, không cần xử lý thủ công
4. **Windows** → Unix socket không hoạt động, cần named pipe — để sau nếu cần
5. **Ink + commander** không conflict — Ink chỉ được import khi không có CLI arguments
