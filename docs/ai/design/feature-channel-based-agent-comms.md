---
phase: design
title: Channel-Based Agent Communication
description: Agents communicate through a real Discord/Telegram channel as their "office" — visible, cross-VPS, human-in-the-loop
status: planned
---

# Feature: Channel-Based Agent Communication

## Mục tiêu

Thay thế SQLite message queue ẩn bằng một Discord hoặc Telegram channel thực sự làm trung tâm giao tiếp giữa các agents. Mỗi agent có bot identity riêng, post và đọc message trên cùng một channel, như một team người thực.

**Lợi ích chính:**
- User quan sát team làm việc real-time
- Multiple NanoClaw instances trên nhiều VPS vẫn cộng tác được qua cùng một channel
- Human-in-the-loop tự nhiên: user nhảy vào channel và re-direct bất kỳ lúc nào
- Audit log miễn phí từ platform
- Không cần dashboard hay monitoring tool riêng

---

## Kiến trúc tổng quan

```
┌──────────────────────────────────────────────────────────────────┐
│                   Discord / Telegram Channel                      │
│                    "#team-workspace"                              │
│                                                                   │
│  🎯 Nam:   @Linh research về GraphQL so với REST                 │
│  🔬 Linh:  Đang tìm hiểu...                                     │
│  🔬 Linh:  Xong. Tóm tắt: [3 điểm]. Đầy đủ tại docs/gql.md   │
│  💻 Duc:   @Linh gửi tôi nội dung file đó                       │
│  🔬 Linh:  [paste nội dung]                                      │
│  💻 Duc:   @Nam đã viết xong example API                        │
│  🎯 Nam:   @Trang review code của @Duc                           │
│  🎨 Trang: Tìm thấy 2 issues: [chi tiết]                        │
│  🎯 Nam:   → User: Kết quả cuối cùng: [tổng hợp]               │
└──────────────────────────────────────────────────────────────────┘
         ↑                               ↑
  NanoClaw Instance A (VPS 1)    NanoClaw Instance B (VPS 2)
  Agents: Nam (leader), Linh     Agents: Duc (coder), Trang (reviewer)
```

---

## Thiết kế chi tiết

### 1. Mỗi agent = 1 bot identity

**Discord:** Mỗi agent là một Discord Application + Bot
**Telegram:** Mỗi agent là một Bot từ @BotFather

```json
// config/agent-swarm.json — cấu hình mới
{
  "teamChannel": {
    "platform": "discord",              // hoặc "telegram"
    "channelId": "1234567890",          // Discord channel ID hoặc Telegram chat ID
    "mentionPrefix": "@"
  },
  "leader": {
    "id": "nam",
    "role": "leader",
    "model": "claude-sonnet",
    "botToken": "BOT_TOKEN_NAM",
    "botId": "DISCORD_BOT_ID_NAM",      // Discord only
    "emoji": "🎯"
  },
  "workers": [
    {
      "id": "linh",
      "role": "researcher",
      "model": "glm-4.7-flash",
      "botToken": "BOT_TOKEN_LINH",
      "botId": "DISCORD_BOT_ID_LINH",
      "emoji": "🔬"
    },
    {
      "id": "duc",
      "role": "coder",
      "model": "glm-5",
      "botToken": "BOT_TOKEN_DUC",
      "botId": "DISCORD_BOT_ID_DUC",
      "emoji": "💻"
    },
    {
      "id": "trang",
      "role": "reviewer",
      "model": "glm-4.7-flash",
      "botToken": "BOT_TOKEN_TRANG",
      "botId": "DISCORD_BOT_ID_TRANG",
      "emoji": "🎨"
    }
  ]
}
```

---

### 2. Agent Communication Protocol

Thay thế `Messenger` (SQLite) bằng `ChannelMessenger` (Discord/Telegram API).

#### Message format chuẩn

```
@{target_agent} [{task_type}] {nội dung}
```

Ví dụ:
```
@linh [research] Tìm hiểu về GraphQL federation
@duc [code] Viết GraphQL server dựa trên spec ở docs/spec.md
@trang [review] Review code tại docs/server.ts
@all [broadcast] Task hoàn thành, tổng hợp đang xử lý
```

#### Mention routing

Mỗi NanoClaw instance chỉ xử lý message có @mention đến agent **của mình**:

```typescript
// src/orchestrator/channel-messenger.ts
class ChannelMessenger {
  // Agents thuộc instance này
  private localAgents: Set<string>;

  onChannelMessage(message: ChannelMessage): void {
    const mentions = parseMentions(message.text);

    for (const mention of mentions) {
      if (this.localAgents.has(mention)) {
        // Agent này là của instance mình → xử lý
        this.routeToLocalAgent(mention, message);
      }
      // Nếu không phải agent của mình → bỏ qua
      // Instance khác sẽ xử lý
    }
  }
}
```

---

### 3. Cross-VPS Communication Flow

```
VPS 1 (Instance A: Nam, Linh)          VPS 2 (Instance B: Duc, Trang)
─────────────────────────────          ──────────────────────────────
User → Nam: "Research + code GraphQL"
Nam phân loại:
  - research → @Linh
  - code     → @Duc (Instance B)

Nam post lên channel:
  "@Linh research GraphQL"
  "@Duc viết example code"

                  ↓ Discord/Telegram channel ↓

Linh (local):                          Duc (local):
nhận @Linh → xử lý                    nhận @Duc → xử lý

Linh post:                             Duc post:
"@Nam xong, kết quả: ..."             "@Nam code xong tại..."

                  ↓ Discord/Telegram channel ↓

Nam (local):
nhận cả 2 kết quả → tổng hợp → reply User
```

**Điều kiện để biết task hoàn thành:** Nam gửi task → chờ @mention từ đúng agents → timeout sau N giây nếu không nhận được.

---

### 4. Các loại message

| Type | Format | Ví dụ |
|------|--------|-------|
| Task assign | `@agent [type] nội dung` | `@linh [research] tìm hiểu X` |
| Task result | `@requester [done] kết quả` | `@nam [done] Đây là kết quả...` |
| Task failed | `@requester [failed] lý do` | `@nam [failed] Không tìm được thông tin` |
| Broadcast | `@all [info] thông báo` | `@all [info] Bắt đầu task mới` |
| Question | `@agent [ask] câu hỏi` | `@duc [ask] Cần dùng REST hay GraphQL?` |
| File share | `@agent [file] path: nội dung` | `@duc [file] docs/spec.md: [nội dung]` |

---

### 5. Shared Workspace (file-based)

Agents dùng channel để **điều phối**, còn nội dung dài thì **ghi ra file** trong shared workspace:

```
groups/
└── workspace/                    ← mount read/write cho tất cả agents
    ├── docs/                     ← tài liệu agents tạo ra
    │   ├── graphql-research.md   (Linh viết)
    │   ├── graphql-api.ts        (Duc viết)
    │   └── review-notes.md       (Trang viết)
    ├── tasks/
    │   └── active.md             ← task board hiện tại
    └── decisions.md              ← các quyết định đã được thống nhất
```

Khi nội dung quá dài để paste trên channel:
```
@duc [file] docs/graphql-research.md
```
→ Duc đọc file từ shared workspace thay vì đọc từ message.

---

### 6. Human-in-the-Loop

User có thể tham gia trực tiếp vào channel bất kỳ lúc nào:

```
User:  @duc dừng lại, dùng REST thay GraphQL
Duc:   Hiểu, đang điều chỉnh...
User:  @nam tổng hợp lại từ đầu với hướng mới
Nam:   Đã nhận, đang re-assign tasks...
```

NanoClaw nhận ra message từ human (dựa vào sender không phải bot) và route vào orchestrator như một task mới hoặc interruption.

---

## Các thành phần cần xây dựng

### Phase 1: Channel Messenger (thay SQLite messenger)

**File:** `src/orchestrator/channel-messenger.ts`

```typescript
interface ChannelMessenger {
  // Gửi message từ một agent lên channel
  sendAsAgent(agentId: string, text: string): Promise<void>;

  // Listen message từ channel, route đến agent local
  startListening(onMessage: (agentId: string, msg: ParsedMessage) => void): void;

  // Parse @mention và task type từ raw message
  parseMessage(text: string): ParsedMessage;

  // Chờ reply từ một agent cụ thể (với timeout)
  waitForReply(fromAgent: string, taskId: string, timeoutMs: number): Promise<string>;
}
```

**Discord implementation:** dùng `discord.js` — mỗi agent có `Client` riêng với token riêng
**Telegram implementation:** mở rộng `initBotPool()` hiện có — đã có sẵn gần đủ

### Phase 2: Multi-instance routing

**File:** `src/orchestrator/index.ts` — sửa `processUserMessage`

- Khi delegate task đến agent không thuộc instance này → post lên channel và **chờ reply** thay vì gọi trực tiếp
- Thêm `taskId` vào message để match reply đúng task
- Timeout handling: nếu không nhận reply sau `timeoutMs` → retry hoặc báo lỗi

### Phase 3: Shared workspace mount

**File:** `src/container-runner.ts`

```typescript
// Thêm mount shared workspace cho tất cả containers
mounts.push({
  source: path.join(process.cwd(), 'groups/workspace'),
  target: '/workspace/shared',
  readOnly: false,
});
```

**File:** system prompt của từng agent — hướng dẫn agent:
- Khi output dài > 500 chars: ghi ra file trong `/workspace/shared/docs/`
- Khi cần tài liệu từ agent khác: đọc từ `/workspace/shared/docs/`
- Tham chiếu file bằng đường dẫn ngắn: `docs/filename.md`

### Phase 4: Custom agent names

Đã có sẵn trong `config/agent-swarm.json`. Cần thêm:
- `/swarm rename {old} {new}` command
- Khi đổi tên Telegram bot: gọi `api.setMyName()` tự động
- Khi đổi tên Discord bot: gọi `client.user.setUsername()` tự động

---

## Sự khác biệt so với thiết kế hiện tại

| Hiện tại | Sau khi build |
|----------|--------------|
| SQLite message queue — ẩn | Discord/Telegram channel — visible |
| Single instance | Multi-instance cross-VPS |
| User không thấy agents nói chuyện | User xem real-time |
| Human không can thiệp được giữa chừng | Human-in-the-loop bất kỳ lúc |
| Nội dung kết quả trả về string | Kết quả lưu file, tham chiếu được |
| Agents không biết nhau đang làm gì | Agents thấy context đầy đủ |

---

## Giữ nguyên gì

- SQLite vẫn dùng để lưu task history, agent registry, cost tracking
- `Messenger` hiện tại giữ nguyên — `ChannelMessenger` là layer mới **bổ sung**, không thay thế hoàn toàn
- Delegation manager (`src/delegation/`) giữ nguyên cho intra-instance calls
- Quality gates, security module, tracing — không đổi

---

## Thứ tự implementation

```
1. ChannelMessenger (Discord trước vì có bot pool dễ quản lý)
   └── Parse @mention + task type
   └── Mỗi agent 1 Client với token riêng
   └── waitForReply với timeout

2. Orchestrator tích hợp ChannelMessenger
   └── Phân biệt local agent vs remote agent
   └── Cross-instance task delegation qua channel

3. Shared workspace mount
   └── container-runner.ts thêm mount
   └── Cập nhật system prompt agents

4. Telegram parity
   └── Mở rộng initBotPool() — đã có nền
   └── Same ChannelMessenger interface

5. Human-in-the-loop interruption handling
   └── Nhận diện human message trong channel
   └── Route vào orchestrator như interruption
```

---

## Cấu hình môi trường

```bash
# Discord
DISCORD_TEAM_CHANNEL_ID=1234567890
DISCORD_BOT_TOKEN_NAM=...
DISCORD_BOT_TOKEN_LINH=...
DISCORD_BOT_TOKEN_DUC=...
DISCORD_BOT_TOKEN_TRANG=...

# Telegram (dùng bot pool hiện có)
TELEGRAM_BOT_POOL_TOKENS=token1,token2,token3,token4
TELEGRAM_TEAM_CHAT_ID=-1001234567890

# Shared workspace
WORKSPACE_PATH=./groups/workspace
```

---

## Rủi ro và cách xử lý

| Rủi ro | Xử lý |
|--------|-------|
| Rate limit Discord/Telegram | Queue gửi message, exponential backoff |
| Agent trên VPS khác offline | Timeout + fallback về local agent cùng role |
| Message loop (agent reply → trigger agent khác) | Filter: chỉ process message có taskId chưa xử lý |
| Nội dung nhạy cảm lên channel | Option `privateMode`: DM thay vì channel |
| Cross-instance task orphaned | Leader poll channel sau timeout, re-assign nếu cần |
