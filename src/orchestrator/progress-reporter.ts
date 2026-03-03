import { logger } from '../logger.js';

export interface ProgressChannelSender {
  sendAsAgent(agentId: string, text: string): Promise<void>;
}

export class ProgressReporter {
  private lastReport = new Map<string, number>();
  private readonly THROTTLE_MS = 3000;
  private cleanupInterval: ReturnType<typeof setInterval> | undefined;
  private channelSender: ProgressChannelSender | null = null;

  setChannelSender(sender: ProgressChannelSender | null): void {
    this.channelSender = sender;
  }

  async report(
    agentId: string,
    taskId: string,
    status: 'thinking' | 'working' | 'done',
    detail?: string,
  ): Promise<void> {
    const now = Date.now();
    const last = this.lastReport.get(agentId) ?? 0;

    if (now - last < this.THROTTLE_MS && status !== 'done') {
      logger.debug({ agentId, taskId, status }, 'Progress report throttled');
      return;
    }

    this.lastReport.set(agentId, now);
    logger.info({ agentId, taskId, status, detail }, 'Progress update');

    if (this.channelSender) {
      const payload = JSON.stringify({ taskId, fromAgent: agentId, status, ...(detail ? { detail } : {}) });
      const text = `[nanoclaw:status] ${payload}`;
      this.channelSender.sendAsAgent(agentId, text).catch(err =>
        logger.debug({ err, agentId, status }, 'Failed to send progress to channel'),
      );
    }

    if (status === 'done') {
      this.lastReport.delete(agentId);
    }
  }

  startCleanup(): void {
    // Sweep stale entries (agents that never posted 'done') every 10 minutes
    this.cleanupInterval = setInterval(() => {
      const cutoff = Date.now() - 10 * 60 * 1000;
      for (const [agentId, ts] of this.lastReport) {
        if (ts < cutoff) this.lastReport.delete(agentId);
      }
    }, 10 * 60 * 1000);
    this.cleanupInterval.unref?.();
  }

  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
  }

  reset(agentId: string): void {
    this.lastReport.delete(agentId);
  }

  resetAll(): void {
    this.lastReport.clear();
  }
}
