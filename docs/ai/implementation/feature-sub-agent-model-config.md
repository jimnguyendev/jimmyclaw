---
phase: implementation
title: Sub-Agent Model Configuration Implementation
description: Technical implementation guide for sub-agent model config
---

# Implementation Guide

## Development Setup
**How do we get started?**

**Prerequisites:**
- Node.js/Bun environment
- Access to `container/agent-runner/` code
- Claude Agent SDK installed

## Code Structure
**How is the code organized?**

```
container/agent-runner/src/
├── index.ts           # Main entry (modify)
├── types.ts           # New file for types
└── agent-config.ts    # New file for config logic

groups/main/
└── agent-config.json  # User configuration file
```

## Implementation Notes
**Key technical details to remember:**

### Types (types.ts)
```typescript
export type ModelType = 'haiku' | 'sonnet' | 'opus' | 'inherit';

export interface SubAgentConfig {
  model: ModelType;
  description: string;
  prompt?: string;
  tools?: string[];
}

export interface AgentConfig {
  defaultModel?: ModelType;
  subAgents?: Record<string, SubAgentConfig>;
}

export interface AgentDefinition {
  description: string;
  model: ModelType;
  prompt: string;
  tools?: string[];
}
```

### Config Loading (agent-config.ts)
```typescript
import fs from 'fs';

const MODEL_MAP: Record<string, string> = {
  haiku: 'claude-haiku-3-5-20241022',
  sonnet: 'claude-sonnet-4-20250514',
  opus: 'claude-opus-4-20250514',
};

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

export function loadAgentConfig(): AgentConfig {
  const configPath = '/workspace/group/agent-config.json';
  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(content);
      return { ...getDefaultConfig(), ...config };
    }
  } catch (error) {
    console.error('[agent-config] Failed to load config, using defaults:', error);
  }
  return getDefaultConfig();
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
  }

  return agents;
}
```

### SDK Integration (index.ts modifications)
```typescript
// Add import
import { loadAgentConfig, buildAgentsOption } from './agent-config.js';

// In runQuery function, add to options:
const agentConfig = loadAgentConfig();
const agentsOption = buildAgentsOption(agentConfig);

for await (const message of query({
  prompt: stream,
  options: {
    // ... existing options ...
    agents: agentsOption,  // Add this line
  }
})) {
  // ... existing code ...
}
```

## Integration Points
**How do pieces connect?**

1. **Config File**: User creates `groups/main/agent-config.json`
2. **Container Mount**: File available at `/workspace/group/agent-config.json`
3. **Agent Runner**: Loads config, builds SDK options
4. **SDK**: Uses `agents` option to configure sub-agents

## Error Handling
**How do we handle failures?**

```typescript
// Invalid JSON
try {
  JSON.parse(content);
} catch {
  log('[agent-config] Invalid JSON, using defaults');
  return getDefaultConfig();
}

// Invalid model name
function validateModel(model: string): ModelType {
  if (['haiku', 'sonnet', 'opus', 'inherit'].includes(model)) {
    return model as ModelType;
  }
  log(`[agent-config] Invalid model "${model}", using inherit`);
  return 'inherit';
}
```

## Performance Considerations
**How do we keep it fast?**

- Config loaded once at session start
- No async file reads during query
- Small file size (<10KB typically)

## Security Notes
**What security measures are in place?**

- Config file is user-controlled
- No sensitive data in config
- Invalid config falls back to safe defaults
