import { describe, it, expect, beforeEach, afterEach, mock, jest } from 'bun:test';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';

// Sentinel markers must match container-runner.ts
const OUTPUT_START_MARKER = '---JIMMYCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---JIMMYCLAW_OUTPUT_END---';

// Mock config
mock.module('./config.js', () => ({
  CONTAINER_IMAGE: 'nanoclaw-agent:latest',
  CONTAINER_MAX_OUTPUT_SIZE: 10485760,
  CONTAINER_TIMEOUT: 1800000, // 30min
  DATA_DIR: '/tmp/nanoclaw-test-data',
  GROUPS_DIR: '/tmp/nanoclaw-test-groups',
  IDLE_TIMEOUT: 1800000, // 30min
  TIMEZONE: 'America/Los_Angeles',
}));

// Mock logger
mock.module('./logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock fs
mock.module('fs', () => {
  const actual = require('fs');
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: jest.fn(() => false),
      mkdirSync: jest.fn(),
      writeFileSync: jest.fn(),
      readFileSync: jest.fn(() => ''),
      readdirSync: jest.fn(() => []),
      statSync: jest.fn(() => ({ isDirectory: () => false })),
      copyFileSync: jest.fn(),
    },
  };
});

// Mock mount-security
mock.module('./mount-security.js', () => ({
  validateAdditionalMounts: jest.fn(() => []),
}));

// Create a controllable fake ChildProcess
function createFakeProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: jest.Mock;
    pid: number;
  };
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.kill = jest.fn();
  proc.pid = 12345;
  return proc;
}

let fakeProc: ReturnType<typeof createFakeProcess>;

// Mock child_process.spawn
mock.module('child_process', () => {
  const actual = require('child_process');
  return {
    ...actual,
    spawn: jest.fn(() => fakeProc),
    exec: jest.fn((_cmd: string, _opts: unknown, cb?: (err: Error | null) => void) => {
      if (cb) cb(null);
      return new EventEmitter();
    }),
  };
});

import { runContainerAgent, ContainerOutput } from './container-runner.js';
import type { RegisteredGroup } from './types.js';

const testGroup: RegisteredGroup = {
  name: 'Test Group',
  folder: 'test-group',
  trigger: '@Andy',
  added_at: new Date().toISOString(),
};

const testInput = {
  prompt: 'Hello',
  groupFolder: 'test-group',
  chatJid: 'test@g.us',
  isMain: false,
};

function emitOutputMarker(proc: ReturnType<typeof createFakeProcess>, output: ContainerOutput) {
  const json = JSON.stringify(output);
  proc.stdout.push(`${OUTPUT_START_MARKER}\n${json}\n${OUTPUT_END_MARKER}\n`);
}

async function advanceTimers(ms: number): Promise<void> {
  jest.advanceTimersByTime(ms);
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe('container-runner timeout behavior', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    fakeProc = createFakeProcess();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('timeout after output resolves as success', async () => {
    const onOutput = jest.fn(async () => {});
    const resultPromise = runContainerAgent(testGroup, testInput, () => {}, onOutput);

    // Emit output with a result
    emitOutputMarker(fakeProc, {
      status: 'success',
      result: 'Here is my response',
      newSessionId: 'session-123',
    });

    // Let output processing settle
    await advanceTimers(10);

    // Fire the hard timeout (IDLE_TIMEOUT + 30s = 1830000ms)
    await advanceTimers(1830000);

    // Emit close event (as if container was stopped by the timeout)
    fakeProc.emit('close', 137);

    // Let the promise resolve
    await advanceTimers(10);

    const result = await resultPromise;
    expect(result.status).toBe('success');
    expect(result.newSessionId).toBe('session-123');
    expect(onOutput).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'Here is my response' }),
    );
  });

  it('timeout with no output resolves as error', async () => {
    const onOutput = jest.fn(async () => {});
    const resultPromise = runContainerAgent(testGroup, testInput, () => {}, onOutput);

    // No output emitted — fire the hard timeout
    await advanceTimers(1830000);

    // Emit close event
    fakeProc.emit('close', 137);

    await advanceTimers(10);

    const result = await resultPromise;
    expect(result.status).toBe('error');
    expect(result.error).toContain('timed out');
    expect(onOutput).not.toHaveBeenCalled();
  });

  it('normal exit after output resolves as success', async () => {
    const onOutput = jest.fn(async () => {});
    const resultPromise = runContainerAgent(testGroup, testInput, () => {}, onOutput);

    // Emit output
    emitOutputMarker(fakeProc, {
      status: 'success',
      result: 'Done',
      newSessionId: 'session-456',
    });

    await advanceTimers(10);

    // Normal exit (no timeout)
    fakeProc.emit('close', 0);

    await advanceTimers(10);

    const result = await resultPromise;
    expect(result.status).toBe('success');
    expect(result.newSessionId).toBe('session-456');
  });
});
