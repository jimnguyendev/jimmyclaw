import { Database } from 'bun:sqlite';
import { AgentOrchestrator } from './orchestrator/index.js';
import { SWARM_ENABLED } from './config.js';
import { logger } from './logger.js';
import {
  loadSwarmConfig,
  addWorkerAgent,
  removeWorkerAgent,
  renameAgent,
  updateAgentModel,
  updateSettings,
  getAvailableRoles,
  getAvailableModels,
  resetToDefault,
  reloadConfig,
} from './swarm-config.js';
import { AgentRole, AgentConfig, DEFAULT_AGENT_CONFIGS } from './orchestrator/types.js';

export interface CommandResult {
  handled: boolean;
  response?: string;
  error?: string;
  requiresReload?: boolean;
}

export type SwarmStatus = {
  enabled: boolean;
  agents: Array<{
    id: string;
    role: string;
    model: string;
    status: string;
    totalTasks: number;
    successCount: number;
  }>;
  pendingTasks: number;
  processingTasks: number;
};

export function createSwarmCommandHandler(db: Database, orchestrator: AgentOrchestrator | null) {
  const SWARM_COMMANDS: Record<string, () => Promise<CommandResult>> = {
    status: async () => {
      if (!SWARM_ENABLED || !orchestrator) {
        return {
          handled: true,
          response: `🤖 **Swarm Status**
Status: ❌ Disabled
Set \`SWARM_ENABLED=true\` to enable multi-agent mode.`,
        };
      }

      const status = orchestrator.getStatus();

      let response = `🤖 **Swarm Status**
Status: ✅ Enabled
Pending Tasks: ${status.pendingTasks}
Processing: ${status.processingTasks}

**Agents:**`;

      for (const agent of status.agents) {
        const successRate = agent.totalTasks > 0
          ? Math.round((agent.successCount / agent.totalTasks) * 100)
          : 0;
        const statusEmoji = agent.status === 'idle' ? '🟢' : agent.status === 'busy' ? '🟡' : '🔴';

        response += `\n${statusEmoji} **${agent.id}** (${agent.role})
   Model: ${agent.model}
   Tasks: ${agent.totalTasks} (${successRate}% success)`;
      }

      return { handled: true, response };
    },

    agents: async () => {
      const config = loadSwarmConfig();

      let response = '🤖 **Configured Agents**\n\n';

      response += `👑 **${config.leader.id}** (leader)
   Model: ${config.leader.model}
   Fallback: ${config.leader.fallbackModel || 'none'}\n\n`;

      for (const worker of config.workers) {
        response += `🔹 **${worker.id}** (${worker.role})
   Model: ${worker.model}
   Fallback: ${worker.fallbackModel || 'none'}
   Max Concurrent: ${worker.maxConcurrent || 1}\n\n`;
      }

      return { handled: true, response };
    },

    models: async () => {
      const models = getAvailableModels();

      let response = '🎯 **Available Models**\n\n';

      const modelInfo: Record<string, { free: boolean; best: string }> = {
        'glm-4.7-flash': { free: true, best: 'Research, simple tasks' },
        'glm-5': { free: true, best: 'Coding, complex tasks' },
        'glm-4.5-flash': { free: true, best: 'Fallback' },
        'glm-4.7': { free: true, best: 'General' },
        'claude-sonnet': { free: false, best: 'Leader decisions' },
        'claude-haiku': { free: false, best: 'Fast responses' },
      };

      for (const model of models) {
        const info = modelInfo[model] || { free: true, best: 'General' };
        const priceTag = info.free ? '🆓 Free' : '💰 Paid';
        response += `**${model}** ${priceTag}
Best for: ${info.best}\n\n`;
      }

      return { handled: true, response };
    },

    roles: async () => {
      const roles = getAvailableRoles();

      const roleDescriptions: Record<string, string> = {
        leader: '👑 Coordinates team, delegates tasks',
        researcher: '🔍 Research, analyze, summarize',
        coder: '💻 Write, debug, review code',
        reviewer: '✅ Review, validate, improve',
        writer: '📝 Documentation, guides, content',
      };

      let response = '📋 **Available Roles**\n\n';

      for (const role of roles) {
        response += `**${role}** - ${roleDescriptions[role] || 'General purpose'}\n`;
      }

      return { handled: true, response };
    },

    help: async () => {
      const response = `🤖 **Swarm Commands**

**Status & Info:**
\`/swarm status\` - Show swarm status
\`/swarm agents\` - List configured agents
\`/swarm models\` - List available models
\`/swarm roles\` - List available roles
\`/swarm tasks\` - Show task queue

**Agent Management:**
\`/swarm agent add <id> <role> <model>\` - Add new worker
\`/swarm agent rename <old> <new>\` - Rename agent
\`/swarm agent remove <id>\` - Remove worker
\`/swarm agent model <id> <model>\` - Change model

**Config:**
\`/swarm config show\` - Show current config
\`/swarm config reset\` - Reset to default
\`/swarm config reload\` - Reload config

**Examples:**
\`/swarm agent add dev1 coder glm-5\`
\`/swarm agent rename mike ninja\`
\`/swarm agent model sarah claude-haiku\``;

      return { handled: true, response };
    },

    tasks: async () => {
      if (!SWARM_ENABLED || !orchestrator) {
        return {
          handled: true,
          response: 'Swarm mode is disabled.',
        };
      }

      const queue = orchestrator.getTaskQueue();
      const pending = queue.getTasksByStatus('pending');
      const processing = queue.getTasksByStatus('processing');

      let response = `📋 **Task Queue**

**Pending:** ${pending.length}
**Processing:** ${processing.length}
`;

      if (pending.length > 0) {
        response += '\n**Recent Pending:**\n';
        for (const task of pending.slice(0, 5)) {
          response += `- [${task.type}] ${task.prompt.slice(0, 50)}...\n`;
        }
      }

      return { handled: true, response };
    },

    config: async () => {
      return showConfig();
    },
  };

  async function showConfig(): Promise<CommandResult> {
    const config = loadSwarmConfig();

    let response = `⚙️ **Swarm Configuration**

**Leader:** ${config.leader.id}
**Workers:** ${config.workers.map(w => w.id).join(', ')}

**Settings:**
- Max Parallel Tasks: ${config.settings.maxParallelTasks}
- Task Timeout: ${config.settings.taskTimeoutMs / 1000}s
- Heartbeat Interval: ${config.settings.heartbeatIntervalMs / 1000}s

**Cost Tracking:** ${config.costTracking.enabled ? '✅ Enabled' : '❌ Disabled'}`;

    return { handled: true, response };
  }

  async function handleAgentCommand(parts: string[]): Promise<CommandResult> {
    const action = parts[2]?.toLowerCase();

    switch (action) {
      case 'add': {
        const id = parts[3];
        const role = parts[4] as AgentRole;
        const model = parts[5];

        if (!id || !role || !model) {
          return {
            handled: true,
            error: 'Usage: `/swarm agent add <id> <role> <model>`\nExample: `/swarm agent add dev1 coder glm-5`',
          };
        }

        if (!getAvailableRoles().includes(role)) {
          return {
            handled: true,
            error: `Invalid role. Available: ${getAvailableRoles().join(', ')}\nUse \`/swarm roles\` for details.`,
          };
        }

        if (!getAvailableModels().includes(model)) {
          return {
            handled: true,
            error: `Unknown model. Available: ${getAvailableModels().join(', ')}\nUse \`/swarm models\` for details.`,
          };
        }

        const defaultConfig = DEFAULT_AGENT_CONFIGS[role];
        const newAgent: AgentConfig = {
          id,
          role,
          model,
          fallbackModel: defaultConfig?.fallbackModel,
          systemPrompt: defaultConfig?.systemPrompt?.replace(
            new RegExp(`You are \\w+`, 'i'),
            `You are ${id}`
          ),
          maxConcurrent: defaultConfig?.maxConcurrent || 1,
          timeoutMs: defaultConfig?.timeoutMs || 120000,
        };

        const success = addWorkerAgent(newAgent);
        if (!success) {
          return { handled: true, error: `Agent "${id}" already exists.` };
        }

        return {
          handled: true,
          response: `✅ Agent **${id}** added as ${role} using ${model}.\n\nUse \`/swarm config reload\` to apply changes.`,
          requiresReload: true,
        };
      }

      case 'rename': {
        const oldId = parts[3];
        const newId = parts[4];

        if (!oldId || !newId) {
          return {
            handled: true,
            error: 'Usage: `/swarm agent rename <old_id> <new_id>`\nExample: `/swarm agent rename mike ninja`',
          };
        }

        const success = renameAgent(oldId, newId);
        if (!success) {
          return { handled: true, error: `Agent "${oldId}" not found.` };
        }

        return {
          handled: true,
          response: `✅ Agent renamed from **${oldId}** to **${newId}**.\n\nUse \`/swarm config reload\` to apply changes.`,
          requiresReload: true,
        };
      }

      case 'remove': {
        const id = parts[3];

        if (!id) {
          return {
            handled: true,
            error: 'Usage: `/swarm agent remove <id>`\nExample: `/swarm agent remove dev1`',
          };
        }

        const config = loadSwarmConfig();
        if (config.leader.id === id) {
          return { handled: true, error: 'Cannot remove the leader agent.' };
        }

        const success = removeWorkerAgent(id);
        if (!success) {
          return { handled: true, error: `Worker "${id}" not found.` };
        }

        return {
          handled: true,
          response: `✅ Worker **${id}** removed.\n\nUse \`/swarm config reload\` to apply changes.`,
          requiresReload: true,
        };
      }

      case 'model': {
        const id = parts[3];
        const model = parts[4];

        if (!id || !model) {
          return {
            handled: true,
            error: 'Usage: `/swarm agent model <id> <model>`\nExample: `/swarm agent model sarah claude-haiku`',
          };
        }

        if (!getAvailableModels().includes(model)) {
          return {
            handled: true,
            error: `Unknown model. Available: ${getAvailableModels().join(', ')}`,
          };
        }

        const success = updateAgentModel(id, model);
        if (!success) {
          return { handled: true, error: `Agent "${id}" not found.` };
        }

        return {
          handled: true,
          response: `✅ Agent **${id}** model changed to ${model}.\n\nUse \`/swarm config reload\` to apply changes.`,
          requiresReload: true,
        };
      }

      case 'list':
      default:
        return SWARM_COMMANDS.agents();
    }
  }

  async function handleConfigCommand(parts: string[]): Promise<CommandResult> {
    const action = parts[2]?.toLowerCase();

    switch (action) {
      case 'show':
        return showConfig();

      case 'reset': {
        resetToDefault();
        return {
          handled: true,
          response: '✅ Configuration reset to default.\n\nUse `/swarm config reload` to apply changes.',
          requiresReload: true,
        };
      }

      case 'reload': {
        reloadConfig();
        return {
          handled: true,
          response: '✅ Configuration reloaded. Restart swarm to apply fully.',
        };
      }

      case 'set': {
        const key = parts[3];
        const value = parts[4];

        if (!key || !value) {
          return {
            handled: true,
            error: 'Usage: `/swarm config set <key> <value>`\nKeys: maxParallelTasks, taskTimeoutMs',
          };
        }

        const numValue = parseInt(value, 10);
        if (isNaN(numValue)) {
          return { handled: true, error: 'Value must be a number.' };
        }

        const settings: Record<string, number> = {
          maxparalleltasks: 'maxParallelTasks' as never,
          tasktimeoutms: 'taskTimeoutMs' as never,
          heartbeatintervalms: 'heartbeatIntervalMs' as never,
        };

        const settingKey = settings[key.toLowerCase()];
        if (!settingKey) {
          return { handled: true, error: `Unknown setting: ${key}` };
        }

        updateSettings({ [settingKey]: numValue });
        return {
          handled: true,
          response: `✅ Setting **${key}** set to ${numValue}.\n\nUse \`/swarm config reload\` to apply changes.`,
          requiresReload: true,
        };
      }

      default:
        return showConfig();
    }
  }

  async function handleSwarmCommand(message: string): Promise<CommandResult> {
    const trimmed = message.trim();

    if (!trimmed.startsWith('/swarm')) {
      return { handled: false };
    }

    const parts = trimmed.split(/\s+/);
    const subCommand = parts[1]?.toLowerCase() || 'status';

    if (subCommand === 'agent') {
      return handleAgentCommand(parts);
    }

    if (subCommand === 'config') {
      return handleConfigCommand(parts);
    }

    const handler = SWARM_COMMANDS[subCommand];
    if (handler) {
      try {
        return await handler();
      } catch (error) {
        logger.error({ subCommand, error }, 'Swarm command error');
        return {
          handled: true,
          error: error instanceof Error ? error.message : 'Command failed',
        };
      }
    }

    return {
      handled: true,
      response: `Unknown command: ${subCommand}\n\nType \`/swarm help\` for available commands.`,
    };
  }

  return { handleSwarmCommand };
}

export function isSwarmCommand(message: string): boolean {
  return message.trim().startsWith('/swarm');
}
