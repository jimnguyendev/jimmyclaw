import chalk from 'chalk';
import Table from 'cli-table3';
import { client } from '../shared/api-client.js';
import { formatTimestamp, colorByLevel, truncate } from '../shared/formatter.js';

import net from 'net';
import fs from 'fs';
import { SOCKET_PATH } from '../../config.js';

function printLogLine(log: { level?: string; time?: string; msg?: string; agent?: string; raw?: string }) {
  const timestamp = formatTimestamp(log.time || '');
  const level = (log.level || 'info').toLowerCase();
  const levelStr = colorByLevel(level, level.toUpperCase().padEnd(5));
  const agentStr = log.agent ? chalk.cyan(`[${log.agent}]`) : '';
  const message = truncate(log.msg || log.raw || '', 200);
  console.log(`${chalk.gray(timestamp)} ${levelStr} ${agentStr} ${message}`);
}

export async function logsCmd(options: { lines?: string; agent?: string; level?: string; since?: string; follow?: boolean }) {
  const lines = options.lines ? parseInt(options.lines) : 50;
  const agent = options.agent;
  const level = options.level?.toLowerCase();
  const since = options.since;
  const follow = options.follow || false;

  if (!fs.existsSync(SOCKET_PATH)) {
    console.log(chalk.red('● Daemon không chạy'));
    console.log(chalk.gray('  Run `nanoclaw start` để start daemon'));
    process.exit(1);
  }

  try {
    const params: Record<string, string> = { lines: String(lines) };
    if (agent) params.agent = agent;
    if (level) params.level = level;
    if (since) params.since = since;

    // In N dòng lịch sử trước
    const logs = await client.get('/logs?' + new URLSearchParams(params).toString()) as Array<{
      level: string; time: string; msg: string; agent?: string; raw?: string;
    }>;
    for (const log of logs) printLogLine(log);

    if (!follow) return;

    // --follow: mở stream socket và in log mới realtime
    const socket = net.createConnection(SOCKET_PATH);
    let streamStarted = false;

    socket.on('connect', () => {
      socket.write(JSON.stringify({ method: 'GET', path: '/logs/stream' }) + '\n');
    });

    socket.on('data', (data) => {
      for (const line of data.toString().split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (!streamStarted) {
            // Dòng đầu là ACK { ok: true, streaming: true }
            streamStarted = true;
            continue;
          }
          // Filter phía client giống batch
          if (agent && parsed.agent !== agent) continue;
          if (level && (parsed.level || '').toLowerCase() !== level) continue;
          printLogLine(parsed);
        } catch { /* ignore malformed */ }
      }
    });

    socket.on('error', (err) => {
      console.log(chalk.red(`Stream error: ${err.message}`));
      process.exit(1);
    });

    process.on('SIGINT', () => { socket.destroy(); process.exit(0); });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(chalk.red(`Error: ${message}`));
    process.exit(1);
  }
}
