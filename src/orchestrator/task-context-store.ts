import { TaskPlan } from './types.js';
import { logger } from '../logger.js';

interface ClarificationRequest {
  taskId: string;
  subtaskId: string;
  fromAgent: string;
  question: string;
  resolve: (answer: string) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface TaskContext {
  taskId: string;
  plan: TaskPlan;
  completedSubtasks: Map<string, string>;
  artifacts: Map<string, string>;
  pendingClarifications: Map<string, ClarificationRequest>;
  createdAt: number;
}

export class TaskContextStore {
  private contexts = new Map<string, TaskContext>();
  private readonly TASK_TTL_MS = 3600000; // 1 hour
  private sweepInterval: ReturnType<typeof setInterval> | undefined;

  /** Start a single periodic sweep that expires old task contexts. */
  startSweep(): void {
    if (this.sweepInterval) return;
    // Run every 5 minutes; unref so it doesn't keep the process alive
    this.sweepInterval = setInterval(() => this.sweep(), 5 * 60 * 1000);
    this.sweepInterval.unref?.();
  }

  stopSweep(): void {
    if (this.sweepInterval) {
      clearInterval(this.sweepInterval);
      this.sweepInterval = undefined;
    }
  }

  private sweep(): void {
    const now = Date.now();
    for (const [taskId, ctx] of this.contexts) {
      if (now - ctx.createdAt > this.TASK_TTL_MS) {
        logger.info({ taskId }, 'Task context expired, cleaning up');
        this.cleanup(taskId);
      }
    }
  }

  create(taskId: string, plan: TaskPlan): TaskContext {
    const context: TaskContext = {
      taskId,
      plan,
      completedSubtasks: new Map(),
      artifacts: new Map(),
      pendingClarifications: new Map(),
      createdAt: Date.now(),
    };

    this.contexts.set(taskId, context);
    logger.info({ taskId, subtaskCount: plan.subtasks.length }, 'Task context created');
    return context;
  }

  get(taskId: string): TaskContext | undefined {
    return this.contexts.get(taskId);
  }

  recordResult(taskId: string, subtaskId: string, result: string): void {
    const context = this.contexts.get(taskId);
    if (!context) {
      logger.warn({ taskId, subtaskId }, 'Task context not found');
      return;
    }

    context.completedSubtasks.set(subtaskId, result);
    logger.debug({ taskId, subtaskId, resultLength: result.length }, 'Subtask result recorded');
  }

  recordArtifact(taskId: string, key: string, summary: string): void {
    const context = this.contexts.get(taskId);
    if (!context) {
      logger.warn({ taskId, key }, 'Task context not found');
      return;
    }

    context.artifacts.set(key, summary);
    logger.debug({ taskId, key, summaryLength: summary.length }, 'Artifact recorded');
  }

  getReadySubtasks(taskId: string) {
    const context = this.contexts.get(taskId);
    if (!context) {
      return [];
    }

    const completedSubtaskIds = Array.from(context.completedSubtasks.keys());

    return context.plan.subtasks.filter(subtask => {
      if (context.completedSubtasks.has(subtask.id)) {
        return false;
      }

      const allDepsComplete = subtask.deps.every(dep => 
        completedSubtaskIds.includes(dep)
      );

      return allDepsComplete;
    });
  }

  isComplete(taskId: string): boolean {
    const context = this.contexts.get(taskId);
    if (!context) {
      return false;
    }

    return context.plan.subtasks.every(subtask => 
      context.completedSubtasks.has(subtask.id)
    );
  }

  getCompletedResults(taskId: string): Map<string, string> {
    const context = this.contexts.get(taskId);
    return context ? new Map(context.completedSubtasks) : new Map();
  }

  cleanup(taskId: string): void {
    const context = this.contexts.get(taskId);
    if (!context) {
      return;
    }

    for (const [key, clarification] of context.pendingClarifications) {
      clearTimeout(clarification.timeout);
      clarification.resolve('[no answer - proceeding with best guess]');
    }

    this.contexts.delete(taskId);
    logger.info({ taskId }, 'Task context cleaned up');
  }

  cleanupAll(): void {
    for (const [taskId] of this.contexts) {
      this.cleanup(taskId);
    }
    logger.info({ count: this.contexts.size }, 'All task contexts cleaned up');
  }
}
