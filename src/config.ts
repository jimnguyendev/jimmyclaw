import os from 'os';
import path from 'path';

import { readEnvFile } from './env.js';

// Read config values from .env (falls back to process.env).
// Secrets are NOT read here — they stay on disk and are loaded only
// where needed (container-runner.ts) to avoid leaking to child processes.
const envConfig = readEnvFile([
  'ASSISTANT_NAME',
  'ASSISTANT_HAS_OWN_NUMBER',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_ONLY',
  'DISCORD_BOT_TOKEN',
  'TEAM_CHANNEL_PLATFORM',
  'INSTANCE_ID',
  'INSTANCE_AGENTS',
]);

export const ASSISTANT_NAME = process.env.ASSISTANT_NAME || envConfig.ASSISTANT_NAME || 'Andy';
export const ASSISTANT_HAS_OWN_NUMBER =
  (process.env.ASSISTANT_HAS_OWN_NUMBER || envConfig.ASSISTANT_HAS_OWN_NUMBER) === 'true';
export const POLL_INTERVAL = 2000;
export const SCHEDULER_POLL_INTERVAL = 60000;

// Absolute paths needed for container mounts.
// When running inside Docker, process.cwd() returns the container path (/app).
// HOST_PROJECT_ROOT overrides this so agent container bind mounts point to the
// actual host filesystem (set via docker-compose.sandbox.yml).
const PROJECT_ROOT = process.env.HOST_PROJECT_ROOT || process.cwd();
const HOME_DIR = process.env.HOME || os.homedir();

// Mount security: allowlist stored OUTSIDE project root, never mounted into containers
export const MOUNT_ALLOWLIST_PATH = path.join(
  HOME_DIR,
  '.config',
  'jimmyclaw',
  'mount-allowlist.json',
);
export const STORE_DIR = path.resolve(PROJECT_ROOT, 'store');
export const GROUPS_DIR = path.resolve(PROJECT_ROOT, 'groups');
export const DATA_DIR = path.resolve(PROJECT_ROOT, 'data');
export const MAIN_GROUP_FOLDER = 'main';
export const SOCKET_PATH = path.join(STORE_DIR, 'jimmyclaw.sock');

export const CONTAINER_IMAGE = process.env.CONTAINER_IMAGE || 'jimmyclaw-agent:latest';
export const CONTAINER_TIMEOUT = parseInt(process.env.CONTAINER_TIMEOUT || '1800000', 10);
export const CONTAINER_MAX_OUTPUT_SIZE = parseInt(
  process.env.CONTAINER_MAX_OUTPUT_SIZE || '10485760',
  10,
); // 10MB default
export const IPC_POLL_INTERVAL = 1000;
export const IDLE_TIMEOUT = parseInt(process.env.IDLE_TIMEOUT || '1800000', 10); // 30min default — how long to keep container alive after last result
export const MAX_CONCURRENT_CONTAINERS = Math.max(
  1,
  parseInt(process.env.MAX_CONCURRENT_CONTAINERS || '5', 10) || 5,
);

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const TRIGGER_PATTERN = new RegExp(`^@${escapeRegex(ASSISTANT_NAME)}\\b`, 'i');

// Timezone for scheduled tasks (cron expressions, etc.)
// Uses system timezone by default
export const TIMEZONE = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;

// Telegram configuration
export const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN || envConfig.TELEGRAM_BOT_TOKEN || '';
export const TELEGRAM_ONLY = (process.env.TELEGRAM_ONLY || envConfig.TELEGRAM_ONLY) === 'true';
export const TELEGRAM_BOT_POOL = (process.env.TELEGRAM_BOT_POOL || '')
  .split(',')
  .map((t) => t.trim())
  .filter(Boolean);

export const SWARM_ENABLED = process.env.SWARM_ENABLED === 'true';
export const SWARM_MAX_PARALLEL_TASKS = parseInt(process.env.SWARM_MAX_PARALLEL_TASKS || '4', 10);
export const SWARM_TASK_TIMEOUT_MS = parseInt(process.env.SWARM_TASK_TIMEOUT_MS || '300000', 10);

// Team channel / multi-instance
export const TEAM_CHANNEL_PLATFORM = (
  process.env.TEAM_CHANNEL_PLATFORM || envConfig.TEAM_CHANNEL_PLATFORM || ''
) as 'discord' | 'telegram' | '';

export const INSTANCE_ID = process.env.INSTANCE_ID || envConfig.INSTANCE_ID || 'default';

export const INSTANCE_AGENTS = (process.env.INSTANCE_AGENTS || envConfig.INSTANCE_AGENTS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export const DISCORD_BOT_TOKEN =
  process.env.DISCORD_BOT_TOKEN || envConfig.DISCORD_BOT_TOKEN || '';
