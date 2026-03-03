import chalk from 'chalk';

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

export function colorByLevel(level: string, message: string): string {
  switch (level.toLowerCase()) {
    case 'error':
      return chalk.red(message);
    case 'warn':
      return chalk.yellow(message);
    case 'info':
      return chalk.blue(message);
    case 'debug':
      return chalk.gray(message);
    default:
      return message;
  }
}

export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function statusIcon(status: string): string {
  switch (status) {
    case 'running':
    case 'idle':
      return chalk.green('●');
    case 'busy':
      return chalk.yellow('●');
    case 'stopped':
    case 'offline':
      return chalk.red('○');
    default:
      return '○';
  }
}

export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}
