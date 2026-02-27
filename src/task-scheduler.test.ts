import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test';

import { _initTestDatabase, createTask, getTaskById } from './db.js';
import { _resetSchedulerLoopForTests, startSchedulerLoop } from './task-scheduler.js';

async function advanceTimers(ms: number): Promise<void> {
  jest.advanceTimersByTime(ms);
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe('task scheduler', () => {
  beforeEach(() => {
    _initTestDatabase();
    _resetSchedulerLoopForTests();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('pauses due tasks with invalid group folders to prevent retry churn', async () => {
    createTask({
      id: 'task-invalid-folder',
      group_folder: '../../outside',
      chat_jid: 'bad@g.us',
      prompt: 'run',
      schedule_type: 'once',
      schedule_value: '2026-02-22T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: new Date(Date.now() - 60_000).toISOString(),
      status: 'active',
      created_at: '2026-02-22T00:00:00.000Z',
    });

    const enqueueTask = jest.fn((_groupJid: string, _taskId: string, fn: () => Promise<void>) => {
      void fn();
    });

    startSchedulerLoop({
      registeredGroups: () => ({}),
      getSessions: () => ({}),
      queue: { enqueueTask } as any,
      onProcess: () => {},
      sendMessage: async () => {},
    });

    await advanceTimers(10);

    const task = getTaskById('task-invalid-folder');
    expect(task?.status).toBe('paused');
  });
});
