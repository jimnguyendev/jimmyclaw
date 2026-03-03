---
phase: testing
title: Channel-Based Agent Communication Testing
description: Testing strategy for Discord/Telegram agent team channel
---

# Testing Strategy: Channel-Based Agent Communication

## Test Coverage Goals

- Unit tests: Message parser, routing logic, timeout handling
- Integration tests: Discord/Telegram bot gửi/nhận message
- E2E: Multi-instance cross-VPS delegation

---

## Unit Tests

### Message Parser (`src/orchestrator/channel-message-parser.test.ts`)

```typescript
describe('parseChannelMessage', () => {
  const botIds = new Map([
    ['discord-id-nam', 'nam'],
    ['discord-id-linh', 'linh'],
  ]);

  it('parse @mention đơn giản', () => {
    const result = parseChannelMessage(
      '@linh [research] tìm hiểu GraphQL',
      botIds, 'discord-id-nam', 'msg-1'
    );
    expect(result.mentions).toEqual(['linh']);
    expect(result.taskType).toBe('research');
    expect(result.content).toBe('tìm hiểu GraphQL');
    expect(result.fromAgent).toBe('nam');
    expect(result.fromHuman).toBe(false);
  });

  it('parse @all broadcast', () => {
    const result = parseChannelMessage('@all [info] bắt đầu task', botIds, 'discord-id-nam', 'msg-2');
    expect(result.mentions).toContain('all');
    expect(result.taskType).toBe('info');
  });

  it('parse [done] với taskId', () => {
    const result = parseChannelMessage(
      '@nam [done] xong rồi [task:abc-123]',
      botIds, 'discord-id-linh', 'msg-3'
    );
    expect(result.taskType).toBe('done');
    expect(result.taskId).toBe('abc-123');
    expect(result.fromAgent).toBe('linh');
  });

  it('nhận diện human message', () => {
    const result = parseChannelMessage(
      '@nam dừng lại đi',
      botIds,
      'human-user-id',   // không có trong botIds
      'msg-4'
    );
    expect(result.fromHuman).toBe(true);
    expect(result.fromAgent).toBeNull();
  });

  it('message không có @mention', () => {
    const result = parseChannelMessage('hello world', botIds, 'discord-id-nam', 'msg-5');
    expect(result.mentions).toHaveLength(0);
    expect(result.taskType).toBeNull();
    expect(result.content).toBe('hello world');
  });

  it('không parse mention trong code block', () => {
    const result = parseChannelMessage('```@linh không phải mention```', botIds, 'discord-id-nam', 'msg-6');
    // Tùy implementation: có thể strip code blocks trước khi parse
    expect(result.content).toContain('@linh không phải mention');
  });
});
```

### Routing logic (`src/orchestrator/index.test.ts`)

```typescript
describe('delegateTask routing', () => {
  it('local agent → gọi trực tiếp, không qua channel', async () => {
    const orchestrator = createOrchestrator({
      localAgents: new Set(['nam', 'linh']),
      channelMessenger: mockChannelMessenger,
    });

    await orchestrator.delegateTask('linh', mockTask);

    expect(mockChannelMessenger.sendAsAgent).not.toHaveBeenCalled();
    expect(mockLocalExecutor).toHaveBeenCalledWith('linh', mockTask);
  });

  it('remote agent → post channel và chờ reply', async () => {
    const orchestrator = createOrchestrator({
      localAgents: new Set(['nam']),           // chỉ nam là local
      channelMessenger: mockChannelMessenger,
    });

    mockChannelMessenger.waitForReply.mockResolvedValue('kết quả từ duc');

    const result = await orchestrator.delegateTask('duc', mockTask);

    expect(mockChannelMessenger.sendAsAgent).toHaveBeenCalledWith(
      'nam',
      expect.stringContaining('@duc')
    );
    expect(result).toBe('kết quả từ duc');
  });

  it('remote agent timeout → fallback về local agent cùng role', async () => {
    const orchestrator = createOrchestrator({
      localAgents: new Set(['nam', 'duc-local']),  // có local coder
      channelMessenger: mockChannelMessenger,
    });

    // Remote duc timeout
    mockChannelMessenger.waitForReply.mockResolvedValue(null);

    const result = await orchestrator.delegateTask('duc-remote', mockTask);

    // Phải fallback về duc-local
    expect(mockLocalExecutor).toHaveBeenCalledWith('duc-local', mockTask);
  });

  it('remote agent timeout và không có fallback → throw error', async () => {
    const orchestrator = createOrchestrator({
      localAgents: new Set(['nam']),  // không có local coder
      channelMessenger: mockChannelMessenger,
    });

    mockChannelMessenger.waitForReply.mockResolvedValue(null);

    await expect(orchestrator.delegateTask('duc', mockTask)).rejects.toThrow();
  });
});
```

### Message loop prevention

```typescript
describe('message loop prevention', () => {
  it('bỏ qua message do chính agent gửi', () => {
    const handler = createMessageHandler({ myAgentId: 'nam' });
    const processed: string[] = [];

    handler.onMessage = (msg) => processed.push(msg.content);

    // Message từ chính nam
    handler.receive(parseMsg('@linh task', { fromAgent: 'nam' }));
    expect(processed).toHaveLength(0);

    // Message từ agent khác
    handler.receive(parseMsg('@nam [done] xong', { fromAgent: 'linh' }));
    expect(processed).toHaveLength(1);
  });

  it('bỏ qua taskId đã xử lý (idempotent)', () => {
    const handler = createMessageHandler({ myAgentId: 'linh' });
    const processed: string[] = [];
    handler.onMessage = (msg) => processed.push(msg.taskId!);

    const msg = parseMsg('@linh [research] task [task:abc]', { fromAgent: 'nam' });
    handler.receive(msg);
    handler.receive(msg);  // duplicate

    expect(processed).toHaveLength(1);
  });
});
```

---

## Integration Tests

### Discord bot gửi/nhận message

Cần Discord bot thật và channel test riêng (dùng biến `TEST_DISCORD_CHANNEL_ID`):

```typescript
describe('Discord integration', () => {
  // Chỉ chạy khi có env vars
  const skip = !process.env.TEST_DISCORD_BOT_TOKEN_A;

  it.skipIf(skip)('bot A gửi, bot B nhận', async () => {
    const messengerA = new DiscordChannelMessenger(configA);
    const messengerB = new DiscordChannelMessenger(configB);

    const received: string[] = [];
    messengerB.startListening((msg) => {
      if (msg.mentions.includes('botb')) received.push(msg.content);
    });

    await messengerA.sendAsAgent('bota', '@botb [test] hello');
    await sleep(2000);  // chờ Discord deliver

    expect(received).toContain('hello');
  });

  it.skipIf(skip)('waitForReply resolve khi nhận [done]', async () => {
    const taskId = 'test-' + Date.now();
    const messenger = new DiscordChannelMessenger(config);

    // Simulate reply sau 500ms
    setTimeout(async () => {
      await messenger.sendAsAgent('linh', `@nam [done] kết quả [task:${taskId}]`);
    }, 500);

    const result = await messenger.waitForReply({ fromAgent: 'linh', taskId, timeoutMs: 3000 });
    expect(result).toBe('kết quả');
  });

  it.skipIf(skip)('waitForReply trả về null sau timeout', async () => {
    const messenger = new DiscordChannelMessenger(config);
    const result = await messenger.waitForReply({
      fromAgent: 'nobody',
      taskId: 'will-never-reply',
      timeoutMs: 1000
    });
    expect(result).toBeNull();
  });
});
```

---

## E2E Tests

### Single instance — agents nói chuyện qua channel

```
Kịch bản: User gửi task yêu cầu research + code

1. User → @nam research GraphQL rồi viết example
2. Nam post "@linh [research] tìm hiểu GraphQL [task:t1]" lên channel
3. Linh nhận, research, post "@nam [done] kết quả [task:t1]" lên channel
4. Nam nhận kết quả Linh
5. Nam post "@duc [code] viết example dựa trên: {kết quả Linh} [task:t2]"
6. Duc nhận, viết code, post "@nam [done] code xong [task:t2]"
7. Nam tổng hợp → reply user

Verify:
- Channel history có đủ 6 messages trên
- User nhận kết quả cuối cùng
- Không có message thừa (loop)
```

### Multi-instance — cross-VPS delegation

```
Setup:
- Instance A (VPS 1): agents nam, linh
- Instance B (VPS 2): agents duc, trang
- Cùng Discord channel

Kịch bản:
1. User → @nam viết API endpoint
2. Nam (Instance A) classify → coder task → @duc (Instance B)
3. Nam post "@duc [code] viết API [task:x1]" lên channel
4. Instance B nhận, duc xử lý
5. Duc post "@nam [done] code xong [task:x1]"
6. Instance A nhận → Nam reply user

Verify:
- Instance B process task của duc
- Instance A nhận reply từ duc qua channel
- Không có instance nào xử lý message không phải của mình
```

### Human interruption

```
1. Bắt đầu task dài (mock 10s)
2. Sau 2s, human post "@nam dừng lại"
3. Nam cancel pending tasks
4. Nam reply "Đã dừng. Bạn muốn làm gì tiếp theo?"
5. Human post "@nam thay vào đó làm X"
6. Nam xử lý task mới X
```

---

## Test Checklist

- [ ] Parser: parse @mention, [type], [task:id] đúng
- [ ] Parser: nhận diện human vs bot message
- [ ] Routing: local agent không dùng channel
- [ ] Routing: remote agent dùng channel + waitForReply
- [ ] Routing: timeout → fallback local
- [ ] Loop prevention: bỏ qua self-message
- [ ] Loop prevention: idempotent trên taskId
- [ ] Discord: bot gửi message với đúng identity
- [ ] Discord: bot nhận @mention của mình
- [ ] Discord: waitForReply resolve đúng
- [ ] Discord: waitForReply timeout trả về null
- [ ] Shared workspace: agent A ghi file, agent B đọc được
- [ ] Human interruption: "dừng" cancel tasks
- [ ] Multi-instance: cross-VPS task delegation hoàn chỉnh
- [ ] `teamChannel.enabled = false`: hoạt động như cũ, không có gì thay đổi
