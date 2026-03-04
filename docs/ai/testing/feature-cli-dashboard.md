---
phase: testing
title: CLI Dashboard Testing
description: Testing strategy for CLI dashboard
---

# Testing Strategy: CLI Dashboard

## Test Coverage Goals

- Unit tests: API handler functions, message parser, formatter
- Integration tests: CLI commands → socket → daemon response
- E2E: Toàn bộ workflow từ `jimmyclaw agent add` đến agent hoạt động

---

## Unit Tests

### API Server handlers (`src/api-server.test.ts`)

```typescript
describe('handleRequest', () => {
  it('GET /status trả về uptime và agent count', async () => {
    const res = await handleRequest({ method: 'GET', path: '/status' }, mockDeps);
    expect(res.ok).toBe(true);
    expect(res.data).toMatchObject({
      status: expect.stringMatching(/running|stopped/),
      uptime: expect.any(Number),
    });
  });

  it('POST /agents thêm agent mới', async () => {
    const res = await handleRequest({
      method: 'POST',
      path: '/agents',
      body: { id: 'test', role: 'researcher', model: 'glm-4.7-flash' }
    }, mockDeps);
    expect(res.ok).toBe(true);
  });

  it('POST /agents với id trùng trả về error', async () => {
    // thêm lần 1
    await handleRequest({ method: 'POST', path: '/agents', body: { id: 'dup', role: 'coder', model: 'glm-5' } }, mockDeps);
    // thêm lần 2
    const res = await handleRequest({ method: 'POST', path: '/agents', body: { id: 'dup', role: 'coder', model: 'glm-5' } }, mockDeps);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/đã tồn tại/);
  });

  it('DELETE /agents/:id xóa agent', async () => {
    const res = await handleRequest({ method: 'DELETE', path: '/agents/sarah' }, mockDeps);
    expect(res.ok).toBe(true);
  });

  it('GET /config trả về config hiện tại', async () => {
    const res = await handleRequest({ method: 'GET', path: '/config' }, mockDeps);
    expect(res.data).toHaveProperty('leader');
    expect(res.data).toHaveProperty('workers');
    expect(res.data).toHaveProperty('settings');
  });

  it('PUT /config cập nhật settings', async () => {
    const res = await handleRequest({
      method: 'PUT',
      path: '/config',
      body: { settings: { maxParallelTasks: 6 } }
    }, mockDeps);
    expect(res.ok).toBe(true);
  });
});
```

### Formatter (`src/cli/shared/formatter.test.ts`)

```typescript
describe('formatter', () => {
  it('formatDuration hiển thị đúng', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(65000)).toBe('1m 5s');
    expect(formatDuration(3661000)).toBe('1h 1m');
    expect(formatDuration(191520000)).toBe('2d 4h');
  });

  it('formatCost hiển thị số thập phân 2 chữ số', () => {
    expect(formatCost(0.1234)).toBe('$0.12');
    expect(formatCost(0)).toBe('$0.00');
  });

  it('colorByLevel trả về đúng màu chalk', () => {
    // Không test màu trực tiếp, test string có nội dung
    expect(colorByLevel('error', 'message')).toContain('message');
    expect(colorByLevel('info', 'message')).toContain('message');
  });
});
```

### Log filter (`src/cli/commands/logs.test.ts`)

```typescript
describe('filterLogs', () => {
  const logs = [
    { level: 'info', agent: 'linh', msg: 'task started', time: '2026-03-02T10:00:00Z' },
    { level: 'error', agent: 'duc', msg: 'task failed', time: '2026-03-02T10:01:00Z' },
    { level: 'info', agent: 'linh', msg: 'task done', time: '2026-03-02T10:02:00Z' },
  ];

  it('filter theo agent', () => {
    const result = filterLogs(logs, { agent: 'linh' });
    expect(result).toHaveLength(2);
    expect(result.every(l => l.agent === 'linh')).toBe(true);
  });

  it('filter theo level', () => {
    const result = filterLogs(logs, { level: 'error' });
    expect(result).toHaveLength(1);
    expect(result[0].agent).toBe('duc');
  });

  it('filter theo since', () => {
    const result = filterLogs(logs, { since: '2026-03-02T10:01:00Z' });
    expect(result).toHaveLength(1);
  });
});
```

---

## Integration Tests

### CLI → Socket → Daemon (`src/cli/integration.test.ts`)

Cần daemon đang chạy hoặc mock socket server:

```typescript
describe('CLI integration', () => {
  let mockServer: ReturnType<typeof createMockApiServer>;

  beforeAll(() => {
    mockServer = createMockApiServer(TEST_SOCKET_PATH);
  });

  afterAll(() => mockServer.close());

  it('jimmyclaw status in ra thông tin đúng', async () => {
    const output = await runCli(['status'], { NANOCLAW_SOCKET: TEST_SOCKET_PATH });
    expect(output).toContain('JimmyClaw');
    expect(output).toMatch(/running|stopped/);
  });

  it('jimmyclaw agents in danh sách agents', async () => {
    const output = await runCli(['agents'], { NANOCLAW_SOCKET: TEST_SOCKET_PATH });
    expect(output).toContain('nam');
    expect(output).toContain('leader');
  });

  it('jimmyclaw status --json trả về JSON hợp lệ', async () => {
    const output = await runCli(['status', '--json'], { NANOCLAW_SOCKET: TEST_SOCKET_PATH });
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty('status');
  });

  it('jimmyclaw agent add với args đầy đủ không cần prompt', async () => {
    const output = await runCli(
      ['agent', 'add', 'test-bot', 'researcher', 'glm-4.7-flash'],
      { NANOCLAW_SOCKET: TEST_SOCKET_PATH }
    );
    expect(output).toContain('✓');
    expect(output).toContain('test-bot');
  });
});

// Helper chạy CLI như subprocess
async function runCli(args: string[], env: Record<string, string> = {}): Promise<string> {
  const proc = Bun.spawn(['bun', 'run', 'src/cli/index.ts', ...args], {
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  await proc.exited;
  return new Response(proc.stdout).text();
}
```

---

## E2E Tests

### Workflow: Thêm agent và kiểm tra hoạt động

```
1. jimmyclaw agent add duc coder glm-5    → ✓ added
2. jimmyclaw agents                        → duc xuất hiện trong list
3. jimmyclaw status --json                 → agents.total tăng lên
4. jimmyclaw agent remove duc             → ✓ removed
5. jimmyclaw agents                        → duc không còn trong list
```

### Workflow: Config thay đổi persistent

```
1. jimmyclaw config set maxParallelTasks 6
2. Daemon restart
3. jimmyclaw config show                   → maxParallelTasks: 6 vẫn còn
```

### Workflow: Daemon không chạy

```
1. Stop daemon
2. jimmyclaw status                        → "Daemon không chạy. Dùng: jimmyclaw start"
3. jimmyclaw start                         → daemon khởi động
4. jimmyclaw status                        → running
```

---

## Test Checklist

- [ ] `jimmyclaw status` in đúng thông tin
- [ ] `jimmyclaw status --json` output là valid JSON
- [ ] `jimmyclaw agents` hiển thị đúng danh sách
- [ ] `jimmyclaw agent add <id> <role> <model>` thêm thành công
- [ ] `jimmyclaw agent add` (không args) mở interactive prompt
- [ ] `jimmyclaw agent remove <id>` có confirm trước khi xóa
- [ ] `jimmyclaw config set <key> <value>` persist sau restart
- [ ] `jimmyclaw logs` stream realtime không block
- [ ] `jimmyclaw logs --agent <id>` chỉ hiện log của agent đó
- [ ] `jimmyclaw start/stop/restart` quản lý daemon đúng
- [ ] CLI in thông báo rõ ràng khi daemon không chạy
- [ ] TUI mở không lỗi
- [ ] TUI `q` thoát, daemon vẫn chạy
- [ ] TUI refresh tự động, không cần thao tác
