/**
 * Session Queue - Per-session message queue with serialization
 */

import { Lane } from './lane.js';

export type QueueMode = 'queue' | 'followup' | 'interrupt';
export type DropPolicy = 'old' | 'new';

export interface QueueConfig {
  mode: QueueMode;
  cap: number;
  drop: DropPolicy;
  debounceMs: number;
  maxConcurrent: number;
}

export interface QueueItem<T> {
  id: string;
  data: T;
  resolve: (value: T) => void;
  reject: (err: Error) => void;
  enqueuedAt: Date;
}

export type RunFunc<T> = (item: T, runId: string) => Promise<T>;

export interface ActiveRun {
  runId: string;
  cancel: () => void;
  generation: number;
}

const DEFAULT_CONFIG: QueueConfig = {
  mode: 'queue',
  cap: 10,
  drop: 'old',
  debounceMs: 800,
  maxConcurrent: 1,
};

export class SessionQueue<T = unknown> {
  private sessionKey: string;
  private laneName: string;
  private config: QueueConfig;
  private lane: Lane;
  private runFn: RunFunc<T>;

  private queue: QueueItem<T>[] = [];
  private activeRuns: Map<string, ActiveRun> = new Map();
  private activeOrder: string[] = [];
  private maxConcurrent: number;

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private abortCutoffTime: Date | null = null;
  private generation = 0;

  constructor(
    sessionKey: string,
    laneName: string,
    config: Partial<QueueConfig>,
    lane: Lane,
    runFn: RunFunc<T>
  ) {
    this.sessionKey = sessionKey;
    this.laneName = laneName;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.lane = lane;
    this.runFn = runFn;
    this.maxConcurrent = this.config.maxConcurrent || 1;
  }

  enqueue(data: T): Promise<T> {
    return new Promise((resolve, reject) => {
      const item: QueueItem<T> = {
        id: this.generateId(),
        data,
        resolve,
        reject,
        enqueuedAt: new Date(),
      };

      switch (this.config.mode) {
        case 'interrupt':
          this.handleInterruptMode(item);
          break;
        case 'followup':
          this.handleFollowupMode(item);
          break;
        default:
          this.handleQueueMode(item);
      }
    });
  }

  private handleInterruptMode(item: QueueItem<T>): void {
    this.cancelAllActive('Interrupted by new message');
    this.clearQueue('Interrupted');

    if (this.queue.length < this.config.cap) {
      this.queue.push(item);
    } else {
      item.reject(new Error('Queue full'));
      return;
    }

    if (this.hasCapacity()) {
      this.scheduleNext();
    }
  }

  private handleFollowupMode(item: QueueItem<T>): void {
    if (this.queue.length >= this.config.cap) {
      this.applyDropPolicy(item);
    } else {
      this.queue.push(item);
    }

    if (this.hasCapacity()) {
      this.scheduleNext();
    }
  }

  private handleQueueMode(item: QueueItem<T>): void {
    if (this.queue.length >= this.config.cap) {
      this.applyDropPolicy(item);
    } else {
      this.queue.push(item);
    }

    if (this.hasCapacity()) {
      this.scheduleNext();
    }
  }

  private scheduleNext(): void {
    if (this.queue.length === 0) return;

    const debounce = this.config.debounceMs;
    if (debounce <= 0) {
      this.startAvailable();
      return;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      if (this.hasCapacity() && this.queue.length > 0) {
        this.startAvailable();
      }
    }, debounce);
  }

  private startAvailable(): void {
    while (this.hasCapacity() && this.queue.length > 0) {
      this.startOne();
    }
  }

  private startOne(): void {
    while (this.queue.length > 0) {
      const head = this.queue[0];

      if (this.abortCutoffTime && head.enqueuedAt < this.abortCutoffTime) {
        this.queue.shift();
        head.reject(new Error('Message stale'));
        continue;
      }

      this.abortCutoffTime = null;
      break;
    }

    if (this.queue.length === 0) return;

    const item = this.queue.shift()!;
    const runId = item.id;
    let cancelled = false;

    const activeRun: ActiveRun = {
      runId,
      cancel: () => {
        cancelled = true;
      },
      generation: this.generation,
    };

    this.activeRuns.set(runId, activeRun);
    this.activeOrder.push(runId);

    this.lane
      .submit(async () => {
        if (cancelled) {
          throw new Error('Run cancelled');
        }
        return this.runFn(item.data, runId);
      })
      .then((result) => {
        item.resolve(result);
      })
      .catch((err) => {
        item.reject(err);
      })
      .finally(() => {
        const entry = this.activeRuns.get(runId);
        if (entry && entry.generation === this.generation) {
          this.activeRuns.delete(runId);
          this.removeFromOrder(runId);
        }

        if (this.hasCapacity() && this.queue.length > 0) {
          this.scheduleNext();
        }
      });
  }

  private hasCapacity(): boolean {
    return this.activeRuns.size < this.maxConcurrent;
  }

  private applyDropPolicy(incoming: QueueItem<T>): void {
    switch (this.config.drop) {
      case 'old':
        if (this.queue.length > 0) {
          const old = this.queue.shift()!;
          old.reject(new Error('Dropped by policy'));
        }
        this.queue.push(incoming);
        break;
      case 'new':
        incoming.reject(new Error('Queue full'));
        break;
      default:
        if (this.queue.length > 0) {
          const old = this.queue.shift()!;
          old.reject(new Error('Dropped by policy'));
        }
        this.queue.push(incoming);
    }
  }

  private cancelAllActive(reason: string): void {
    for (const [runId, entry] of this.activeRuns) {
      entry.cancel();
      this.activeRuns.delete(runId);
    }
    this.activeOrder = [];
  }

  private clearQueue(reason: string): void {
    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      item.reject(new Error(reason));
    }
  }

  private removeFromOrder(runId: string): void {
    const idx = this.activeOrder.indexOf(runId);
    if (idx >= 0) {
      this.activeOrder.splice(idx, 1);
    }
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  setMaxConcurrent(max: number): void {
    this.maxConcurrent = Math.max(1, max);
    if (this.hasCapacity() && this.queue.length > 0) {
      this.scheduleNext();
    }
  }

  setConfig(config: Partial<QueueConfig>): void {
    if (config.mode !== undefined) this.config.mode = config.mode;
    if (config.cap !== undefined) this.config.cap = config.cap;
    if (config.drop !== undefined) this.config.drop = config.drop;
    if (config.debounceMs !== undefined) this.config.debounceMs = config.debounceMs;
    if (config.maxConcurrent !== undefined) {
      this.maxConcurrent = Math.max(1, config.maxConcurrent);
    }
    if (this.hasCapacity() && this.queue.length > 0) {
      this.scheduleNext();
    }
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  getActiveCount(): number {
    return this.activeRuns.size;
  }

  getSessionKey(): string {
    return this.sessionKey;
  }

  getGeneration(): number {
    return this.generation;
  }

  isActive(): boolean {
    return this.activeRuns.size > 0;
  }

  cancelOne(): boolean {
    if (this.activeOrder.length === 0) {
      if (this.queue.length > 0) {
        const item = this.queue.shift()!;
        item.reject(new Error('Request cancelled'));
        return false;
      }
      return false;
    }

    const runId = this.activeOrder[0];
    const entry = this.activeRuns.get(runId);
    if (entry) {
      entry.cancel();
      this.activeRuns.delete(runId);
      this.activeOrder.shift();
      return true;
    }

    return false;
  }

  cancelAll(): boolean {
    this.abortCutoffTime = new Date();

    let hadActive = false;
    for (const [runId, entry] of this.activeRuns) {
      entry.cancel();
      this.activeRuns.delete(runId);
      hadActive = true;
    }
    this.activeOrder = [];

    this.clearQueue('Session cancelled');
    return hadActive;
  }

  reset(): void {
    this.generation++;
    this.cancelAllActive('Reset');
    this.clearQueue('Reset');
    this.abortCutoffTime = null;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  getStats(): {
    sessionKey: string;
    queueLength: number;
    activeCount: number;
    maxConcurrent: number;
    generation: number;
  } {
    return {
      sessionKey: this.sessionKey,
      queueLength: this.queue.length,
      activeCount: this.activeRuns.size,
      maxConcurrent: this.maxConcurrent,
      generation: this.generation,
    };
  }
}
