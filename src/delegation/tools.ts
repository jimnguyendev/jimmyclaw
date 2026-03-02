/**
 * Delegation Tools
 * Tools for agents to delegate tasks to other agents.
 */

import { DelegateOpts, DelegateResult, AgentInfo, DelegationContext } from './types.js';
import { DelegationManager, defaultManager } from './manager.js';
import { AgentLinkStore, defaultLinkStore } from './link-store.js';

export interface DelegateToolResult {
  tool: string;
  result: DelegateResult | { error: string };
}

export class DelegationTools {
  private manager: DelegationManager;
  private linkStore: AgentLinkStore;
  private agents: Map<string, AgentInfo> = new Map();

  constructor(
    manager: DelegationManager = defaultManager,
    linkStore: AgentLinkStore = defaultLinkStore
  ) {
    this.manager = manager;
    this.linkStore = linkStore;
  }

  registerAgent(agent: AgentInfo): void {
    this.agents.set(agent.key, agent);
  }

  unregisterAgent(key: string): void {
    this.agents.delete(key);
  }

  getAgent(key: string): AgentInfo | undefined {
    return this.agents.get(key);
  }

  listAgents(): AgentInfo[] {
    return Array.from(this.agents.values());
  }

  getAvailableTargets(sourceAgent: string): AgentInfo[] {
    const links = this.linkStore.getOutboundLinks(sourceAgent);
    const targetKeys = new Set(links.map((l) => l.targetAgent));
    return this.listAgents().filter((a) => targetKeys.has(a.key));
  }

  generateAgentsMd(sourceAgent: string): string {
    const targets = this.getAvailableTargets(sourceAgent);
    if (targets.length === 0) {
      return '# Available Agents\n\nNo delegation targets configured.';
    }

    const lines = ['# Available Agents\n'];
    lines.push('You can delegate tasks to the following agents:\n');

    for (const agent of targets) {
      lines.push(`## ${agent.name} (\`${agent.key}\`)`);
      if (agent.description) {
        lines.push(agent.description);
      }
      if (agent.model) {
        lines.push(`**Model:** ${agent.model}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  async delegate(
    sourceAgent: string,
    opts: DelegateOpts,
    context: DelegationContext
  ): Promise<DelegateToolResult> {
    try {
      const result = await this.manager.delegate(sourceAgent, opts, context);
      return { tool: 'delegate', result };
    } catch (err) {
      return {
        tool: 'delegate',
        result: { error: err instanceof Error ? err.message : String(err) },
      };
    }
  }

  async delegateSync(
    sourceAgent: string,
    targetAgent: string,
    task: string,
    context: DelegationContext,
    extraContext?: string
  ): Promise<DelegateToolResult> {
    return this.delegate(
      sourceAgent,
      { targetAgent, task, context: extraContext, mode: 'sync' },
      context
    );
  }

  async delegateAsync(
    sourceAgent: string,
    targetAgent: string,
    task: string,
    context: DelegationContext,
    extraContext?: string
  ): Promise<DelegateToolResult> {
    return this.delegate(
      sourceAgent,
      { targetAgent, task, context: extraContext, mode: 'async' },
      context
    );
  }

  cancel(delegationId: string): { success: boolean; message: string } {
    const cancelled = this.manager.cancel(delegationId);
    if (cancelled) {
      return { success: true, message: `Delegation ${delegationId} cancelled` };
    }
    return { success: false, message: `Delegation ${delegationId} not found or already completed` };
  }

  listActive(sourceAgent?: string): { delegations: ReturnType<DelegationManager['listActive']> } {
    return { delegations: this.manager.listActive(sourceAgent) };
  }

  searchAgents(query: string): AgentInfo[] {
    const q = query.toLowerCase();
    return this.listAgents().filter((a) => {
      return (
        a.key.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        a.description?.toLowerCase().includes(q)
      );
    });
  }

  getToolDefinitions(): Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }> {
    return [
      {
        name: 'delegate',
        description:
          'Delegate a task to another agent. Use sync mode for quick lookups, async for long tasks.',
        parameters: {
          type: 'object',
          properties: {
            target_agent: {
              type: 'string',
              description: 'The key of the target agent',
            },
            task: {
              type: 'string',
              description: 'The task description',
            },
            context: {
              type: 'string',
              description: 'Optional additional context',
            },
            mode: {
              type: 'string',
              enum: ['sync', 'async'],
              description: 'sync (wait for result) or async (announce later)',
            },
          },
          required: ['target_agent', 'task'],
        },
      },
      {
        name: 'delegate_search',
        description: 'Search for available delegation targets',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query (name, key, or capability)',
            },
          },
        },
      },
      {
        name: 'delegate_cancel',
        description: 'Cancel a running delegation',
        parameters: {
          type: 'object',
          properties: {
            delegation_id: {
              type: 'string',
              description: 'The delegation ID to cancel',
            },
          },
          required: ['delegation_id'],
        },
      },
      {
        name: 'delegate_list',
        description: 'List active delegations',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    ];
  }
}

export const defaultTools = new DelegationTools();
