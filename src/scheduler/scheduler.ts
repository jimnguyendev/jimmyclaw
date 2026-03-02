/**
 * Scheduler - Top-level coordinator for lanes and session queues
 * Manages concurrent execution across multiple lanes with per-session serialization.
 */

import { Lane, LaneConfig, LaneStats, LaneName, defaultLanes, LANE_NAMES } from './lane.js';
import { SessionQueue, QueueConfig, QueueMode, DropPolicy, RunFunc } from './queue.js';

export const DEFAULT_QUEUE_CONFIG: QueueConfig = {
  mode: 'queue',
  cap: 10,
  drop: 'old',
  debounceMs: 800,
  maxConcurrent: 1,
};

export interface ScheduleOpts {
  maxConcurrent?: number;
  queueMode?: QueueMode;
  debounceMs?: number;
}

export interface RunOutcome<T = unknown> {
  result?: T;
  error?: Error;
}

export interface SessionInfo {
  sessionKey: string;
  queueLength: number;
  activeCount: number;
  maxConcurrent: number;
  generation: number;
}

export class Scheduler<T = unknown> {
  private lanes: Map<string, Lane>;
  private sessions: Map<string, SessionQueue<T>>;
  private queueConfig: QueueConfig;
  private runFn: RunFunc<T>;
  private draining = false;

  constructor(
    laneConfigs?: LaneConfig[],
    queueConfig?: Partial<QueueConfig>,
    runFn?: RunFunc<T>
  ) {
    const configs = laneConfigs || defaultLanes();
    this.lanes = new Map(configs.map((c) => [c.name, new Lane(c.name, c.concurrency)]));
    this.sessions = new Map();
    this.queueConfig = { ...DEFAULT_QUEUE_CONFIG, ...queueConfig };
    this.runFn = runFn || ((item: T) => Promise.resolve(item));
  }

  setRunFn(fn: RunFunc<T>): void {
    this.runFn = fn;
  }

  markDraining(): void {
    this.draining = true;
    console.log('[Scheduler] Marked as draining, new requests will be rejected');
  }

  schedule(sessionKey: string, lane: LaneName | string, data: T): Promise<T> {
    if (this.draining) {
      return Promise.reject(new Error('Gateway is draining'));
    }

    const sq = this.getOrCreateSession(sessionKey, lane);
    return sq.enqueue(data);
  }

  scheduleWithOpts(
    sessionKey: string,
    lane: LaneName | string,
    data: T,
    opts: ScheduleOpts
  ): Promise<T> {
    if (this.draining) {
      return Promise.reject(new Error('Gateway is draining'));
    }

    const sq = this.getOrCreateSession(sessionKey, lane);

    if (opts.maxConcurrent || opts.queueMode || opts.debounceMs) {
      sq.setConfig({
        maxConcurrent: opts.maxConcurrent,
        mode: opts.queueMode,
        debounceMs: opts.debounceMs,
      });
    }

    return sq.enqueue(data);
  }

  private getOrCreateSession(sessionKey: string, laneName: string): SessionQueue<T> {
    let sq = this.sessions.get(sessionKey);
    if (!sq) {
      const lane = this.lanes.get(laneName) || this.lanes.get(LANE_NAMES.MAIN)!;
      sq = new SessionQueue(sessionKey, laneName, this.queueConfig, lane, this.runFn);
      this.sessions.set(sessionKey, sq);
    }
    return sq;
  }

  getSession(sessionKey: string): SessionQueue<T> | undefined {
    return this.sessions.get(sessionKey);
  }

  cancelSession(sessionKey: string): boolean {
    const sq = this.sessions.get(sessionKey);
    if (!sq) return false;
    return sq.cancelAll();
  }

  cancelOneSession(sessionKey: string): boolean {
    const sq = this.sessions.get(sessionKey);
    if (!sq) return false;
    return sq.cancelOne();
  }

  resetSession(sessionKey: string): boolean {
    const sq = this.sessions.get(sessionKey);
    if (!sq) return false;
    sq.reset();
    return true;
  }

  stop(): void {
    this.markDraining();
    for (const lane of this.lanes.values()) {
      lane.stop();
    }
  }

  laneStats(): LaneStats[] {
    return Array.from(this.lanes.values()).map((l) => l.stats());
  }

  getLane(name: string): Lane | undefined {
    return this.lanes.get(name);
  }

  getOrCreateLane(name: string, concurrency: number): Lane {
    let lane = this.lanes.get(name);
    if (!lane) {
      lane = new Lane(name, concurrency);
      this.lanes.set(name, lane);
    }
    return lane;
  }

  sessionStats(): SessionInfo[] {
    return Array.from(this.sessions.values()).map((sq) => sq.getStats());
  }

  activeSessions(): number {
    return this.sessions.size;
  }

  removeSession(sessionKey: string): boolean {
    const sq = this.sessions.get(sessionKey);
    if (!sq) return false;
    sq.cancelAll();
    this.sessions.delete(sessionKey);
    return true;
  }

  setQueueConfig(config: Partial<QueueConfig>): void {
    this.queueConfig = { ...this.queueConfig, ...config };
  }

  getQueueConfig(): QueueConfig {
    return { ...this.queueConfig };
  }
}

export function createScheduler<T>(
  options: {
    lanes?: LaneConfig[];
    queueConfig?: Partial<QueueConfig>;
    runFn?: RunFunc<T>;
  } = {}
): Scheduler<T> {
  return new Scheduler(options.lanes, options.queueConfig, options.runFn);
}
