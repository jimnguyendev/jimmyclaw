import fs from 'fs';
import path from 'path';

import { DATA_DIR } from './config.js';
import { AgentConfig, AgentRole, OrchestratorConfig, TeamChannelConfig, InstanceConfig, DEFAULT_AGENT_CONFIGS } from './orchestrator/types.js';
import { logger } from './logger.js';

export interface SwarmConfigFile {
  leader: AgentConfig;
  workers: AgentConfig[];
  teamChannel?: TeamChannelConfig;
  instance?: InstanceConfig;
  settings: {
    maxParallelTasks: number;
    taskTimeoutMs: number;
    heartbeatIntervalMs: number;
    messageRetentionMs: number;
  };
  costTracking: {
    enabled: boolean;
    models: Record<string, { input: number; output: number }>;
  };
}

const CONFIG_PATH = path.join(DATA_DIR, 'swarm-config.json');
const DEFAULT_CONFIG_PATH = path.join(process.cwd(), 'config', 'agent-swarm.json');

let cachedConfig: SwarmConfigFile | null = null;
let configLock: Promise<void> | null = null;

export function getSwarmConfigPath(): string {
  if (fs.existsSync(CONFIG_PATH)) {
    return CONFIG_PATH;
  }
  return DEFAULT_CONFIG_PATH;
}

export function loadSwarmConfig(): SwarmConfigFile {
  if (cachedConfig) {
    return cachedConfig;
  }

  const configPath = getSwarmConfigPath();

  try {
    if (!fs.existsSync(configPath)) {
      logger.info('No swarm config found, creating default');
      return createDefaultConfig();
    }

    const content = fs.readFileSync(configPath, 'utf-8');
    cachedConfig = JSON.parse(content) as SwarmConfigFile;
    logger.info({ path: configPath }, 'Swarm config loaded');
    return cachedConfig!;
  } catch (error) {
    logger.error({ error, path: configPath }, 'Failed to load swarm config');
    return createDefaultConfig();
  }
}

export function saveSwarmConfig(config: SwarmConfigFile): void {
  const configPath = CONFIG_PATH;
  
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  cachedConfig = config;
  
  logger.info({ path: configPath }, 'Swarm config saved');
}

export function getOrchestratorConfig(): OrchestratorConfig {
  const config = loadSwarmConfig();
  
  return {
    leader: config.leader,
    workers: config.workers,
    maxParallelTasks: config.settings.maxParallelTasks,
    taskTimeoutMs: config.settings.taskTimeoutMs,
    heartbeatIntervalMs: config.settings.heartbeatIntervalMs,
    messageRetentionMs: config.settings.messageRetentionMs,
  };
}

export function createDefaultConfig(): SwarmConfigFile {
  const config: SwarmConfigFile = {
    leader: {
      id: 'andy',
      ...DEFAULT_AGENT_CONFIGS.leader,
    },
    workers: [
      { id: 'sarah', ...DEFAULT_AGENT_CONFIGS.researcher },
      { id: 'mike', ...DEFAULT_AGENT_CONFIGS.coder },
      { id: 'emma', ...DEFAULT_AGENT_CONFIGS.reviewer },
    ],
    settings: {
      maxParallelTasks: 4,
      taskTimeoutMs: 300000,
      heartbeatIntervalMs: 30000,
      messageRetentionMs: 604800000,
    },
    costTracking: {
      enabled: true,
      models: {
        'glm-4.5-flash': { input: 0, output: 0 },
        'glm-4.7-flash': { input: 0, output: 0 },
        'glm-5': { input: 0, output: 0 },
        'claude-haiku': { input: 0.25, output: 1.25 },
        'claude-sonnet': { input: 3, output: 15 },
      },
    },
  };

  saveSwarmConfig(config);
  return config;
}

export function addWorkerAgent(agent: AgentConfig): boolean {
  const config = loadSwarmConfig();
  
  const existing = config.workers.find(w => w.id === agent.id);
  if (existing) {
    return false;
  }

  config.workers.push(agent);
  saveSwarmConfig(config);
  return true;
}

export function removeWorkerAgent(agentId: string): boolean {
  const config = loadSwarmConfig();
  
  const index = config.workers.findIndex(w => w.id === agentId);
  if (index === -1) {
    return false;
  }

  config.workers.splice(index, 1);
  saveSwarmConfig(config);
  return true;
}

export function renameAgent(oldId: string, newId: string): boolean {
  const config = loadSwarmConfig();
  
  if (config.leader.id === oldId) {
    config.leader.id = newId;
    if (config.leader.systemPrompt) {
      config.leader.systemPrompt = config.leader.systemPrompt.replace(
        new RegExp(`You are ${oldId}`, 'i'),
        `You are ${newId}`
      );
    }
    saveSwarmConfig(config);
    return true;
  }

  const worker = config.workers.find(w => w.id === oldId);
  if (worker) {
    worker.id = newId;
    if (worker.systemPrompt) {
      worker.systemPrompt = worker.systemPrompt.replace(
        new RegExp(`You are ${oldId}`, 'i'),
        `You are ${newId}`
      );
    }
    saveSwarmConfig(config);
    return true;
  }

  return false;
}

export function updateAgentModel(agentId: string, model: string): boolean {
  const config = loadSwarmConfig();
  
  if (config.leader.id === agentId) {
    config.leader.model = model;
    saveSwarmConfig(config);
    return true;
  }

  const worker = config.workers.find(w => w.id === agentId);
  if (worker) {
    worker.model = model;
    saveSwarmConfig(config);
    return true;
  }

  return false;
}

export function updateAgentSystemPrompt(agentId: string, systemPrompt: string): boolean {
  const config = loadSwarmConfig();
  
  if (config.leader.id === agentId) {
    config.leader.systemPrompt = systemPrompt;
    saveSwarmConfig(config);
    return true;
  }

  const worker = config.workers.find(w => w.id === agentId);
  if (worker) {
    worker.systemPrompt = systemPrompt;
    saveSwarmConfig(config);
    return true;
  }

  return false;
}

export function updateSettings(settings: Partial<SwarmConfigFile['settings']>): void {
  const config = loadSwarmConfig();
  config.settings = { ...config.settings, ...settings };
  saveSwarmConfig(config);
}

export function getAvailableRoles(): AgentRole[] {
  return ['leader', 'researcher', 'coder', 'reviewer', 'writer'];
}

export function getAvailableModels(): string[] {
  return [
    'glm-4.7-flash',
    'glm-5',
    'glm-4.5-flash',
    'glm-4.7',
    'claude-sonnet',
    'claude-haiku',
  ];
}

export function resetToDefault(): void {
  cachedConfig = null;
  if (fs.existsSync(CONFIG_PATH)) {
    fs.unlinkSync(CONFIG_PATH);
  }
  createDefaultConfig();
}

export async function reloadConfig(): Promise<SwarmConfigFile> {
  const operation = (async () => {
    cachedConfig = null;
    return loadSwarmConfig();
  })();

  configLock = operation.then(() => {
    configLock = null;
  });

  await operation;
  return operation;
}
