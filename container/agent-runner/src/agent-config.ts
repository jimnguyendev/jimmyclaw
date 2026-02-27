import fs from 'fs';
import { AgentConfig, AgentDefinition, ModelType, SubAgentConfig } from './types.js';

const MODEL_MAP: Record<string, string> = {
  haiku: 'claude-haiku-3-5-20241022',
  sonnet: 'claude-sonnet-4-20250514',
  opus: 'claude-opus-4-20250514',
};

function log(message: string): void {
  console.error(`[agent-config] ${message}`);
}

export function getDefaultConfig(): AgentConfig {
  return {
    defaultModel: 'sonnet',
    subAgents: {
      researcher: {
        model: 'haiku',
        description: 'Search and gather information from web and files',
        tools: ['WebSearch', 'WebFetch', 'Read', 'Grep', 'Glob'],
      },
      coder: {
        model: 'sonnet',
        description: 'Write, modify, and debug code',
        tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
      },
      reviewer: {
        model: 'opus',
        description: 'Review code quality, architecture, and security',
        tools: ['Read', 'Glob', 'Grep'],
      },
    },
  };
}

function validateModel(model: unknown): ModelType {
  if (typeof model === 'string' && ['haiku', 'sonnet', 'opus', 'inherit'].includes(model)) {
    return model as ModelType;
  }
  log(`Invalid model "${model}", using inherit`);
  return 'inherit';
}

function validateSubAgentConfig(config: unknown): SubAgentConfig | null {
  if (typeof config !== 'object' || config === null) return null;
  
  const c = config as Record<string, unknown>;
  if (typeof c.description !== 'string' || !c.description) {
    log('Sub-agent missing description, skipping');
    return null;
  }
  
  return {
    model: validateModel(c.model),
    description: c.description,
    prompt: typeof c.prompt === 'string' ? c.prompt : undefined,
    tools: Array.isArray(c.tools) ? c.tools.filter((t): t is string => typeof t === 'string') : undefined,
  };
}

export function loadAgentConfig(): AgentConfig {
  const configPath = '/workspace/group/agent-config.json';
  
  try {
    if (!fs.existsSync(configPath)) {
      log('No config file found, using defaults');
      return getDefaultConfig();
    }
    
    const content = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(content);
    
    const defaults = getDefaultConfig();
    const config: AgentConfig = {
      defaultModel: validateModel(parsed.defaultModel ?? defaults.defaultModel),
      subAgents: { ...defaults.subAgents },
    };
    
    if (parsed.subAgents && typeof parsed.subAgents === 'object') {
      for (const [name, agentConfig] of Object.entries(parsed.subAgents)) {
        const validated = validateSubAgentConfig(agentConfig);
        if (validated) {
          config.subAgents![name] = validated;
        }
      }
    }
    
    log(`Loaded config with ${Object.keys(config.subAgents || {}).length} sub-agents`);
    return config;
  } catch (error) {
    log(`Failed to load config: ${error instanceof Error ? error.message : String(error)}, using defaults`);
    return getDefaultConfig();
  }
}

export function buildAgentsOption(config: AgentConfig): Record<string, AgentDefinition> | undefined {
  if (!config.subAgents || Object.keys(config.subAgents).length === 0) {
    return undefined;
  }

  const agents: Record<string, AgentDefinition> = {};
  
  for (const [name, agentConfig] of Object.entries(config.subAgents)) {
    agents[name] = {
      description: agentConfig.description,
      model: agentConfig.model,
      prompt: agentConfig.prompt || `You are a ${name} agent. ${agentConfig.description}`,
      tools: agentConfig.tools,
    };
    log(`Registered sub-agent "${name}" with model "${agentConfig.model}"`);
  }

  return Object.keys(agents).length > 0 ? agents : undefined;
}

export function getModelId(model: ModelType): string | undefined {
  if (model === 'inherit') return undefined;
  return MODEL_MAP[model];
}
