import { describe, test, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { DelegationHistoryStore } from './history-store.js';
import { DelegationHistoryRecord, DelegationHistoryStats } from './history-types.js';
import { randomUUID } from 'crypto';

describe('DelegationHistoryStore', () => {
  let store: DelegationHistoryStore;
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');
    store = new DelegationHistoryStore(db);
  });

  test('save and get record', async () => {
    const record: DelegationHistoryRecord = {
      id: randomUUID(),
      sourceAgent: 'agent-a',
      targetAgent: 'agent-b',
      userId: 'user-1',
      task: 'Test task',
      mode: 'sync',
      status: 'completed',
      result: 'Task completed',
      iterations: 2,
      durationMs: 1500,
      createdAt: new Date(),
    };

    await store.save(record);
    const saved = await store.get(record.id);
    
    expect(saved).toBeDefined();
    expect(saved?.sourceAgent).toBe('agent-a');
    expect(saved?.targetAgent).toBe('agent-b');
    expect(saved?.status).toBe('completed');
  });

  test('query with filter', async () => {
    const record1: DelegationHistoryRecord = {
      id: randomUUID(),
      sourceAgent: 'agent-a',
      targetAgent: 'agent-b',
      userId: 'user-1',
      task: 'Task 1',
      mode: 'sync',
      status: 'completed',
      iterations: 1,
      durationMs: 100,
      createdAt: new Date(),
    };

    const record2: DelegationHistoryRecord = {
      id: randomUUID(),
      sourceAgent: 'agent-a',
      targetAgent: 'agent-c',
      userId: 'user-2',
      task: 'Task 2',
      mode: 'async',
      status: 'failed',
      error: 'Failed',
      iterations: 1,
      durationMs: 50,
      createdAt: new Date(),
    };

    await store.save(record1);
    await store.save(record2);

    const results = await store.query({ sourceAgent: 'agent-a' });
    expect(results.length).toBe(2);

    const failed = await store.query({ status: 'failed' });
    expect(failed.length).toBe(1);
  });

  test('getStats returns correct statistics', async () => {
    const records: DelegationHistoryRecord[] = [
      {
        id: randomUUID(),
        sourceAgent: 'agent-a',
        targetAgent: 'agent-b',
        userId: 'user-1',
        task: 'Task 1',
        mode: 'sync',
        status: 'completed',
        iterations: 2,
        durationMs: 1000,
        createdAt: new Date(),
      },
      {
        id: randomUUID(),
        sourceAgent: 'agent-a',
        targetAgent: 'agent-b',
        userId: 'user-1',
        task: 'Task 2',
        mode: 'sync',
        status: 'failed',
        iterations: 1,
        durationMs: 500,
        createdAt: new Date(),
      },
      {
        id: randomUUID(),
        sourceAgent: 'agent-a',
        targetAgent: 'agent-b',
        userId: 'user-1',
        task: 'Task 3',
        mode: 'sync',
        status: 'cancelled',
        iterations: 0,
        durationMs: 0,
        createdAt: new Date(),
      },
    ];

    for (const record of records) {
      await store.save(record);
    }

    const stats = await store.getStats();
    expect(stats.total).toBe(3);
    expect(stats.completed).toBe(1);
    expect(stats.failed).toBe(1);
    expect(stats.cancelled).toBe(1);
  });

  test('delete removes record', async () => {
    const record: DelegationHistoryRecord = {
      id: randomUUID(),
      sourceAgent: 'agent-a',
      targetAgent: 'agent-b',
      userId: 'user-1',
      task: 'Test',
      mode: 'sync',
      status: 'completed',
      iterations: 1,
      durationMs: 100,
      createdAt: new Date(),
    };

    await store.save(record);
    const deleted = await store.delete(record.id);
    expect(deleted).toBe(true);

    const fetched = await store.get(record.id);
    expect(fetched).toBeNull();
  });

  test('deleteOlderThan removes old records', async () => {
    const oldRecord: DelegationHistoryRecord = {
      id: randomUUID(),
      sourceAgent: 'agent-a',
      targetAgent: 'agent-b',
      userId: 'user-1',
      task: 'Old task',
      mode: 'sync',
      status: 'completed',
      iterations: 1,
      durationMs: 100,
      createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
    };

    const newRecord: DelegationHistoryRecord = {
      id: randomUUID(),
      sourceAgent: 'agent-a',
      targetAgent: 'agent-b',
      userId: 'user-1',
      task: 'New task',
      mode: 'sync',
      status: 'completed',
      iterations: 1,
      durationMs: 100,
      createdAt: new Date(),
    };

    await store.save(oldRecord);
    await store.save(newRecord);

    const deleted = await store.deleteOlderThan(new Date(Date.now() - 3 * 24 * 60 * 60 * 1000));
    expect(deleted).toBe(1);

    const remaining = await store.query({});
    expect(remaining.length).toBe(1);
    expect(remaining[0].task).toBe('New task');
  });
});
