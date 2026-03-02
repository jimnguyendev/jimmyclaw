/**
 * Lane - Named worker pool with bounded concurrency
 * Ported from GoClaw's lane system.
 */

export const LANE_NAMES = {
  MAIN: 'main',
  SUBAGENT: 'subagent',
  DELEGATE: 'delegate',
  CRON: 'cron',
} as const;

export type LaneName = (typeof LANE_NAMES)[keyof typeof LANE_NAMES];

export interface LaneConfig {
  name: string;
  concurrency: number;
}

export interface LaneStats {
  name: string;
  concurrency: number;
  active: number;
  pending: number;
}

export class Lane {
  private name: string;
  private concurrency: number;
  private sem: Array<boolean>;
  private pendingCount = 0;
  private activeCount = 0;
  private stopped = false;

  constructor(name: string, concurrency: number) {
    this.name = name;
    this.concurrency = Math.max(1, concurrency);
    this.sem = new Array(this.concurrency).fill(true);
  }

  async submit<T>(fn: () => Promise<T>): Promise<T> {
    if (this.stopped) {
      throw new Error('Lane has been stopped');
    }

    this.pendingCount++;

    return new Promise((resolve, reject) => {
      const tryAcquire = () => {
        if (this.stopped) {
          this.pendingCount--;
          reject(new Error('Lane stopped'));
          return;
        }

        const idx = this.sem.findIndex((v) => v);
        if (idx !== -1) {
          this.sem[idx] = false;
          this.pendingCount--;
          this.activeCount++;

          fn()
            .then((result) => {
              this.activeCount--;
              this.sem[idx] = true;
              resolve(result);
            })
            .catch((err) => {
              this.activeCount--;
              this.sem[idx] = true;
              reject(err);
            });
        } else {
          setTimeout(tryAcquire, 10);
        }
      };

      tryAcquire();
    });
  }

  stop(): void {
    this.stopped = true;
  }

  stats(): LaneStats {
    return {
      name: this.name,
      concurrency: this.concurrency,
      active: this.activeCount,
      pending: this.pendingCount,
    };
  }

  getName(): string {
    return this.name;
  }

  getConcurrency(): number {
    return this.concurrency;
  }
}

export function defaultLanes(): LaneConfig[] {
  return [
    { name: LANE_NAMES.MAIN, concurrency: envInt('NANOCLAW_LANE_MAIN', 30) },
    { name: LANE_NAMES.SUBAGENT, concurrency: envInt('NANOCLAW_LANE_SUBAGENT', 50) },
    { name: LANE_NAMES.DELEGATE, concurrency: envInt('NANOCLAW_LANE_DELEGATE', 100) },
    { name: LANE_NAMES.CRON, concurrency: envInt('NANOCLAW_LANE_CRON', 30) },
  ];
}

function envInt(key: string, defaultVal: number): number {
  const val = process.env[key];
  if (val) {
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return defaultVal;
}
