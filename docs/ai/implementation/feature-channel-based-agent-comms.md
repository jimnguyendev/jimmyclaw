---
phase: implementation
title: Channel-Based Agent Communication Implementation
description: Technical implementation guide
---

# Implementation Guide: Channel-Based Agent Communication

## Development Setup

**Prerequisites:**
- Discord: Tạo Application + Bot cho từng agent tại https://discord.com/developers
- Telegram: Tạo bot qua @BotFather cho từng agent
- Một Discord channel hoặc Telegram group để test

**Cấu hình `.env`:**
```bash
TEAM_CHANNEL_PLATFORM=discord
DISCORD_TEAM_CHANNEL_ID=1234567890

DISCORD_BOT_TOKEN_NAM=...
DISCORD_BOT_TOKEN_LINH=...
DISCORD_BOT_TOKEN_DUC=...
DISCORD_BOT_TOKEN_TRANG=...

INSTANCE_ID=vps1
INSTANCE_AGENTS=nam,linh
```

---

## Code Structure

```
src/
├── orchestrator/
│   ├── channel-messenger.ts        # Interface + factory
│   ├── channel-messenger-discord.ts # Discord implementation
│   ├── channel-messenger-telegram.ts# Telegram implementation
│   ├── channel-message-parser.ts   # Parse @mention [type] content
│   └── index.ts                    # Tích hợp ChannelMessenger
└── container-runner.ts             # Thêm shared workspace mount

groups/
└── workspace/                      # Shared workspace
    ├── docs/                       # Agent-generated documents
    ├── code/                       # Agent-generated code
    └── .gitkeep
```

---

## Implementation Notes

### 1. Message Parser (`src/orchestrator/channel-message-parser.ts`)

Format chuẩn: `@target [type] content`

```typescript
export interface ParsedChannelMessage {
  rawText: string;
  mentions: string[];         // ['linh', 'duc']
  taskType: TaskType | null;  // 'research' | 'code' | 'review' | 'done' | 'failed' | 'ask' | 'file' | null
  content: string;
  taskId: string | null;      // nếu message có [task:abc123]
  fromAgent: string | null;   // agent id nếu sender là bot
  fromHuman: boolean;
  channelMessageId: string;
  timestamp: string;
}

export function parseChannelMessage(
  text: string,
  botIds: Map<string, string>,   // botId → agentId
  senderId: string,
  channelMessageId: string,
): ParsedChannelMessage {
  // Parse @mentions
  const mentionRegex = /@(\w+)/g;
  const mentions: string[] = [];
  let match;
  while ((match = mentionRegex.exec(text)) !== null) {
    mentions.push(match[1].toLowerCase());
  }

  // Parse [type]
  const typeMatch = text.match(/\[(\w+)\]/);
  const taskType = typeMatch ? (typeMatch[1] as TaskType) : null;

  // Parse [task:id]
  const taskIdMatch = text.match(/\[task:([a-z0-9-]+)\]/);
  const taskId = taskIdMatch ? taskIdMatch[1] : null;

  // Nội dung sau @mention và [type]
  const content = text
    .replace(/@\w+/g, '')
    .replace(/\[\w+\]/g, '')
    .replace(/\[task:[a-z0-9-]+\]/g, '')
    .trim();

  const fromAgent = botIds.get(senderId) ?? null;
  const fromHuman = fromAgent === null;

  return { rawText: text, mentions, taskType, content, taskId, fromAgent, fromHuman, channelMessageId, timestamp: new Date().toISOString() };
}
```

### 2. Channel Messenger Interface (`src/orchestrator/channel-messenger.ts`)

```typescript
export interface ChannelMessenger {
  sendAsAgent(agentId: string, text: string): Promise<void>;
  startListening(handler: (msg: ParsedChannelMessage) => void): Promise<void>;
  stopListening(): void;
  waitForReply(params: {
    fromAgent: string;
    taskId: string;
    timeoutMs: number;
  }): Promise<string | null>;
  isAvailable(): boolean;
}

export function createChannelMessenger(config: SwarmConfigFile): ChannelMessenger | null {
  if (!config.teamChannel?.enabled) return null;

  if (config.teamChannel.platform === 'discord') {
    return new DiscordChannelMessenger(config);
  }
  if (config.teamChannel.platform === 'telegram') {
    return new TelegramChannelMessenger(config);
  }
  return null;
}
```

### 3. Discord Implementation (`src/orchestrator/channel-messenger-discord.ts`)

Mỗi agent có `Client` riêng. Chỉ 1 client listen (tránh duplicate events):

```typescript
export class DiscordChannelMessenger implements ChannelMessenger {
  private clients = new Map<string, Client>();   // agentId → Client
  private listenerClient: Client | null = null;  // client dùng để listen
  private botIds = new Map<string, string>();    // Discord userId → agentId
  private pendingReplies = new Map<string, (result: string) => void>(); // taskId → resolver

  async initialize(config: SwarmConfigFile) {
    const allAgents = [config.leader, ...config.workers];

    for (const agent of allAgents) {
      if (!agent.botToken) continue;

      const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
      await client.login(agent.botToken);

      this.clients.set(agent.id, client);

      // Lưu Discord userId để nhận diện bot sau
      const me = client.user!;
      this.botIds.set(me.id, agent.id);
    }

    // Dùng leader's client để listen (tránh duplicate)
    this.listenerClient = this.clients.get(config.leader.id) ?? null;
  }

  async sendAsAgent(agentId: string, text: string): Promise<void> {
    const client = this.clients.get(agentId);
    if (!client) throw new Error(`Không có bot cho agent ${agentId}`);

    const channel = await client.channels.fetch(this.channelId) as TextChannel;
    await channel.send(text);
  }

  startListening(handler: (msg: ParsedChannelMessage) => void): void {
    if (!this.listenerClient) return;

    this.listenerClient.on(Events.MessageCreate, (message) => {
      // Bỏ qua message từ channel khác
      if (message.channelId !== this.channelId) return;

      const parsed = parseChannelMessage(
        message.content,
        this.botIds,
        message.author.id,
        message.id,
      );

      // Check pending reply resolvers
      if (parsed.taskId && parsed.taskType === 'done' || parsed.taskType === 'failed') {
        const resolver = this.pendingReplies.get(parsed.taskId);
        if (resolver) {
          this.pendingReplies.delete(parsed.taskId);
          resolver(parsed.content);
          return;
        }
      }

      handler(parsed);
    });
  }

  waitForReply(params: { fromAgent: string; taskId: string; timeoutMs: number }): Promise<string | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingReplies.delete(params.taskId);
        resolve(null);  // null = timeout
      }, params.timeoutMs);

      this.pendingReplies.set(params.taskId, (result) => {
        clearTimeout(timer);
        resolve(result);
      });
    });
  }
}
```

### 4. Orchestrator tích hợp (`src/orchestrator/index.ts`)

Thêm logic phân nhánh local vs remote khi delegate:

```typescript
// Trong AgentOrchestrator.processUserMessage()

private async delegateTask(targetAgentId: string, task: SwarmTask): Promise<string> {
  const isLocal = this.localAgents.has(targetAgentId);

  if (isLocal || !this.channelMessenger?.isAvailable()) {
    // Xử lý trực tiếp (hiện tại)
    return this.executeTaskLocally(targetAgentId, task);
  }

  // Remote: post lên channel, chờ reply
  const taskRef = `[task:${task.id}]`;
  const message = `@${targetAgentId} [${task.type}] ${task.prompt} ${taskRef}`;

  await this.channelMessenger.sendAsAgent(this.leaderId, message);

  const result = await this.channelMessenger.waitForReply({
    fromAgent: targetAgentId,
    taskId: task.id,
    timeoutMs: task.timeoutMs,
  });

  if (result === null) {
    // Timeout → fallback về local agent cùng role
    logger.warn({ taskId: task.id, targetAgentId }, 'Remote agent timeout, falling back');
    const fallback = this.findLocalAgentByRole(this.getAgentRole(targetAgentId));
    if (fallback) return this.executeTaskLocally(fallback, task);
    throw new Error(`Agent ${targetAgentId} không phản hồi và không có fallback`);
  }

  return result;
}
```

### 5. Xử lý human interruption

```typescript
// Trong startListening handler
if (parsed.fromHuman && parsed.mentions.includes(this.leaderId)) {
  logger.info({ content: parsed.content }, 'Human interruption received');

  // Cancel pending tasks nếu message có từ "dừng" / "stop" / "cancel"
  if (/dừng|stop|cancel/i.test(parsed.content)) {
    await this.cancelPendingTasks();
    await this.channelMessenger.sendAsAgent(
      this.leaderId,
      `@user Đã dừng. Bạn muốn làm gì tiếp theo?`
    );
    return;
  }

  // Treat như user message mới
  this.emit('humanMessage', { content: parsed.content, fromChannel: true });
}
```

### 6. Shared workspace mount (`src/container-runner.ts`)

```typescript
// Thêm vào buildMounts()
const workspacePath = path.join(GROUPS_DIR, 'workspace');
if (!fs.existsSync(workspacePath)) fs.mkdirSync(workspacePath, { recursive: true });

mounts.push({
  source: workspacePath,
  target: '/workspace/shared',
  readOnly: false,
});
```

**System prompt addition** (trong `container/agent-runner/src/index.ts`):

```
## Shared Workspace

Khi output dài hơn 400 ký tự:
- Lưu vào /workspace/shared/docs/{taskId}-{agentId}.md
- Mention path trong reply: "@nam [done] Kết quả tại docs/{taskId}-{agentId}.md [task:{taskId}]"

Khi cần đọc output của agent khác:
- File tại /workspace/shared/ theo path được mention trên channel
- Đọc file trước khi xử lý task tiếp theo
```

---

## Prevent message loops

Quan trọng: agent không được process message do chính mình gửi.

```typescript
// Trong listener
if (parsed.fromAgent && parsed.fromAgent === myAgentId) return;  // bỏ qua self-message

// Track processed taskIds để idempotent
if (parsed.taskId && this.processedTasks.has(parsed.taskId)) return;
this.processedTasks.add(parsed.taskId);
```

---

## Rollout strategy

1. Deploy với `teamChannel.enabled = false` (mặc định) → không có gì thay đổi
2. Test trên 1 instance, bật `enabled = true`
3. Verify agents post/receive message đúng
4. Thêm instance thứ 2 với `INSTANCE_AGENTS` khác nhau
5. Test cross-instance delegation
