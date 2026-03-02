/**
 * Delegation Manager
 * Manages inter-agent delegation lifecycle.
 */

import { randomUUID } from 'crypto';
import {
  AgentLink,
  DelegationTask,
  DelegateOpts,
  DelegateResult,
  AgentRunFunc,
  DelegationContext,
  DelegationMode,
  DelegationEvent,
} from './types.js';
import { AgentLinkStore, defaultLinkStore } from './link-store.js';

const DEFAULT_MAX_DELEGATION_LOAD = 5;

export class DelegationManager {
  private linkStore: AgentLinkStore;
  private runAgent: AgentRunFunc | null = null;
  private activeTasks: Map<string, DelegationTask> = new Map();
  private agentLoad: Map<string, number> = new Map();
  private linkLoad: Map<string, number> = new Map();
  private eventHandlers: Array<(event: DelegationEvent) => void> = [];

  constructor(linkStore: AgentLinkStore = defaultLinkStore) {
    this.linkStore = linkStore;
  }

  setAgentRunner(fn: AgentRunFunc): void {
    this.runAgent = fn;
  }

  onEvent(handler: (event: DelegationEvent) => void): () => void {
    this.eventHandlers.push(handler);
    return () => {
      const idx = this.eventHandlers.indexOf(handler);
      if (idx >= 0) this.eventHandlers.splice(idx, 1);
    };
  }

  private emitEvent(type: DelegationEvent['type'], task: DelegationTask): void {
    const event: DelegationEvent = { type, task, timestamp: new Date() };
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (err) {
        console.error('[Delegation] Event handler error:', err);
      }
    }
  }

  async delegate(
    sourceAgent: string,
    opts: DelegateOpts,
    context: DelegationContext
  ): Promise<DelegateResult> {
    const mode = opts.mode || 'sync';
    const task = this.prepareDelegation(sourceAgent, opts, context, mode);

    this.activeTasks.set(task.id, task);
    this.emitEvent('started', task);

    if (mode === 'async') {
      this.runAsync(task, opts, context);
      return {
        success: true,
        delegationId: task.id,
        iterations: 0,
      };
    }

    return this.runSync(task, opts, context);
  }

  private prepareDelegation(
    sourceAgent: string,
    opts: DelegateOpts,
    context: DelegationContext,
    mode: DelegationMode
  ): DelegationTask {
    if (!this.linkStore.canDelegate(sourceAgent, opts.targetAgent)) {
      throw new Error(
        `No delegation link from "${sourceAgent}" to "${opts.targetAgent}". ` +
        `Check agent_links configuration.`
      );
    }

    if (!this.linkStore.checkUserPermission(sourceAgent, opts.targetAgent, context.userId)) {
      throw new Error(`You are not authorized to delegate to "${opts.targetAgent}"`);
    }

    const link = this.linkStore.getLink(sourceAgent, opts.targetAgent);
    if (link) {
      const linkKey = `${sourceAgent}:${opts.targetAgent}`;
      const currentLoad = this.linkLoad.get(linkKey) || 0;
      if (link.maxConcurrent > 0 && currentLoad >= link.maxConcurrent) {
        throw new Error(
          `Delegation link to "${opts.targetAgent}" is at capacity (${currentLoad}/${link.maxConcurrent} active)`
        );
      }
    }

    const targetLoad = this.agentLoad.get(opts.targetAgent) || 0;
    if (targetLoad >= DEFAULT_MAX_DELEGATION_LOAD) {
      throw new Error(
        `Agent "${opts.targetAgent}" is at capacity (${targetLoad}/${DEFAULT_MAX_DELEGATION_LOAD} active delegations)`
      );
    }

    const delegationId = randomUUID().slice(0, 12);
    const sessionKey = `delegate:${sourceAgent.slice(0, 8)}:${opts.targetAgent}:${delegationId}`;

    return {
      id: delegationId,
      sourceAgent,
      targetAgent: opts.targetAgent,
      userId: context.userId,
      task: opts.task,
      context: opts.context,
      status: 'running',
      mode,
      sessionKey,
      createdAt: new Date(),
      iterations: 0,
    };
  }

  private async runSync(
    task: DelegationTask,
    opts: DelegateOpts,
    context: DelegationContext
  ): Promise<DelegateResult> {
    if (!this.runAgent) {
      this.activeTasks.delete(task.id);
      return {
        success: false,
        error: 'No agent runner configured',
        delegationId: task.id,
        iterations: 0,
      };
    }

    const linkKey = `${task.sourceAgent}:${task.targetAgent}`;
    this.incrementLoad(task.targetAgent, linkKey);

    try {
      const message = this.buildMessage(opts);
      const extraPrompt = this.buildExtraPrompt();

      const result = await this.runAgent(task.targetAgent, message, {
        ...context,
        sessionId: task.sessionKey,
        extraSystemPrompt: extraPrompt,
      });

      task.status = 'completed';
      task.completedAt = new Date();
      task.result = result.content;
      task.iterations = result.iterations;

      this.emitEvent('completed', task);

      return {
        success: true,
        content: result.content,
        delegationId: task.id,
        iterations: result.iterations,
      };
    } catch (err) {
      task.status = 'failed';
      task.completedAt = new Date();
      task.error = err instanceof Error ? err.message : String(err);

      this.emitEvent('failed', task);

      return {
        success: false,
        error: task.error,
        delegationId: task.id,
        iterations: 0,
      };
    } finally {
      this.decrementLoad(task.targetAgent, linkKey);
      this.activeTasks.delete(task.id);
    }
  }

  private runAsync(
    task: DelegationTask,
    opts: DelegateOpts,
    context: DelegationContext
  ): void {
    const linkKey = `${task.sourceAgent}:${task.targetAgent}`;
    this.incrementLoad(task.targetAgent, linkKey);

    (async () => {
      if (!this.runAgent) {
        task.status = 'failed';
        task.error = 'No agent runner configured';
        task.completedAt = new Date();
        this.emitEvent('failed', task);
        return;
      }

      try {
        const message = this.buildMessage(opts);
        const extraPrompt = this.buildExtraPrompt();

        const result = await this.runAgent(task.targetAgent, message, {
          ...context,
          sessionId: task.sessionKey,
          extraSystemPrompt: extraPrompt,
        });

        task.status = 'completed';
        task.completedAt = new Date();
        task.result = result.content;
        task.iterations = result.iterations;

        this.emitEvent('completed', task);
      } catch (err) {
        task.status = 'failed';
        task.completedAt = new Date();
        task.error = err instanceof Error ? err.message : String(err);

        this.emitEvent('failed', task);
      } finally {
        this.decrementLoad(task.targetAgent, linkKey);
        this.activeTasks.delete(task.id);
      }
    })().catch((err) => {
      console.error('[Delegation] Async delegation error:', err);
    });
  }

  cancel(delegationId: string): boolean {
    const task = this.activeTasks.get(delegationId);
    if (!task) return false;

    task.status = 'cancelled';
    task.completedAt = new Date();

    const linkKey = `${task.sourceAgent}:${task.targetAgent}`;
    this.decrementLoad(task.targetAgent, linkKey);
    this.activeTasks.delete(delegationId);

    this.emitEvent('cancelled', task);
    return true;
  }

  listActive(sourceAgent?: string): DelegationTask[] {
    const tasks = Array.from(this.activeTasks.values());
    if (sourceAgent) {
      return tasks.filter((t) => t.sourceAgent === sourceAgent);
    }
    return tasks;
  }

  getTask(delegationId: string): DelegationTask | undefined {
    return this.activeTasks.get(delegationId);
  }

  private incrementLoad(agent: string, linkKey: string): void {
    this.agentLoad.set(agent, (this.agentLoad.get(agent) || 0) + 1);
    this.linkLoad.set(linkKey, (this.linkLoad.get(linkKey) || 0) + 1);
  }

  private decrementLoad(agent: string, linkKey: string): void {
    const agentLoad = this.agentLoad.get(agent) || 0;
    if (agentLoad > 0) {
      this.agentLoad.set(agent, agentLoad - 1);
    }

    const linkLoad = this.linkLoad.get(linkKey) || 0;
    if (linkLoad > 0) {
      this.linkLoad.set(linkKey, linkLoad - 1);
    }
  }

  private buildMessage(opts: DelegateOpts): string {
    if (opts.context) {
      return `[Additional Context]\n${opts.context}\n\n[Task]\n${opts.task}`;
    }
    return opts.task;
  }

  private buildExtraPrompt(): string {
    return `[Delegation Context]
You are handling a delegated task from another agent.
- Focus exclusively on the delegated task below.
- Your complete response will be returned to the requesting agent.
- Do NOT try to communicate with the end user directly.
- Do NOT use your persona name or self-references. Write factual, neutral content.
- Be concise and deliver actionable results.`;
  }
}

export const defaultManager = new DelegationManager();
