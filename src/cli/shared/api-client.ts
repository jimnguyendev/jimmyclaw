import fs from 'fs';
import net from 'net';
import { SOCKET_PATH } from '../../config.js';
import { logger } from '../../logger.js';

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

export class ApiClient {
  private socketPath: string;

  constructor(socketPath?: string) {
    this.socketPath = socketPath || SOCKET_PATH;
  }

  async request(method: ApiRequest['method'], path: string, body?: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(this.socketPath)) {
        reject(new Error('Daemon không chạy. Dùng: nanoclaw start'));
        return;
      }

      const socket = net.createConnection(this.socketPath);
      let buffer = '';
      let responded = false;

      socket.on('connect', () => {
        const req: ApiRequest = { method, path, body };
        socket.write(JSON.stringify(req) + '\n');
      });

      socket.on('data', (data) => {
        buffer += data.toString();
        
        // Wait for a complete line (ending with \n)
        const newlineIndex = buffer.indexOf('\n');
        if (newlineIndex === -1) {
          // Incomplete line, wait for more data
          return;
        }
        
        const responseLine = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        
        try {
          const res: ApiResponse = JSON.parse(responseLine);
          responded = true;
          socket.destroy();
          if (res.ok) {
            resolve(res.data);
          } else {
            reject(new Error(res.error || 'Unknown error'));
          }
        } catch (err) {
          socket.destroy();
          reject(new Error(`Phản hồi không hợp lệ: ${responseLine}`));
        }
      });

      socket.on('error', (err) => {
        if (!responded) {
          reject(new Error(`Lỗi kết nối: ${err.message}`));
        }
      });

      socket.on('close', () => {
        if (!responded) {
          reject(new Error('Kết nối đóng trước khi nhận phản hồi'));
        }
      });

      socket.setTimeout(5000, () => {
        socket.destroy();
        if (!responded) {
          reject(new Error('Timeout kết nối daemon'));
        }
      });
    });
  }

  async get(path: string): Promise<unknown> {
    return this.request('GET', path);
  }

  async post(path: string, body: unknown): Promise<unknown> {
    return this.request('POST', path, body);
  }

  async put(path: string, body: unknown): Promise<unknown> {
    return this.request('PUT', path, body);
  }

  async delete(path: string): Promise<unknown> {
    return this.request('DELETE', path);
  }

  isDaemonRunning(): boolean {
    return fs.existsSync(this.socketPath);
  }
}

export const client = new ApiClient();
