import { describe, test, expect, beforeEach } from 'bun:test';
import { Lane, defaultLanes, LANE_NAMES } from './lane.js';
import { SessionQueue } from './queue.js';
import { Scheduler, createScheduler } from './scheduler.js';

describe('Lane', () => {
  test('creates with correct concurrency', () => {
    const lane = new Lane('test', 5);
    expect(lane.getName()).toBe('test');
    expect(lane.getConcurrency()).toBe(5);
  });

  test('submits and executes tasks', async () => {
    const lane = new Lane('test', 2);
    const results: number[] = [];

    await Promise.all([
      lane.submit(async () => { results.push(1); return 1; }),
      lane.submit(async () => { results.push(2); return 2; }),
    ]);

    expect(results.length).toBe(2);
    expect(results).toContain(1);
    expect(results).toContain(2);
  });

  test('respects concurrency limit', async () => {
    const lane = new Lane('test', 2);
    let active = 0;
    let maxActive = 0;

    const tasks = Array.from({ length: 5 }, (_, i) =>
      lane.submit(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 50));
        active--;
        return i;
      })
    );

    await Promise.all(tasks);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  test('returns correct stats', async () => {
    const lane = new Lane('test', 3);
    const stats = lane.stats();
    expect(stats.name).toBe('test');
    expect(stats.concurrency).toBe(3);
    expect(stats.active).toBe(0);
    expect(stats.pending).toBe(0);
  });

  test('stops accepting new tasks after stop()', async () => {
    const lane = new Lane('test', 1);
    lane.stop();
    
    await expect(lane.submit(async () => 1)).rejects.toThrow('Lane has been stopped');
  });
});

describe('SessionQueue', () => {
  let lane: Lane;
  let queue: SessionQueue<number>;

  beforeEach(() => {
    lane = new Lane('test', 3);
    queue = new SessionQueue('session1', 'test', {}, lane, async (n) => n * 2);
  });

  test('enqueues and processes items', async () => {
    const result = await queue.enqueue(5);
    expect(result).toBe(10);
  });

  test('processes multiple items', async () => {
    const results = await Promise.all([
      queue.enqueue(1),
      queue.enqueue(2),
      queue.enqueue(3),
    ]);
    expect(results).toEqual([2, 4, 6]);
  });

  test('tracks queue length', () => {
    expect(queue.getQueueLength()).toBe(0);
  });

  test('cancels all items', () => {
    const hadActive = queue.cancelAll();
    expect(typeof hadActive).toBe('boolean');
  });
});

describe('Scheduler', () => {
  test('creates with default lanes', () => {
    const scheduler = createScheduler();
    const stats = scheduler.laneStats();
    expect(stats.length).toBe(4);
    expect(stats.find((s) => s.name === 'main')).toBeDefined();
    expect(stats.find((s) => s.name === 'subagent')).toBeDefined();
    expect(stats.find((s) => s.name === 'delegate')).toBeDefined();
    expect(stats.find((s) => s.name === 'cron')).toBeDefined();
  });

  test('creates with custom lanes', () => {
    const scheduler = createScheduler({
      lanes: [{ name: 'custom', concurrency: 10 }],
    });
    const stats = scheduler.laneStats();
    expect(stats.length).toBe(1);
    expect(stats[0].name).toBe('custom');
    expect(stats[0].concurrency).toBe(10);
  });

  test('schedules tasks to lanes', async () => {
    const scheduler = createScheduler<number>({
      runFn: async (n) => n * 2,
    });

    const result = await scheduler.schedule('session1', LANE_NAMES.MAIN, 5);
    expect(result).toBe(10);
  });

  test('rejects tasks when draining', async () => {
    const scheduler = createScheduler();
    scheduler.markDraining();

    await expect(
      scheduler.schedule('session1', LANE_NAMES.MAIN, 1)
    ).rejects.toThrow('Gateway is draining');
  });

  test('cancels sessions', () => {
    const scheduler = createScheduler();
    const cancelled = scheduler.cancelSession('nonexistent');
    expect(cancelled).toBe(false);
  });

  test('gets or creates lanes', () => {
    const scheduler = createScheduler();
    const lane = scheduler.getOrCreateLane('new-lane', 5);
    expect(lane).toBeDefined();
    expect(lane.getName()).toBe('new-lane');
  });

  test('returns session stats', async () => {
    const scheduler = createScheduler<number>({
      runFn: async (n) => {
        await new Promise((r) => setTimeout(r, 10));
        return n;
      },
    });

    scheduler.schedule('session1', LANE_NAMES.MAIN, 1);
    scheduler.schedule('session2', LANE_NAMES.MAIN, 2);

    const stats = scheduler.sessionStats();
    expect(stats.length).toBeGreaterThanOrEqual(0);
  });
});

describe('defaultLanes', () => {
  test('returns 4 default lanes', () => {
    const lanes = defaultLanes();
    expect(lanes.length).toBe(4);
    expect(lanes.map((l) => l.name)).toEqual(['main', 'subagent', 'delegate', 'cron']);
  });

  test('reads env vars for concurrency', () => {
    process.env.NANOCLAW_LANE_MAIN = '50';
    const lanes = defaultLanes();
    const mainLane = lanes.find((l) => l.name === 'main');
    expect(mainLane?.concurrency).toBe(50);
    delete process.env.NANOCLAW_LANE_MAIN;
  });
});
