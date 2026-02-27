---
phase: design
title: Sub-Agent Model Configuration Design
description: Technical architecture for per-agent model selection
---

# System Design & Architecture

## Architecture Overview
**What is the high-level system structure?**

```mermaid
graph TD
    subgraph Host
        CF[agent-config.json]
        GF[groups/main/]
        GF --> CF
    end
    
    subgraph Container
        RUN[agent-runner]
        RUN --> |read config| CF
        
        subgraph SDK
            QUERY[query()]
            QUERY --> |agents option| AGENTS
            AGENTS[Agent Definitions]
            AGENTS --> |model: haiku| RES[Researcher]
            AGENTS --> |model: sonnet| COD[Coder]
            AGENTS --> |model: opus| REV[Reviewer]
        end
        
        RUN --> QUERY
    end
    
    subgraph Models
        H[Claude Haiku]
        S[Claude Sonnet]
        O[Claude Opus]
    end
    
    RES --> H
    COD --> S
    REV --> O
```

**Key components:**
- **agent-config.json**: Per-group model configuration
- **Agent Runner**: Reads config, builds SDK options
- **SDK agents option**: Programmatic sub-agent definitions

## Data Models
**What data do we need to manage?**

### Configuration Schema
```typescript
interface AgentConfig {
  // Default model for main agent
  defaultModel?: 'haiku' | 'sonnet' | 'opus';
  
  // Sub-agent configurations
  subAgents?: Record<string, SubAgentConfig>;
}

interface SubAgentConfig {
  // Claude model to use
  model: 'haiku' | 'sonnet' | 'opus' | 'inherit';
  
  // When to use this agent (description)
  description: string;
  
  // Agent's system prompt
  prompt?: string;
  
  // Allowed tools (inherits all if omitted)
  tools?: string[];
}
```

### Example Configuration
```json
{
  "defaultModel": "sonnet",
  "subAgents": {
    "researcher": {
      "model": "haiku",
      "description": "Search and gather information from web and files",
      "tools": ["WebSearch", "WebFetch", "Read", "Grep", "Glob"]
    },
    "coder": {
      "model": "sonnet",
      "description": "Write, modify, and debug code",
      "tools": ["Read", "Write", "Edit", "Bash", "Glob", "Grep"]
    },
    "reviewer": {
      "model": "opus",
      "description": "Review code quality, architecture, and security",
      "tools": ["Read", "Glob", "Grep"]
    }
  }
}
```

### Model Mapping
| Config Value | Claude Model ID |
|--------------|-----------------|
| `haiku` | `claude-haiku-3-5-20241022` |
| `sonnet` | `claude-sonnet-4-20250514` |
| `opus` | `claude-opus-4-20250514` |
| `inherit` | Same as parent agent |

## API Design
**How do components communicate?**

### Config Loading
```typescript
// In agent-runner/src/index.ts
async function loadAgentConfig(groupFolder: string): Promise<AgentConfig> {
  const configPath = `/workspace/group/agent-config.json`;
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return getDefaultConfig();
  }
}
```

### SDK Integration
```typescript
// Build agents option for SDK
function buildAgentsOption(config: AgentConfig): Record<string, AgentDefinition> {
  const agents: Record<string, AgentDefinition> = {};
  
  for (const [name, agentConfig] of Object.entries(config.subAgents || {})) {
    agents[name] = {
      description: agentConfig.description,
      model: agentConfig.model,
      prompt: agentConfig.prompt || getDefaultPrompt(name),
      tools: agentConfig.tools
    };
  }
  
  return agents;
}
```

## Component Breakdown
**What are the major building blocks?**

### Files to Modify
| File | Change |
|------|--------|
| `container/agent-runner/src/index.ts` | Add config loading, pass to SDK |
| `groups/main/CLAUDE.md` | Document agent-config.json usage |

### New Files
| File | Purpose |
|------|---------|
| `groups/main/agent-config.json` | Default configuration |

### Default Agent Presets
| Agent | Model | Tools | Use Case |
|-------|-------|-------|----------|
| researcher | haiku | WebSearch, WebFetch, Read, Grep | Quick lookups |
| coder | sonnet | Read, Write, Edit, Bash, Glob, Grep | Code changes |
| reviewer | opus | Read, Glob, Grep | Quality checks |
| planner | sonnet | Read, Write | Task planning |

## Design Decisions
**Why did we choose this approach?**

### Decision 1: JSON over YAML
- **Chosen**: JSON configuration
- **Alternatives**: YAML, TypeScript config
- **Rationale**: No additional parser needed, native JS support

### Decision 2: Per-group Config
- **Chosen**: Config in each group folder
- **Alternatives**: Global config, environment variables
- **Rationale**: Different groups may need different agent setups

### Decision 3: SDK `agents` Option
- **Chosen**: Use SDK's programmatic agent definitions
- **Alternatives**: Custom sub-agent orchestration
- **Rationale**: Native SDK support, simpler implementation

## Non-Functional Requirements
**How should the system perform?**

### Performance
- Config load: <10ms
- No impact on agent startup time (async load)

### Reliability
- Graceful fallback to defaults on invalid config
- Log warning on config parse errors
- Continue with inherit model if specific model unavailable

### Observability
- Log which model each sub-agent uses
- Track model usage in session metadata
