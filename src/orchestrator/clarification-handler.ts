import { logger } from '../logger.js';

export interface ClarificationRequest {
  taskId: string;
  subtaskId: string;
  fromAgent: string;
  question: string;
  resolve: (answer: string) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class ClarificationHandler {
  private pending = new Map<string, ClarificationRequest>();
  private readonly DEFAULT_TIMEOUT_MS = 300000;

  async ask(
    taskId: string,
    subtaskId: string,
    fromAgent: string,
    question: string,
    timeoutMs: number = this.DEFAULT_TIMEOUT_MS,
  ): Promise<string> {
    return new Promise((resolve) => {
      const requestKey = `${taskId}:${subtaskId}`;
      
      if (this.pending.has(requestKey)) {
        logger.warn({ requestKey, fromAgent }, 'Clarification already pending, cancelling old one');
        const existing = this.pending.get(requestKey)!;
        clearTimeout(existing.timeout);
        existing.resolve('[cancelled - new question asked]');
      }

      const timeout = setTimeout(() => {
        const request = this.pending.get(requestKey);
        if (request) {
          logger.info({ taskId, subtaskId, fromAgent }, 'Clarification timeout, proceeding with best guess');
          this.pending.delete(requestKey);
          resolve('[no answer - proceeding with best guess]');
        }
      }, timeoutMs);

      const clarificationRequest: ClarificationRequest = {
        taskId,
        subtaskId,
        fromAgent,
        question,
        resolve,
        timeout,
      };

      this.pending.set(requestKey, clarificationRequest);
      logger.info({ taskId, subtaskId, fromAgent, question: question.slice(0, 100) }, 'Clarification question asked');
    });
  }

  handleAnswer(taskId: string, answer: string): boolean {
    // Collect all pending clarifications for this taskId
    const matching: Array<[string, ClarificationRequest]> = [];
    for (const [key, request] of this.pending) {
      if (key.startsWith(`${taskId}:`)) {
        matching.push([key, request]);
      }
    }

    if (matching.length === 0) return false;

    if (matching.length > 1) {
      logger.warn(
        { taskId, count: matching.length, subtaskIds: matching.map(([, r]) => r.subtaskId) },
        'Multiple pending clarifications for task — resolving the oldest one. Use handleAnswerForSubtask() to target a specific subtask.',
      );
    }

    // Resolve the oldest pending clarification (first inserted in Map iteration order)
    const [key, request] = matching[0];
    logger.info({ taskId, subtaskId: request.subtaskId, answer: answer.slice(0, 100) }, 'Clarification answer received');
    clearTimeout(request.timeout);
    request.resolve(answer);
    this.pending.delete(key);
    return true;
  }

  handleAnswerForSubtask(taskId: string, subtaskId: string, answer: string): boolean {
    const requestKey = `${taskId}:${subtaskId}`;
    const request = this.pending.get(requestKey);
    
    if (request) {
      logger.info({ taskId, subtaskId, answer: answer.slice(0, 100) }, 'Clarification answer received');
      
      clearTimeout(request.timeout);
      request.resolve(answer);
      this.pending.delete(requestKey);
      return true;
    }
    
    return false;
  }

  cancelAll(taskId: string): void {
    for (const [key, request] of this.pending) {
      if (key.startsWith(`${taskId}:`)) {
        clearTimeout(request.timeout);
        request.resolve('[cancelled - task cancelled]');
        this.pending.delete(key);
        logger.info({ taskId, subtaskId: request.subtaskId }, 'Clarification cancelled due to task cancellation');
      }
    }
  }

  getPendingCount(taskId?: string): number {
    if (!taskId) {
      return this.pending.size;
    }
    
    let count = 0;
    for (const key of this.pending.keys()) {
      if (key.startsWith(`${taskId}:`)) {
        count++;
      }
    }
    return count;
  }

  cleanup(): void {
    for (const [key, request] of this.pending) {
      clearTimeout(request.timeout);
      request.resolve('[cancelled - cleanup]');
    }
    this.pending.clear();
    logger.info('All pending clarifications cleaned up');
  }
}
