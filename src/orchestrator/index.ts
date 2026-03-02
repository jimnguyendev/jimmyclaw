import { Database } from 'bun:sqlite';
import { TaskQueue } from './task-queue.js';
import { AgentRegistry } from './agent-registry.js';
import { Messenger } from './messenger.js';
import { SharedMemory } from './memory.js';
import { LLMProviderService, llmProvider } from './llm-provider.js';
import { DEFAULT_FREE_MODEL } from './llm-types.js';
import {
  OrchestratorConfig,
  SwarmTask,
  SwarmAgent,
  ProcessResult,
  TaskClassification,
  TASK_KEYWORDS,
  AgentRole,
  DEFAULT_AGENT_CONFIGS,
} from './types.js';
import { logger } from '../logger.js';

const DEFAULT_CONFIG: OrchestratorConfig = {
  leader: { id: 'andy', ...DEFAULT_AGENT_CONFIGS.leader },
  workers: [
    { id: 'sarah', ...DEFAULT_AGENT_CONFIGS.researcher },
    { id: 'mike', ...DEFAULT_AGENT_CONFIGS.coder },
    { id: 'emma', ...DEFAULT_AGENT_CONFIGS.reviewer },
  ],
  maxParallelTasks: 4,
  taskTimeoutMs: 300000,
  heartbeatIntervalMs: 30000,
  messageRetentionMs: 604800000,
};

export class AgentOrchestrator {
  private taskQueue: TaskQueue;
  private agentRegistry: AgentRegistry;
  private messenger: Messenger;
  private memory: SharedMemory;
  private config: OrchestratorConfig;
  private processing: Map<string, Promise<ProcessResult>> = new Map();
  private pollInterval?: Timer;

  constructor(rawDb: Database, config: Partial<OrchestratorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.taskQueue = new TaskQueue(rawDb);
    this.agentRegistry = new AgentRegistry(rawDb);
    this.messenger = new Messenger(rawDb);
    this.memory = new SharedMemory(rawDb);
  }

  initialize(): void {
    this.agentRegistry.initializeDefaultAgents();
    this.startHealthMonitor();
    this.startTaskPoller();
    logger.info('Agent Orchestrator initialized');
  }

  classifyTask(prompt: string): TaskClassification {
    const lowerPrompt = prompt.toLowerCase();
    const scores: Record<string, number> = {};

    for (const [type, keywords] of Object.entries(TASK_KEYWORDS)) {
      if (type === 'general') continue;
      scores[type] = keywords.reduce((score, keyword) => {
        return lowerPrompt.includes(keyword.toLowerCase()) ? score + 1 : score;
      }, 0);
    }

    let bestType = 'general';
    let bestScore = 0;

    for (const [type, score] of Object.entries(scores)) {
      if (score > bestScore) {
        bestScore = score;
        bestType = type;
      }
    }

    const roleMap: Record<string, AgentRole> = {
      research: 'researcher',
      code: 'coder',
      review: 'reviewer',
      write: 'writer',
      general: 'researcher',
    };

    const role = roleMap[bestType] || 'researcher';
    const agent = this.agentRegistry.selectBestAgentForTask(bestType);

    return {
      type: bestType as TaskClassification['type'],
      confidence: bestScore > 0 ? Math.min(bestScore / 3, 1) : 0.3,
      suggestedAgent: agent?.id || role,
    };
  }

  async processUserMessage(
    prompt: string,
    context: {
      userId?: string;
      chatJid?: string;
    } = {},
  ): Promise<ProcessResult> {
    const classification = this.classifyTask(prompt);
    logger.info({ prompt: prompt.slice(0, 100), classification }, 'Processing user message');

    const task = this.taskQueue.createTask({
      type: classification.type,
      prompt,
      fromAgent: 'andy',
      toAgent: classification.suggestedAgent,
      userId: context.userId,
      chatJid: context.chatJid,
    });

    this.messenger.sendMessage({
      fromAgent: 'andy',
      toAgent: classification.suggestedAgent,
      type: 'task_assign',
      content: JSON.stringify({ taskId: task.id, prompt }),
      taskId: task.id,
    });

    const agent = this.agentRegistry.getAgent(classification.suggestedAgent);
    if (agent) {
      this.agentRegistry.updateStatus(agent.id, 'busy');
      this.agentRegistry.setCurrentTask(agent.id, task.id);
    }

    return this.executeTask(task, agent);
  }

  private async executeTask(task: SwarmTask, agent?: SwarmAgent): Promise<ProcessResult> {
    const startTime = Date.now();

    try {
      this.taskQueue.startTask(task.id);

      const result = await this.callModel(
        agent?.model || 'gemini-2.0-flash',
        task.prompt,
        task.context,
      );

      const duration = Date.now() - startTime;

      if (result.success) {
        this.taskQueue.completeTask(task.id, result.result || '', result.tokensUsed, result.cost);
        this.messenger.sendMessage({
          fromAgent: agent?.id || 'unknown',
          toAgent: 'andy',
          type: 'task_result',
          content: result.result || '',
          taskId: task.id,
        });

        if (agent) {
          this.agentRegistry.updateStatus(agent.id, 'idle');
          this.agentRegistry.setCurrentTask(agent.id, undefined);
          this.agentRegistry.incrementTaskCount(agent.id, true);
        }

        return {
          success: true,
          result: result.result,
          taskId: task.id,
          agentId: agent?.id || 'unknown',
          tokensUsed: result.tokensUsed,
          cost: result.cost,
        };
      } else {
        throw new Error(result.error || 'Model call failed');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.taskQueue.failTask(task.id, errorMessage);

      this.messenger.sendMessage({
        fromAgent: agent?.id || 'unknown',
        toAgent: 'andy',
        type: 'task_failed',
        content: errorMessage,
        taskId: task.id,
      });

      if (agent) {
        this.agentRegistry.updateStatus(agent.id, 'idle');
        this.agentRegistry.setCurrentTask(agent.id, undefined);
        this.agentRegistry.incrementTaskCount(agent.id, false);
      }

      const shouldRetry = this.taskQueue.incrementRetry(task.id);
      if (shouldRetry) {
        logger.info({ taskId: task.id }, 'Retrying task');
        return this.processWithFallback(task, agent);
      }

      return {
        success: false,
        error: errorMessage,
        taskId: task.id,
        agentId: agent?.id || 'unknown',
      };
    }
  }

  private async processWithFallback(task: SwarmTask, originalAgent?: SwarmAgent): Promise<ProcessResult> {
    const fallbackModel = originalAgent?.fallbackModel || DEFAULT_FREE_MODEL;

    const fallbackAgent: SwarmAgent = {
      id: 'fallback',
      role: originalAgent?.role || 'researcher',
      model: fallbackModel,
      status: 'busy',
      totalTasks: 0,
      successCount: 0,
      createdAt: new Date().toISOString(),
    };

    return this.executeTask(task, fallbackAgent);
  }

  private async callModel(
    model: string,
    prompt: string,
    context?: string,
    systemPrompt?: string,
  ): Promise<{ success: boolean; result?: string; error?: string; tokensUsed?: number; cost?: number }> {
    try {
      const fullPrompt = context ? `Context:\n${context}\n\nTask:\n${prompt}` : prompt;

      const response = await llmProvider.generate(
        { provider: 'opencode', model, timeoutMs: 120000 },
        fullPrompt,
        systemPrompt,
      );

      return {
        success: true,
        result: response.content,
        tokensUsed: response.tokensUsed?.total,
        cost: response.cost,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Model call failed',
      };
    }
  }

  async *streamModel(
    model: string,
    prompt: string,
    context?: string,
    systemPrompt?: string,
  ): AsyncGenerator<{ content: string; done: boolean }> {
    const fullPrompt = context ? `Context:\n${context}\n\nTask:\n${prompt}` : prompt;

    try {
      for await (const chunk of llmProvider.generateStream(
        { provider: 'opencode', model, timeoutMs: 120000 },
        fullPrompt,
        systemPrompt,
      )) {
        yield { content: chunk.content, done: chunk.done };
      }
    } catch (error) {
      yield {
        content: `Error: ${error instanceof Error ? error.message : 'Model call failed'}`,
        done: true,
      };
    }
  }

  async callModelWithFallback(
    models: string[],
    prompt: string,
    context?: string,
    systemPrompt?: string,
  ): Promise<{ success: boolean; result?: string; error?: string; tokensUsed?: number; cost?: number }> {
    try {
      const fullPrompt = context ? `Context:\n${context}\n\nTask:\n${prompt}` : prompt;

      const response = await llmProvider.generateWithFallback(
        models,
        fullPrompt,
        systemPrompt,
        { provider: 'opencode', timeoutMs: 120000 },
      );

      return {
        success: true,
        result: response.content,
        tokensUsed: response.tokensUsed?.total,
        cost: response.cost,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'All models failed',
      };
    }
  }

  delegateTask(
    fromAgent: string,
    toAgentRole: AgentRole,
    prompt: string,
    context?: string,
  ): SwarmTask {
    const agent = this.agentRegistry.getAgentByRole(toAgentRole);

    if (!agent) {
      throw new Error(`No agent found with role: ${toAgentRole}`);
    }

    const task = this.taskQueue.createTask({
      type: toAgentRole === 'researcher' ? 'research' : 
            toAgentRole === 'coder' ? 'code' :
            toAgentRole === 'reviewer' ? 'review' : 'general',
      prompt,
      context,
      fromAgent,
      toAgent: agent.id,
    });

    this.messenger.sendMessage({
      fromAgent,
      toAgent: agent.id,
      type: 'task_assign',
      content: JSON.stringify({ taskId: task.id, prompt, context }),
      taskId: task.id,
    });

    return task;
  }

  async getTaskResult(taskId: string, timeoutMs: number = 60000): Promise<ProcessResult | undefined> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const task = this.taskQueue.getTask(taskId);

      if (!task) {
        return { success: false, error: 'Task not found', taskId, agentId: 'unknown' };
      }

      if (task.status === 'done') {
        return {
          success: true,
          result: task.result,
          taskId,
          agentId: task.toAgent || 'unknown',
          tokensUsed: task.tokensUsed,
          cost: task.cost,
        };
      }

      if (task.status === 'failed' || task.status === 'timeout') {
        return {
          success: false,
          error: task.error,
          taskId,
          agentId: task.toAgent || 'unknown',
        };
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    return { success: false, error: 'Timeout waiting for result', taskId, agentId: 'unknown' };
  }

  private startHealthMonitor(): void {
    setInterval(() => {
      const staleAgents = this.agentRegistry.getStaleAgents(this.config.heartbeatIntervalMs * 2);

      for (const agent of staleAgents) {
        logger.warn({ agentId: agent.id }, 'Agent appears stale, marking offline');
        this.agentRegistry.updateStatus(agent.id, 'offline');

        if (agent.currentTaskId) {
          this.taskQueue.timeoutTask(agent.currentTaskId);
        }
      }

      const staleTasks = this.taskQueue.getStaleTasks(this.config.taskTimeoutMs);
      for (const task of staleTasks) {
        logger.warn({ taskId: task.id }, 'Task timed out');
        this.taskQueue.timeoutTask(task.id);
      }
    }, this.config.heartbeatIntervalMs);
  }

  private startTaskPoller(): void {
    this.pollInterval = setInterval(() => {
      this.processPendingTasks();
    }, 1000);
  }

  private async processPendingTasks(): Promise<void> {
    const pendingTasks = this.taskQueue.getTasksByStatus('pending');

    for (const task of pendingTasks.slice(0, this.config.maxParallelTasks)) {
      if (this.processing.has(task.id)) continue;

      const agent = task.toAgent ? this.agentRegistry.getAgent(task.toAgent) : undefined;

      if (agent && agent.status === 'idle') {
        const promise = this.executeTask(task, agent);
        this.processing.set(task.id, promise);

        promise.finally(() => {
          this.processing.delete(task.id);
        });
      }
    }
  }

  shutdown(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
    logger.info('Agent Orchestrator shutdown');
  }

  getStatus(): {
    agents: SwarmAgent[];
    pendingTasks: number;
    processingTasks: number;
  } {
    return {
      agents: this.agentRegistry.getAllAgents(),
      pendingTasks: this.taskQueue.getTasksByStatus('pending').length,
      processingTasks: this.processing.size,
    };
  }

  getTaskQueue(): TaskQueue {
    return this.taskQueue;
  }

  getMessenger(): Messenger {
    return this.messenger;
  }

  getMemory(): SharedMemory {
    return this.memory;
  }

  getAgentRegistry(): AgentRegistry {
    return this.agentRegistry;
  }
}
