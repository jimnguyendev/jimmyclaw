import { Database } from 'bun:sqlite';
import { TaskQueue } from './task-queue.js';
import { AgentRegistry } from './agent-registry.js';
import { Messenger } from './messenger.js';
import { SharedMemory } from './memory.js';
import { AgentRoleRegistry } from './role-registry.js';
import { TaskPlanner } from './task-planner.js';
import { TaskContextStore } from './task-context-store.js';
import { ProgressReporter } from './progress-reporter.js';
import { ClarificationHandler } from './clarification-handler.js';
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
import {
  ChannelMessenger,
  DiscordChannelMessenger,
  TelegramChannelMessenger,
  ParsedChannelMessage,
  ChannelMessengerConfig,
} from './channel-messenger.js';
import { logger } from '../logger.js';
import { getRoles } from '../swarm-config.js';

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
  private channelMessenger: ChannelMessenger | null = null;
  private localAgents: Set<string>;
  private pendingChannelTasks: Map<string, { resolve: (result: ProcessResult) => void; reject: (err: Error) => void }> = new Map();
  private roleRegistry: AgentRoleRegistry = new AgentRoleRegistry();
  private taskPlanner!: TaskPlanner;
  private taskContextStore: TaskContextStore = new TaskContextStore();
  private progressReporter: ProgressReporter = new ProgressReporter();
  private clarificationHandler: ClarificationHandler = new ClarificationHandler();

  constructor(rawDb: Database, config: Partial<OrchestratorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.taskQueue = new TaskQueue(rawDb);
    this.agentRegistry = new AgentRegistry(rawDb);
    this.messenger = new Messenger(rawDb);
    this.memory = new SharedMemory(rawDb);
    
    this.localAgents = new Set(this.config.instance?.localAgents || [
      this.config.leader.id,
      ...this.config.workers.map(w => w.id),
    ]);
    
  }

  initialize(): void {
    this.agentRegistry.initializeDefaultAgents();
    const roles = getRoles();
    this.roleRegistry.loadFromConfig(roles);
    this.taskPlanner = new TaskPlanner(
      this.config.leader.model,
      [this.config.leader, ...this.config.workers],
      roles,
    );
    this.taskContextStore.startSweep();
    this.progressReporter.startCleanup();
    this.startHealthMonitor();
    this.startTaskPoller();

    if (this.config.teamChannel?.enabled && this.config.teamChannel.channelId) {
      this.initializeChannelMessenger();
    }

    logger.info('Agent Orchestrator initialized');
  }

  private async initializeChannelMessenger(): Promise<void> {
    if (!this.config.teamChannel) return;

    const allAgents = [
      { id: this.config.leader.id, role: 'leader' },
      ...this.config.workers.map(w => ({ id: w.id, role: w.role })),
    ];

    const agentsWithTokens: Array<{ id: string; botToken: string }> = [];

    for (const agent of allAgents) {
      const envKey = `DISCORD_BOT_TOKEN_${agent.id.toUpperCase()}`;
      const token = process.env[envKey];
      if (token && token.length > 0) {
        agentsWithTokens.push({ id: agent.id, botToken: token });
      } else {
        logger.warn(
          { agentId: agent.id, role: agent.role, expectedEnv: envKey },
          'Missing bot token for agent, will not participate in channel messaging',
        );
      }
    }

    if (agentsWithTokens.length === 0) {
      logger.warn('No bot tokens configured for any agent, channel messenger disabled');
      return;
    }

    const channelConfig: ChannelMessengerConfig = {
      platform: this.config.teamChannel.platform,
      channelId: this.config.teamChannel.channelId,
      agents: agentsWithTokens,
    };

    try {
      if (this.config.teamChannel.platform === 'discord') {
        this.channelMessenger = new DiscordChannelMessenger(channelConfig);
        await (this.channelMessenger as DiscordChannelMessenger).connect();
      } else if (this.config.teamChannel.platform === 'telegram') {
        this.channelMessenger = new TelegramChannelMessenger(channelConfig);
        await (this.channelMessenger as TelegramChannelMessenger).connect();
      }
      
      if (this.channelMessenger) {
        this.channelMessenger.startListening((msg) => this.handleChannelMessage(msg));
        this.progressReporter.setChannelSender(this.channelMessenger);
        logger.info({ platform: this.config.teamChannel.platform }, 'Channel messenger initialized');
      }
    } catch (err) {
      logger.error({ err }, 'Failed to initialize channel messenger');
    }
  }

  private handleChannelMessage(msg: ParsedChannelMessage): void {
    if (msg.fromHuman) {
      this.handleHumanInterruption(msg);
      return;
    }

    const payload = msg.nanoclawPayload;
    if (payload) {
      this.handleNanoclawMessage(msg, payload);
      return;
    }

    for (const mention of msg.mentions) {
      if (this.localAgents.has(mention) && msg.taskType === 'done') {
        const pending = this.pendingChannelTasks.get(msg.taskId || '');
        if (pending) {
          this.pendingChannelTasks.delete(msg.taskId || '');
          pending.resolve({
            success: true,
            result: msg.content,
            taskId: msg.taskId || '',
            agentId: msg.fromAgent || 'unknown',
          });
        }
      }
    }
  }

  private handleNanoclawMessage(msg: ParsedChannelMessage, payload: Record<string, any>): void {
    switch (msg.taskType) {
      case 'assign':
        this.handleAssignMessage(msg, payload);
        break;
      case 'ask':
        this.handleAskMessage(msg, payload);
        break;
      case 'answer':
        this.handleAnswerMessage(msg, payload);
        break;
      case 'status':
      case 'plan':
      case 'artifact':
        logger.debug({ taskType: msg.taskType, fromAgent: msg.fromAgent }, 'Nanoclaw message type received');
        break;
      case 'done':
        if (msg.taskId) {
          const pending = this.pendingChannelTasks.get(msg.taskId);
          if (pending) {
            this.pendingChannelTasks.delete(msg.taskId);
            pending.resolve({
              success: true,
              result: payload.result || msg.content,
              taskId: msg.taskId,
              agentId: msg.fromAgent || 'unknown',
            });
          }
        }
        break;
      default:
        logger.warn({ taskType: msg.taskType }, 'Unknown nanoclaw message type');
    }
  }

  private handleAskMessage(msg: ParsedChannelMessage, payload: Record<string, any>): void {
    if (msg.fromHuman) return;
    
    const { taskId, subtaskId, question } = payload;
    logger.info({ taskId, subtaskId, fromAgent: msg.fromAgent, question: question?.slice(0, 100) }, 'Ask message received from agent');
    
    if (this.channelMessenger) {
      const questionText = `🤔 **${msg.fromAgent} needs clarification**:\n\n${question || 'Question not specified'}\n\nPlease reply to help ${msg.fromAgent} proceed.`;
      this.channelMessenger.sendAsAgent(msg.fromAgent, questionText).catch(err =>
        logger.error({ err }, 'Failed to send clarification question to channel')
      );
    }
  }

  private handleAnswerMessage(msg: ParsedChannelMessage, payload: Record<string, any>): void {
    if (msg.fromHuman) return;
    
    const { taskId, subtaskId, answer } = payload;
    logger.info({ taskId, subtaskId, fromAgent: msg.fromAgent, answer: answer?.slice(0, 100) }, 'Answer message received');
    
    if (taskId) {
      const wasResolved = this.clarificationHandler.handleAnswer(taskId, answer || '');
      if (!wasResolved) {
        logger.warn({ taskId }, 'No pending clarification found for answer');
      }
    }
  }

  private handleAssignMessage(msg: ParsedChannelMessage, payload: Record<string, any>): void {
    const { taskId, subtaskId, toAgent, description } = payload;
    logger.info({ taskId, subtaskId, toAgent, description, fromAgent: msg.fromAgent }, 'Assign message received');
    
    const targetAgent = this.agentRegistry.getAgent(toAgent);
    
    if (!targetAgent) {
      logger.warn({ toAgent }, 'Target agent not found in registry');
      return;
    }
    
    const taskType = this.roleMap(targetAgent.role);
    
    const subtask = this.taskQueue.createTask({
      type: taskType as any,
      prompt: description,
      fromAgent: msg.fromAgent || this.config.leader.id,
      toAgent: targetAgent.id,
      parentTaskId: taskId,
    });
    
    if (this.localAgents.has(targetAgent.id)) {
      logger.info({ subtaskId, targetAgent: targetAgent.id }, 'Assigning subtask locally');
      this.agentRegistry.updateStatus(targetAgent.id, 'busy');
      this.agentRegistry.setCurrentTask(targetAgent.id, subtask.id);
      this.executeTask(subtask, targetAgent)
        .then(result => {
          if (this.channelMessenger && taskId) {
            const payloadResult = { result: result.result, subtaskId };
            this.channelMessenger.sendAsAgent(targetAgent.id, `[nanoclaw:done] ${JSON.stringify(payloadResult)}`).catch(err =>
              logger.error({ err }, 'Failed to send done message'),
            );
          }
        })
        .catch(err => {
          logger.error({ err, targetAgent: targetAgent.id, subtaskId }, 'Subtask execution failed');
          if (this.channelMessenger && taskId) {
            const payloadResult = { error: err instanceof Error ? err.message : String(err), subtaskId };
            this.channelMessenger.sendAsAgent(targetAgent.id, `[nanoclaw:done] ${JSON.stringify(payloadResult)}`).catch(e =>
              logger.error({ e }, 'Failed to send error message'),
            );
          }
        });
    } else if (this.channelMessenger) {
      logger.info({ subtaskId, targetAgent: targetAgent.id }, 'Assigning subtask via channel');
      this.delegateViaChannel(subtask, targetAgent.id, subtaskId)
        .then(result => {
          if (result.success && this.channelMessenger && taskId) {
            const payloadResult = { result: result.result, subtaskId };
            this.channelMessenger.sendAsAgent(targetAgent.id, `[nanoclaw:done] ${JSON.stringify(payloadResult)}`).catch(err =>
              logger.error({ err }, 'Failed to send done message'),
            );
          }
        })
        .catch(err => {
          logger.error({ err, targetAgent: targetAgent.id, subtaskId }, 'Channel subtask delegation failed');
        });
    }
  }

  private handleHumanInterruption(msg: ParsedChannelMessage): void {
    logger.info(
      { mentions: msg.mentions, content: msg.content.slice(0, 100) },
      'Human interruption in team channel',
    );

    const content = msg.content.toLowerCase();
    const isStopCommand = 
      content.includes('dừng') ||
      content.includes('stop') ||
      content.includes('cancel') ||
      content.includes('hủy');

    if (isStopCommand && msg.mentions.length > 0) {
      for (const mention of msg.mentions) {
        if (mention === this.config.leader.id) {
          this.cancelAllPendingTasks();
          logger.info('All pending tasks cancelled by human interruption');
        } else {
          this.cancelAgentTasks(mention);
        }
      }
      return;
    }

    if (msg.mentions.includes(this.config.leader.id)) {
      logger.info({ content: msg.content.slice(0, 100) }, 'Human message to leader - treating as new task');
    }

    if (this.clarificationHandler.getPendingCount() > 0) {
      const wasResolved = this.clarificationHandler.handleAnswer(msg.taskId || '', msg.content);
      if (wasResolved) {
        logger.info({ taskId: msg.taskId }, 'Human message treated as clarification answer');
      }
    }
  }

  private cancelAllPendingTasks(): void {
    for (const [taskId, pending] of this.pendingChannelTasks) {
      this.taskQueue.failTask(taskId, 'Cancelled by human interruption');
      pending.resolve({
        success: false,
        error: 'Cancelled by human interruption',
        taskId,
        agentId: 'unknown',
      });
    }
    this.pendingChannelTasks.clear();
  }

  private cancelAgentTasks(agentId: string): void {
    const tasksToCancel: string[] = [];
    for (const [taskId] of this.pendingChannelTasks) {
      const task = this.taskQueue.getTask(taskId);
      if (task && task.toAgent === agentId) {
        tasksToCancel.push(taskId);
      }
    }

    for (const taskId of tasksToCancel) {
      const pending = this.pendingChannelTasks.get(taskId);
      if (pending) {
        this.taskQueue.failTask(taskId, `Cancelled by human - agent ${agentId} interrupted`);
        pending.resolve({
          success: false,
          error: `Cancelled by human - agent ${agentId} interrupted`,
          taskId,
          agentId,
        });
        this.pendingChannelTasks.delete(taskId);
      }
    }
  }

  classifyTask(prompt: string): TaskClassification {
    const classifiedRole = this.roleRegistry.classifyTask(prompt);
    
    const roleMap: Record<string, TaskClassification['type']> = {
      leader: 'general',
      researcher: 'research',
      coder: 'code',
      reviewer: 'review',
      writer: 'write',
    };
    
    const type = roleMap[classifiedRole] || 'general';
    const agent = this.agentRegistry.selectBestAgentForTask(type);

    return {
      type,
      confidence: 0.7,
      suggestedAgent: agent?.id || classifiedRole,
    };
  }

  private isComplexTask(prompt: string): boolean {
    const wordCount = prompt.split(/\s+/).length;
    const complexKeywords = ['and', 'then', 'also', 'furthermore', 'additionally', 'moreover', 'và', 'sau đó', 'cũng'];
    const hasComplexStructure = complexKeywords.some(keyword => 
      prompt.toLowerCase().includes(keyword)
    );
    
    return wordCount > 50 || hasComplexStructure;
  }

  private async processComplexTask(
    prompt: string,
    context: {
      userId?: string;
      chatJid?: string;
    } = {},
  ): Promise<ProcessResult> {
    const plan = await this.taskPlanner.plan(prompt, [this.config.leader, ...this.config.workers]);

    logger.info({ taskId: plan.taskId, subtaskCount: plan.subtasks.length }, 'Processing complex task with plan');

    this.taskContextStore.create(plan.taskId, plan);

    // Keep dispatching waves of ready subtasks until the entire plan is complete.
    // Each iteration: run all currently-ready subtasks in parallel, record results,
    // then check whether newly-unlocked subtasks became ready.
    while (!this.taskContextStore.isComplete(plan.taskId)) {
      const readySubtasks = this.taskContextStore.getReadySubtasks(plan.taskId);

      if (readySubtasks.length === 0) {
        // No subtasks ready and plan not complete — dependency graph is broken or a
        // subtask failed without being recorded.  Bail out to avoid infinite loop.
        logger.warn({ taskId: plan.taskId }, 'No ready subtasks but plan not complete, aborting');
        break;
      }

      // Run ready subtasks in parallel
      const wave = await Promise.all(
        readySubtasks.map(subtask => this.executeSubtask(subtask, plan, context)),
      );

      // Record every result (success or failure) so dependency tracking advances
      for (let i = 0; i < readySubtasks.length; i++) {
        const subtask = readySubtasks[i];
        const result = wave[i];
        const value = result.success ? (result.result || '') : `[ERROR] ${result.error || 'unknown'}`;
        this.taskContextStore.recordResult(plan.taskId, subtask.id, value);
        logger.debug({ taskId: plan.taskId, subtaskId: subtask.id, success: result.success }, 'Subtask result recorded');
      }
    }

    const completedResults = this.taskContextStore.getCompletedResults(plan.taskId);
    const allValues = Array.from(completedResults.values());
    const hasErrors = allValues.some(v => v.startsWith('[ERROR]'));

    return {
      success: !hasErrors,
      result: this.synthesizeResults(plan, allValues),
      taskId: plan.taskId,
      agentId: this.config.leader.id,
      ...(hasErrors ? { error: 'One or more subtasks failed' } : {}),
    };
  }

  private async executeSubtask(
    subtask: any,
    plan: any,
    context: { userId?: string; chatJid?: string } = {},
  ): Promise<ProcessResult> {
    const task = this.taskQueue.createTask({
      type: this.roleMap(subtask.role) as any,
      prompt: subtask.description,
      fromAgent: this.config.leader.id,
      userId: context.userId,
      chatJid: context.chatJid,
    });

    const agent = this.agentRegistry.getAgentByRole(subtask.role);
    
    if (!agent) {
      return {
        success: false,
        error: `No agent found for role: ${subtask.role}`,
        taskId: task.id,
        agentId: 'unknown',
      };
    }

    this.agentRegistry.updateStatus(agent.id, 'busy');
    this.agentRegistry.setCurrentTask(agent.id, task.id);
    
    return this.executeTask(task, agent);
  }

  private roleMap(role: string): string {
    const map: Record<string, string> = {
      leader: 'general',
      researcher: 'research',
      coder: 'code',
      reviewer: 'review',
      writer: 'write',
    };
    return map[role] || 'general';
  }

  private synthesizeResults(plan: any, results: string[]): string {
    return results.join('\n\n---\n\n');
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

    const isComplex = this.isComplexTask(prompt);

    if (isComplex) {
      logger.info({ prompt: prompt.slice(0, 100) }, 'Task is complex, using TaskPlanner');
      return this.processComplexTask(prompt, context);
    }

    const task = this.taskQueue.createTask({
      type: classification.type,
      prompt,
      fromAgent: this.config.leader.id,
      toAgent: classification.suggestedAgent,
      userId: context.userId,
      chatJid: context.chatJid,
    });

    this.messenger.sendMessage({
      fromAgent: this.config.leader.id,
      toAgent: classification.suggestedAgent,
      type: 'task_assign',
      content: JSON.stringify({ taskId: task.id, prompt }),
      taskId: task.id,
    });

    if (this.localAgents.has(classification.suggestedAgent)) {
      const agent = this.agentRegistry.getAgent(classification.suggestedAgent);
      if (!agent) {
        logger.error({ suggestedAgent: classification.suggestedAgent }, 'Agent not found in registry');
        this.taskQueue.failTask(task.id, `Agent ${classification.suggestedAgent} not found`);
        return {
          success: false,
          error: `Agent ${classification.suggestedAgent} not found in registry`,
          taskId: task.id,
          agentId: classification.suggestedAgent,
        };
      }
      this.agentRegistry.updateStatus(agent.id, 'busy');
      this.agentRegistry.setCurrentTask(agent.id, task.id);
      return this.executeTask(task, agent);
    } else if (this.channelMessenger) {
      return this.delegateViaChannel(task, classification.suggestedAgent);
    } else {
      const agent = this.agentRegistry.getAgent(classification.suggestedAgent);
      if (!agent) {
        logger.error({ suggestedAgent: classification.suggestedAgent }, 'Agent not found in registry');
        this.taskQueue.failTask(task.id, `Agent ${classification.suggestedAgent} not found`);
        return {
          success: false,
          error: `Agent ${classification.suggestedAgent} not found in registry`,
          taskId: task.id,
          agentId: classification.suggestedAgent,
        };
      }
      this.agentRegistry.updateStatus(agent.id, 'busy');
      this.agentRegistry.setCurrentTask(agent.id, task.id);
      return this.executeTask(task, agent);
    }
  }

  private async delegateViaChannel(task: SwarmTask, targetAgent: string, subtaskId?: string): Promise<ProcessResult> {
    if (!this.channelMessenger) {
      return {
        success: false,
        error: 'Channel messenger not initialized',
        taskId: task.id,
        agentId: targetAgent,
      };
    }

    const taskType = task.type === 'research' ? 'research' :
                     task.type === 'code' ? 'code' :
                     task.type === 'review' ? 'review' : 'general';

    const message = `@${targetAgent} [${taskType}] #${subtaskId || task.id} ${task.prompt}`;

    try {
      await this.channelMessenger.sendAsAgent(this.config.leader.id, message);
      logger.info({ taskId: task.id, targetAgent }, 'Task delegated via channel');

      const reply = await this.channelMessenger.waitForReply({
        fromAgent: targetAgent,
        taskId: task.id,
        timeoutMs: task.timeoutMs,
      });

      if (reply) {
        this.taskQueue.completeTask(task.id, reply.content, 0, 0);
        return {
          success: true,
          result: reply.content,
          taskId: task.id,
          agentId: targetAgent,
        };
      }

      // Timeout — thử fallback local agent cùng role
      logger.warn({ taskId: task.id, targetAgent }, 'Remote agent timeout, attempting fallback');
      const fallbackAgent = this.findLocalAgentByRole(this.getAgentRole(targetAgent));
      if (fallbackAgent) {
        logger.info({ taskId: task.id, fallbackAgent: fallbackAgent.id }, 'Falling back to local agent');
        this.agentRegistry.updateStatus(fallbackAgent.id, 'busy');
        this.agentRegistry.setCurrentTask(fallbackAgent.id, task.id);
        return await this.executeTask(task, fallbackAgent);
      }

      this.taskQueue.failTask(task.id, 'Timeout waiting for remote agent and no local fallback available');
      return {
        success: false,
        error: 'Timeout waiting for remote agent response and no local fallback available',
        taskId: task.id,
        agentId: targetAgent,
      };
    } catch (err) {
      logger.error({ err, taskId: task.id }, 'Failed to delegate via channel');
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Channel delegation failed',
        taskId: task.id,
        agentId: targetAgent,
      };
    }
  }

  private getAgentRole(agentId: string): AgentRole {
    if (this.config.leader.id === agentId) {
      return this.config.leader.role;
    }
    const worker = this.config.workers.find(w => w.id === agentId);
    if (worker) {
      return worker.role;
    }
    const agent = this.agentRegistry.getAgent(agentId);
    return agent?.role || 'researcher';
  }

  private findLocalAgentByRole(role: AgentRole): SwarmAgent | undefined {
    const localAgents = this.agentRegistry.getAllAgents().filter(
      agent => this.localAgents.has(agent.id) && agent.role === role && agent.status === 'idle'
    );
    
    if (localAgents.length === 0) {
      return undefined;
    }
    
    return localAgents.reduce((best, current) => 
      current.successCount / Math.max(current.totalTasks, 1) > 
      best.successCount / Math.max(best.totalTasks, 1) ? current : best
    );
  }

  private async executeTask(task: SwarmTask, agent?: SwarmAgent): Promise<ProcessResult> {
    const startTime = Date.now();
    const agentId = agent?.id || 'unknown';

    try {
      this.taskQueue.startTask(task.id);
      
      await this.progressReporter.report(agentId, task.id, 'thinking');
      await this.progressReporter.report(agentId, task.id, 'working', task.prompt.slice(0, 50));

      const result = await this.callModel(
        agent?.model || 'gemini-2.0-flash',
        task.prompt,
        agent?.role,
        task.context,
      );

      const duration = Date.now() - startTime;

      if (result.success) {
        await this.progressReporter.report(agentId, task.id, 'done');
        
        this.taskQueue.completeTask(task.id, result.result || '', result.tokensUsed, result.cost);
        this.messenger.sendMessage({
          fromAgent: agent?.id || 'unknown',
          toAgent: this.config.leader.id,
          type: 'task_result',
          content: result.result || '',
          taskId: task.id,
        });

        if (this.channelMessenger && task.fromAgent !== this.config.leader.id) {
          this.sendChannelResult(
            agent?.id || 'unknown',
            task.fromAgent,
            task.id,
            result.result || '',
          ).catch(err => logger.error({ err }, 'Failed to send channel result'));
        }

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
        toAgent: this.config.leader.id,
        type: 'task_failed',
        content: errorMessage,
        taskId: task.id,
      });

      if (this.channelMessenger && task.fromAgent !== this.config.leader.id) {
        this.sendChannelResult(
          agent?.id || 'unknown',
          task.fromAgent,
          task.id,
          `[failed] ${errorMessage}`,
        ).catch(err => logger.error({ err }, 'Failed to send channel failure'));
      }

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
    agentRole?: string,
    context?: string,
    systemPrompt?: string,
  ): Promise<{ success: boolean; result?: string; error?: string; tokensUsed?: number; cost?: number }> {
    try {
      const fullPrompt = context ? `Context:\n${context}\n\nTask:\n${prompt}` : prompt;

      const role = agentRole ? this.roleRegistry.getRole(agentRole) : undefined;
      const roleDefaultPrompt = role?.defaultPrompt;
      const combinedSystemPrompt = roleDefaultPrompt && systemPrompt
        ? `${roleDefaultPrompt}\n\n${systemPrompt}`
        : roleDefaultPrompt || systemPrompt;

      const response = await llmProvider.generate(
        { provider: 'opencode', model, timeoutMs: 120000 },
        fullPrompt,
        combinedSystemPrompt,
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
    agentRole?: string,
    agentId?: string,
    context?: string,
    systemPrompt?: string,
  ): AsyncGenerator<{ content: string; done: boolean }> {
    const fullPrompt = context ? `Context:\n${context}\n\nTask:\n${prompt}` : prompt;
 
    try {
      const role = agentRole ? this.roleRegistry.getRole(agentRole) : undefined;
      const roleDefaultPrompt = role?.defaultPrompt;
      const combinedSystemPrompt = roleDefaultPrompt && systemPrompt
        ? `${roleDefaultPrompt}\n\n${systemPrompt}`
        : roleDefaultPrompt || systemPrompt;
 
      if (agentId && this.channelMessenger?.sendTypingIndicator) {
        this.channelMessenger.sendTypingIndicator(agentId).catch(err => 
          logger.debug({ agentId, err }, 'Failed to send typing indicator')
        );
      }

      for await (const chunk of llmProvider.generateStream(
        { provider: 'opencode', model, timeoutMs: 120000 },
        fullPrompt,
        combinedSystemPrompt,
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
        // Wrap task execution with timeout to prevent hanging promises
        const timeoutMs = task.timeoutMs || this.config.taskTimeoutMs;
        const promise = this.executeTaskWithTimeout(task, agent, timeoutMs);
        this.processing.set(task.id, promise);

        promise.finally(() => {
          this.processing.delete(task.id);
        });
      }
    }
  }

  private async executeTaskWithTimeout(task: SwarmTask, agent: SwarmAgent, timeoutMs: number): Promise<ProcessResult> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        logger.warn({ taskId: task.id, timeoutMs }, 'Task execution timed out');
        this.taskQueue.timeoutTask(task.id);
        if (agent) {
          this.agentRegistry.updateStatus(agent.id, 'idle');
          this.agentRegistry.setCurrentTask(agent.id, undefined);
        }
        resolve({
          success: false,
          error: 'Task execution timed out',
          taskId: task.id,
          agentId: agent?.id || 'unknown',
        });
      }, timeoutMs);

      this.executeTask(task, agent)
        .then(resolve)
        .finally(() => clearTimeout(timer));
    });
  }

  async shutdown(): Promise<void> {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = undefined;
    }

    // Reject all pending channel tasks
    for (const [taskId, { reject }] of this.pendingChannelTasks) {
      reject(new Error('Orchestrator shutting down'));
      this.taskQueue.failTask(taskId, 'Orchestrator shutting down');
    }
    this.pendingChannelTasks.clear();

    // Wait for processing tasks to complete with timeout
    const processingPromises = Array.from(this.processing.values());
    if (processingPromises.length > 0) {
      await Promise.race([
        Promise.allSettled(processingPromises),
        new Promise(resolve => setTimeout(resolve, 5000)),
      ]);
    }
    this.processing.clear();

    if (this.channelMessenger) {
      this.channelMessenger.stopListening();
      await this.channelMessenger.disconnect();
      this.progressReporter.setChannelSender(null);
    }
    this.taskContextStore.stopSweep();
    this.progressReporter.stopCleanup();
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

  getChannelMessenger(): ChannelMessenger | null {
    return this.channelMessenger;
  }

  async sendChannelResult(fromAgent: string, toAgent: string, taskId: string, result: string): Promise<void> {
    if (!this.channelMessenger) return;
    
    const message = `@${toAgent} [done] #${taskId} ${result}`;
    await this.channelMessenger.sendAsAgent(fromAgent, message);
  }

  getMemory(): SharedMemory {
    return this.memory;
  }

  getAgentRegistry(): AgentRegistry {
    return this.agentRegistry;
  }
}
