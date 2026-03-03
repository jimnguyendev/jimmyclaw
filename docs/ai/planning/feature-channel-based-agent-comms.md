---
phase: planning
title: Channel-Based Agent Communication — Implementation Plan
description: Step-by-step plan to implement Discord/Telegram as the agent team communication channel
status: planned
---

# Implementation Plan: Channel-Based Agent Communication

## Tổng quan

Build 5 phases theo thứ tự phụ thuộc. Mỗi phase có thể deploy độc lập và rollback an toàn.

---

## Phase 1: ChannelMessenger — Discord

**Mục tiêu:** Agents gửi/nhận message qua Discord channel thay vì SQLite.

**Files cần tạo/sửa:**

| File | Thay đổi |
|------|---------|
| `src/orchestrator/channel-messenger.ts` | Tạo mới — interface + Discord implementation |
| `src/orchestrator/channel-message-parser.ts` | Tạo mới — parse `@mention [type] content` |
| `config/agent-swarm.json` | Thêm `teamChannel` và `botToken` cho từng agent |
| `.env.example` | Thêm các DISCORD_BOT_TOKEN_* vars |

**Nội dung `channel-messenger.ts`:**

```typescript
export interface ParsedChannelMessage {
  rawText: string;
  mentions: string[];          // agent ids được mention
  taskType?: string;           // research | code | review | done | failed | ask | file
  content: string;             // nội dung sau @mention [type]
  taskId?: string;             // nếu có trong message
  fromAgent?: string;          // agent gửi (nếu là bot)
  fromHuman: boolean;          // true nếu người gửi là human
  channelMessageId: string;    // Discord message ID
  timestamp: string;
}

export interface ChannelMessenger {
  sendAsAgent(agentId: string, text: string): Promise<void>;
  startListening(handler: (msg: ParsedChannelMessage) => void): void;
  stopListening(): void;
  waitForReply(params: {
    fromAgent: string;
    taskId: string;
    timeoutMs: number;
  }): Promise<string | null>;
}
```

**Acceptance criteria:**
- [ ] Nam post message lên Discord với identity "Nam" (bot riêng)
- [ ] Linh post message với identity "Linh" (bot khác)
- [ ] Parse `@linh [research] tìm hiểu X` → `{mentions: ['linh'], taskType: 'research', content: 'tìm hiểu X'}`
- [ ] `waitForReply` resolve khi agent target post reply, timeout sau 2 phút nếu không có

---

## Phase 2: Orchestrator tích hợp ChannelMessenger

**Mục tiêu:** Orchestrator dùng channel để delegate task, phân biệt local vs remote agent.

**Files cần sửa:**

| File | Thay đổi |
|------|---------|
| `src/orchestrator/index.ts` | Thêm `ChannelMessenger`, phân nhánh local/remote khi delegate |
| `src/orchestrator/types.ts` | Thêm `instanceId`, `remoteAgents` vào config |
| `src/swarm-config.ts` | Load `botToken` từ config cho từng agent |

**Logic routing mới:**

```
processUserMessage(prompt):
  1. Leader phân loại task → xác định target agent(s)
  2. Với mỗi target:
     a. localAgents.has(target) → gọi trực tiếp (hiện tại)
     b. không có trong local → post lên channel, waitForReply
  3. Tổng hợp kết quả từ cả local và remote
  4. Reply user
```

**Xử lý cross-instance:**

```
Instance B logic:
- startListening() trên channel
- Nhận message → parseMentions()
- mention là localAgent của B → processAsTask()
- Kết quả → sendAsAgent(agentId, "@requester [done] kết quả")
```

**Acceptance criteria:**
- [ ] VPS 1 (Nam, Linh) delegate task đến VPS 2 (Duc) qua channel
- [ ] Duc xử lý và reply, Nam nhận được kết quả
- [ ] Nếu Duc timeout → Nam fallback về local agent cùng role hoặc báo lỗi

---

## Phase 3: Shared Workspace

**Mục tiêu:** Agents lưu output dài ra file, agents khác đọc được.

**Files cần sửa:**

| File | Thay đổi |
|------|---------|
| `src/container-runner.ts` | Mount `groups/workspace` vào `/workspace/shared` |
| `container/agent-runner/src/index.ts` | Thêm hướng dẫn về shared workspace vào system prompt |
| `groups/workspace/` | Tạo thư mục với `.gitkeep` |

**System prompt addition:**

```
## Shared Workspace

Khi output dài hơn 400 ký tự, lưu vào file thay vì paste trực tiếp:
- Tài liệu, research: /workspace/shared/docs/{task-id}-{agent-id}.md
- Code: /workspace/shared/code/{task-id}-{agent-id}.{ext}
- Sau đó mention file path trong message: "@nam [done] Kết quả tại docs/task-123-linh.md"

Khi cần đọc output của agent khác:
- Đọc file từ /workspace/shared/ theo path được mention
```

**Acceptance criteria:**
- [ ] Linh viết research vào `/workspace/shared/docs/`
- [ ] Duc đọc được file đó từ container của Duc
- [ ] Path được mention trên channel, human đọc được

---

## Phase 4: Telegram Parity

**Mục tiêu:** Cùng functionality trên Telegram, dùng bot pool hiện có.

**Files cần sửa:**

| File | Thay đổi |
|------|---------|
| `src/orchestrator/channel-messenger.ts` | Thêm `TelegramChannelMessenger` implements interface |
| `src/channels/telegram.ts` | Expose `onMessage` handler cho orchestrator listen |
| `src/swarm-config.ts` | Load platform từ `teamChannel.platform` |

**Lưu ý:** Bot pool (`initBotPool`, `sendPoolMessage`) trong `telegram.ts` đã xử lý gần đủ phần send. Phần cần thêm chính là **listen** message từ channel và route về `ChannelMessenger`.

**Acceptance criteria:**
- [ ] Cùng test cases như Phase 1-2 nhưng trên Telegram
- [ ] Bot tự đổi tên theo agent id khi lần đầu gửi (đã có trong `sendPoolMessage`)

---

## Phase 5: Human-in-the-Loop Interruption

**Mục tiêu:** Human nhảy vào channel giữa chừng, agents nhận và điều chỉnh.

**Files cần sửa:**

| File | Thay đổi |
|------|---------|
| `src/orchestrator/channel-messenger.ts` | Nhận diện human message (sender không phải bot) |
| `src/orchestrator/index.ts` | Xử lý `humanInterruption` — cancel task hiện tại hoặc re-direct |

**Hai loại interruption:**
1. **Re-direct:** `@nam dừng lại, đổi hướng sang X` → Nam cancel tasks đang chờ, tạo tasks mới
2. **Inject context:** `@duc note thêm: dùng TypeScript strict mode` → Duc thêm vào context task đang chạy

**Acceptance criteria:**
- [ ] Human post trong channel → orchestrator nhận ra là human (không phải bot)
- [ ] `@nam dừng lại` → cancel pending tasks, Nam confirm và re-plan
- [ ] `@duc thêm context: ...` → Duc nhận interrupt, thêm vào task hiện tại

---

## Thứ tự ưu tiên

```
Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5
  (bắt buộc)         (song song   (song song  (sau cùng,
                      với Phase 2)  với Phase 3) phức tạp nhất)
```

Có thể ship sau Phase 2 — đã có value. Phase 3-5 là enhancement.

---

## Không thay đổi

- SQLite schema và `Messenger` hiện tại — giữ nguyên cho internal logging
- `Delegation` manager — vẫn dùng cho intra-instance calls đồng bộ
- `Quality gates`, `Security module`, `Tracing` — không liên quan
- `Agent registry` — vẫn dùng để track status và heartbeat

---

## Cấu hình mới cần thêm vào `.env`

```bash
# Chọn platform cho team channel
TEAM_CHANNEL_PLATFORM=discord     # hoặc "telegram"

# Discord — 1 token per agent
DISCORD_TEAM_CHANNEL_ID=          # channel ID để agents giao tiếp
DISCORD_BOT_TOKEN_NAM=
DISCORD_BOT_TOKEN_LINH=
DISCORD_BOT_TOKEN_DUC=
DISCORD_BOT_TOKEN_TRANG=

# Telegram — dùng bot pool
TELEGRAM_TEAM_CHAT_ID=            # group chat ID
TELEGRAM_BOT_POOL_TOKENS=token1,token2,token3,token4   # đã có

# Instance identity (để cross-VPS routing)
INSTANCE_ID=vps1                  # unique per VPS
INSTANCE_AGENTS=nam,linh          # agents thuộc instance này
```
