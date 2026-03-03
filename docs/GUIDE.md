# NanoClaw — Hướng Dẫn Sử Dụng

> Phiên bản: 1.1+ | Cập nhật: 2026-03

---

## Mục Lục

1. [Tổng quan hệ thống](#1-tổng-quan-hệ-thống)
2. [Yêu cầu cài đặt](#2-yêu-cầu-cài-đặt)
3. [Cài đặt nhanh](#3-cài-đặt-nhanh)
4. [Cấu hình cơ bản](#4-cấu-hình-cơ-bản)
5. [CLI Dashboard](#5-cli-dashboard)
6. [Agent Swarm — Team AI](#6-agent-swarm--team-ai)
7. [Kênh giao tiếp nhóm (Discord / Telegram)](#7-kênh-giao-tiếp-nhóm-discord--telegram)
8. [Use Cases triển khai](#8-use-cases-triển-khai)
9. [Chạy multi-instance trên nhiều VPS](#9-chạy-multi-instance-trên-nhiều-vps)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Tổng Quan Hệ Thống

NanoClaw là một AI assistant cá nhân chạy trên một tiến trình Bun duy nhất. Các AI agent chạy bên trong container Linux được cô lập hoàn toàn (Apple Container trên macOS, Docker trên Linux).

### Kiến trúc tóm tắt

```
Người dùng (WhatsApp / Telegram / Discord)
        │
        ▼
 ┌─────────────────────────────────────┐
 │         NanoClaw Daemon (Bun)       │
 │                                     │
 │  ┌──────────┐   ┌────────────────┐  │
 │  │ Channel  │   │  Orchestrator  │  │
 │  │ (WA/TG/  │──▶│  (Andy/Leader) │  │
 │  │  Discord)│   └───────┬────────┘  │
 │  └──────────┘           │           │
 │                  ┌──────▼───────┐   │
 │                  │  Agent Swarm │   │
 │                  │  sarah, mike │   │
 │                  │  emma, ...   │   │
 │                  └──────────────┘   │
 │                                     │
 │  SQLite ── Task Queue ── RAG Memory │
 └─────────────────────────────────────┘
        │
        ▼
  Container (isolated filesystem)
  → Claude Agent SDK
  → Web access, file I/O, Bash
```

### Thành phần chính

| Thành phần | Mô tả |
|-----------|-------|
| **Leader (Andy)** | Nhận yêu cầu từ người dùng, phân tích, giao việc cho workers |
| **Worker agents** | Sarah (research), Mike (code), Emma (review) — có thể thêm |
| **Team Channel** | Discord/Telegram channel nơi agents giao tiếp như team thực |
| **RAG Memory** | Tìm kiếm hybrid (BM25 + vector) trên memory files của từng group |
| **Task Queue** | SQLite-backed, hỗ trợ parallel execution với timeout |
| **CLI** | `nanoclaw` command để quản lý daemon, agents, config, logs |

---

## 2. Yêu Cầu Cài Đặt

### Bắt buộc

| Phần mềm | Phiên bản | Link |
|---------|----------|------|
| **Bun** | 1.2+ | https://bun.sh |
| **Claude Code** | Latest | `npm install -g @anthropic-ai/claude-code` |
| **Container runtime** | — | Apple Container (macOS) hoặc Docker |

### Container Runtime

**macOS (khuyến nghị):**
```bash
# Apple Container — nhẹ hơn Docker, native trên Apple Silicon
brew install --cask apple/container/container
```

**macOS / Linux (Docker):**
```bash
# Docker Desktop
# Download tại: https://www.docker.com/products/docker-desktop
```

**Linux (Docker Engine):**
```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
```

### API Keys cần thiết

| Key | Bắt buộc | Mục đích |
|-----|---------|---------|
| `ANTHROPIC_API_KEY` | Có* | Claude models |
| `CLAUDE_CODE_OAUTH_TOKEN` | Có* | Claude subscription |
| `Z_AI_API_KEY` | Không | Z.ai / GLM models (rẻ hơn) |
| `OPENROUTER_API_KEY` | Không | RAG embeddings |

*Cần ít nhất một trong hai Anthropic keys.

> **Tiết kiệm chi phí:** Sử dụng `Z_AI_API_KEY` với các model GLM (glm-4.7-flash, glm-5) cho worker agents. Chỉ dùng Claude cho leader và các task quan trọng.

---

## 3. Cài Đặt Nhanh

### Bước 1: Clone và mở Claude Code

```bash
git clone https://github.com/qwibitai/NanoClaw.git
cd NanoClaw
claude
```

### Bước 2: Chạy setup wizard

Trong Claude Code, gõ:
```
/setup
```

Claude sẽ tự động:
- Cài dependencies (`bun install`)
- Tạo file `.env` với các API keys
- Authenticate WhatsApp/Telegram
- Build container image
- Đăng ký daemon service (launchd trên macOS, systemd trên Linux)

### Bước 3: Thêm channel (nếu cần)

```
/add-telegram      # Thêm Telegram
/add-gmail         # Thêm Gmail integration
```

### Bước 4: Khởi động daemon

```bash
nanoclaw start
nanoclaw status
```

Hoặc qua service:
```bash
# macOS
launchctl kickstart -k gui/$(id -u)/com.nanoclaw

# Linux
systemctl --user start nanoclaw
```

---

## 4. Cấu Hình Cơ Bản

### File cấu hình chính: `config/agent-swarm.json`

```json
{
  "leader": {
    "id": "andy",
    "role": "leader",
    "model": "claude-sonnet",
    "fallbackModel": "glm-4.7-flash",
    "systemPrompt": "You are Andy, the team lead..."
  },
  "workers": [
    {
      "id": "sarah",
      "role": "researcher",
      "model": "glm-4.7-flash",
      "timeoutMs": 120000
    }
  ],
  "teamChannel": {
    "platform": "discord",
    "channelId": "YOUR_CHANNEL_ID",
    "enabled": false
  },
  "settings": {
    "maxParallelTasks": 4,
    "taskTimeoutMs": 300000
  }
}
```

### Biến môi trường (`.env`)

```env
ANTHROPIC_API_KEY=sk-ant-...
Z_AI_API_KEY=your-zai-key

# Team channel — Discord
DISCORD_BOT_TOKEN_ANDY=Bot_token_for_andy
DISCORD_BOT_TOKEN_SARAH=Bot_token_for_sarah
DISCORD_BOT_TOKEN_MIKE=Bot_token_for_mike
DISCORD_BOT_TOKEN_EMMA=Bot_token_for_emma

# Hoặc Telegram
TELEGRAM_BOT_TOKEN_ANDY=bot_token
TELEGRAM_BOT_TOKEN_SARAH=bot_token

# Multi-instance (nếu chạy nhiều VPS)
INSTANCE_ID=vps-01
INSTANCE_AGENTS=andy,sarah
```

### Thay đổi cấu hình qua CLI

```bash
# Xem config hiện tại
nanoclaw config

# Sửa một field
nanoclaw config set maxParallelTasks 6

# Reload config (không cần restart daemon)
nanoclaw config reload

# Reset về mặc định
nanoclaw config reset
```

---

## 5. CLI Dashboard

`nanoclaw` là công cụ quản lý daemon từ terminal.

### Cài đặt CLI

CLI được build tự động cùng project:
```bash
npm run build
# Binary: dist/cli/index.js
# Hoặc dùng trực tiếp: bun src/cli/index.ts
```

Thêm vào PATH:
```bash
echo 'alias nanoclaw="bun /path/to/nanoclaw/src/cli/index.ts"' >> ~/.zshrc
```

### Các lệnh chính

#### Daemon management

```bash
nanoclaw start              # Start daemon
nanoclaw stop               # Stop daemon
nanoclaw restart            # Restart daemon
nanoclaw status             # Xem trạng thái tổng quan
nanoclaw status --json      # Output JSON (cho scripting)
```

Output ví dụ:
```
● NanoClaw running
  Uptime: 2h 34m
  Memory: 128 MB / 512 MB
  Agents: 4
  Tasks: 0 pending, 1 processing
  Cost today: $0.023
```

#### Agent management

```bash
# Xem danh sách agents
nanoclaw agent list

# Thêm agent mới (interactive)
nanoclaw agent add
nanoclaw agent add --id lisa --role writer --model glm-4.7-flash

# Đổi model
nanoclaw agent model sarah glm-5

# Sửa system prompt
nanoclaw agent prompt mike

# Đổi tên agent
nanoclaw agent rename andy boss

# Xóa agent
nanoclaw agent remove lisa
```

#### Task management

```bash
# Xem tất cả tasks
nanoclaw tasks

# Xem chi tiết một task
nanoclaw task <task-id>
```

#### Logs

```bash
# Xem 50 dòng log gần nhất
nanoclaw logs

# Xem 200 dòng
nanoclaw logs --lines 200

# Filter theo agent
nanoclaw logs --agent sarah

# Filter theo level
nanoclaw logs --level error

# Follow realtime (như tail -f)
nanoclaw logs --follow
nanoclaw logs -f
```

#### Team channel

```bash
# Xem cấu hình channel hiện tại
nanoclaw channel

# Đổi sang Discord
nanoclaw channel set discord --channel-id 123456789

# Đổi sang Telegram
nanoclaw channel set telegram --channel-id -100123456789

# Bật/tắt channel
nanoclaw channel enable
nanoclaw channel disable
```

### TUI (Terminal UI)

Chạy `nanoclaw` không có argument để mở TUI dashboard:

```bash
nanoclaw
```

TUI hiển thị:
- Status panel: uptime, memory, cost
- Agents panel: danh sách agents và trạng thái (idle/busy)
- Tasks panel: tasks đang chạy và gần đây
- Logs panel: live log stream

---

## 6. Agent Swarm — Team AI

### Cách hoạt động

Khi người dùng gửi yêu cầu phức tạp, **Andy (leader)** sẽ:

1. **Phân tích độ phức tạp** — task > 50 từ hoặc có từ "and/then/also" → dùng TaskPlanner
2. **LLM tạo plan** — Andy gọi LLM để chia nhỏ thành subtasks với dependencies
3. **Dispatch parallel** — các subtasks không phụ thuộc nhau chạy song song
4. **Thu kết quả** — khi tất cả subtasks xong, Andy tổng hợp và trả lời người dùng

### Luồng xử lý task phức tạp

```
User: "Research Node.js best practices rồi viết một REST API template"
                    │
                    ▼
              Andy (leader)
              classifies → complex task
                    │
                    ▼
           TaskPlanner.plan()
          ┌─────────────────────┐
          │ s1: sarah/researcher │  deps: []
          │ s2: mike/coder      │  deps: [s1]
          └─────────────────────┘
                    │
          ┌─────────▼──────────┐
          │  Wave 1: s1 (sarah) │  ← parallel nếu có nhiều no-dep tasks
          └─────────┬──────────┘
                    │ s1 done
          ┌─────────▼──────────┐
          │  Wave 2: s2 (mike)  │  ← s1 result được pass vào context
          └─────────┬──────────┘
                    │ s2 done
                    ▼
           Andy synthesizes → trả lời user
```

### Cấu hình roles

Mỗi role được định nghĩa trong `config/agent-swarm.json`:

```json
{
  "roles": [
    {
      "id": "devops",
      "description": "Handles deployment, CI/CD, infrastructure",
      "defaultPrompt": "You are a DevOps engineer. Handle deployment and infrastructure tasks.",
      "canDelegate": false,
      "keywords": ["deploy", "docker", "kubernetes", "ci/cd", "nginx", "infrastructure"]
    }
  ]
}
```

Sau đó thêm agent với role mới:
```bash
nanoclaw agent add --id ops-bot --role devops --model glm-4.7-flash
nanoclaw config reload
```

### Task classification tự động

Leader tự động phân loại task dựa trên keywords và giao cho đúng agent:

| Từ khóa trong tin nhắn | Role được chọn |
|----------------------|----------------|
| research, find, analyze, tìm kiếm | researcher (Sarah) |
| code, implement, build, viết code | coder (Mike) |
| review, check, bug, cải thiện | reviewer (Emma) |
| write, document, guide, tài liệu | writer |
| organize, plan, coordinate | leader |

---

## 7. Kênh Giao Tiếp Nhóm (Discord / Telegram)

Tính năng này cho phép mỗi agent có một bot riêng, giao tiếp trong một channel duy nhất — giống như một team thực tế trên Slack.

### Setup Discord

**Bước 1: Tạo Discord Application và Bot cho từng agent**

1. Vào [discord.com/developers/applications](https://discord.com/developers/applications)
2. Tạo application mới cho mỗi agent (Andy, Sarah, Mike, Emma)
3. Trong mỗi app: Bot → Reset Token → copy token
4. Bật: `MESSAGE CONTENT INTENT`, `SERVER MEMBERS INTENT`, `PRESENCE INTENT`
5. Mời tất cả bots vào server của bạn

**Bước 2: Cấu hình `.env`**

```env
DISCORD_BOT_TOKEN_ANDY=MTxxxxxxx.Gxxxxx.xxxxxxxx
DISCORD_BOT_TOKEN_SARAH=MTxxxxxxx.Gxxxxx.xxxxxxxx
DISCORD_BOT_TOKEN_MIKE=MTxxxxxxx.Gxxxxx.xxxxxxxx
DISCORD_BOT_TOKEN_EMMA=MTxxxxxxx.Gxxxxx.xxxxxxxx
```

**Bước 3: Lấy Channel ID**

Trong Discord: Settings → Advanced → Developer Mode ON.
Chuột phải vào channel → Copy Channel ID.

**Bước 4: Kích hoạt**

```bash
nanoclaw channel set discord --channel-id YOUR_CHANNEL_ID
nanoclaw channel enable
nanoclaw config reload
```

Hoặc thông qua `/add-discord` skill trong Claude Code.

### Setup Telegram Bot Pool

```bash
# Trong Claude Code:
/add-telegram-swarm
```

Skill sẽ hướng dẫn tạo bot pool cho từng agent qua @BotFather.

### Giao tiếp trong channel

Sau khi setup, agents sẽ xuất hiện trong channel với bot riêng:

```
[Andy]   @sarah Research Node.js best practices
[Sarah]  🤔 [thinking...]
[Sarah]  ✅ Đây là kết quả research...
[Andy]   @mike Implement REST API based on: [sarah's findings]
[Mike]   🔨 [working on: Implement REST API...]
[Mike]   ✅ Code đây...
[Andy]   Tổng hợp: [final answer to user]
```

### Progress indicators

Agents tự động post status updates:
- `[thinking]` — đang xử lý yêu cầu
- `[working on: ...]` — đang thực hiện task cụ thể
- `[done]` — hoàn thành

### Clarification protocol

Khi agent cần hỏi trước khi làm, nó có thể post:
```
[Mike] 🤔 **Mike needs clarification**:
       Should I use JWT or sessions for auth?
       Please reply to help Mike proceed.
```

Người dùng reply trong channel → agent tiếp tục với câu trả lời.

---

## 8. Use Cases Triển Khai

### Use Case 1: Personal AI Assistant (cơ bản)

**Tình huống:** Một developer muốn AI trả lời câu hỏi qua WhatsApp.

**Cài đặt:**
```bash
git clone ... && cd NanoClaw
claude
/setup   # Chọn WhatsApp
```

**Sử dụng:**
```
@Andy tìm tất cả customer có doanh thu > $10k trong tháng này
@Andy tóm tắt Hacker News hôm nay
@Andy nhắc tôi review code lúc 5pm hàng ngày
```

**Cấu hình tối thiểu:** 1 agent (Andy), không cần team channel.

---

### Use Case 2: Developer Workflow Assistant

**Tình huống:** Developer muốn AI hỗ trợ code review, research, viết docs.

**Cài đặt:**
```bash
# Setup basic + thêm Discord channel
nanoclaw channel set discord --channel-id CHANNEL_ID
nanoclaw channel enable

# Agents: Andy (leader), Sarah (research), Mike (code), Emma (review)
# Đã có sẵn trong config mặc định
```

**Workflow mẫu:**

Gửi từ WhatsApp/Telegram:
```
@Andy build một REST API cho user management với tests
```

Trong Discord channel, team làm việc:
```
[Andy]  📋 Plan:
        s1 → Sarah: Research REST API best practices
        s2 → Mike: Implement endpoints (depends: s1)
        s3 → Emma: Review code (depends: s2)
        s4 → Mike: Write tests (depends: s2)
[Sarah] 🤔 [thinking...]
[Sarah] ✅ Best practices: ...
[Mike]  🔨 [working on: Implement endpoints...]
[Mike]  ✅ Code: ...
[Emma]  🔍 [working on: Review code...]
[Emma]  ✅ Review: Found 2 issues...
[Mike]  📝 Tests: ...
[Andy]  ✅ Xong! Đây là REST API template với tests...
```

---

### Use Case 3: Team Nội Bộ — Knowledge Base

**Tình huống:** Một team nhỏ (5-10 người) muốn dùng chung AI agent với memory riêng theo group chat.

**Cài đặt:**
- Mỗi group WhatsApp/Telegram → một context riêng biệt
- Mỗi group có `groups/{name}/MEMORY.md` và `groups/{name}/CLAUDE.md` riêng

**Cấu hình `groups/engineering/CLAUDE.md`:**
```markdown
# Engineering Team Context

You help the engineering team. You have access to:
- Our Jira project (via knowledge/jira.md)
- Code standards (via knowledge/coding-standards.md)
- Team contacts (via knowledge/team.md)

Always check MEMORY.md for recent decisions before answering.
```

**Sử dụng:**
```
@Andy ai đang on-call tuần này?
@Andy tìm tất cả các bug liên quan đến payment module
@Andy viết PR description cho branch feature/user-auth
```

---

### Use Case 4: Content Creator Workflow

**Tình huống:** Blogger/YouTuber muốn AI giúp research + viết + review nội dung.

**Cài đặt:** Thêm writer role:

```json
// config/agent-swarm.json — thêm vào workers[]
{
  "id": "lisa",
  "role": "writer",
  "model": "glm-4.7-flash",
  "systemPrompt": "You are Lisa, a content writer. Create engaging, SEO-friendly content with clear structure.",
  "timeoutMs": 180000
}
```

```bash
nanoclaw agent add --id lisa --role writer --model glm-4.7-flash
nanoclaw config reload
```

**Workflow:**
```
@Andy viết một bài blog 2000 từ về "AI trong năm 2026" kèm SEO optimization
```

Team làm việc:
```
[Sarah]  Research: Xu hướng AI 2026 từ các nguồn uy tín
[Lisa]   Writing: Bài blog dựa trên research
[Emma]   Review: Kiểm tra grammar, fact-check
[Andy]   Final: Bài đã polish, đây là output
```

---

### Use Case 5: Multi-Instance — Scale ra nhiều VPS

**Tình huống:** Workload lớn, muốn phân tán agents ra nhiều máy chủ.

**Kiến trúc:**
```
Discord/Telegram Channel (kênh giao tiếp chung)
        │
   ┌────┴────┐
   │         │
VPS-01      VPS-02
Andy        Sarah + Mike
(leader)    (workers)
Emma
```

**Cấu hình VPS-01 (`.env`):**
```env
INSTANCE_ID=vps-01
INSTANCE_AGENTS=andy,emma
DISCORD_BOT_TOKEN_ANDY=...
DISCORD_BOT_TOKEN_EMMA=...
```

**Cấu hình VPS-02 (`.env`):**
```env
INSTANCE_ID=vps-02
INSTANCE_AGENTS=sarah,mike
DISCORD_BOT_TOKEN_SARAH=...
DISCORD_BOT_TOKEN_MIKE=...
```

Cả hai VPS kết nối vào cùng một Discord/Telegram channel. Andy gửi `[nanoclaw:assign]` message → Sarah trên VPS-02 nhận và xử lý → post kết quả → Andy nhận.

**Deploy:**
```bash
# Trên cả hai VPS
git clone ... && cd NanoClaw
cp .env.example .env
# Sửa INSTANCE_ID và INSTANCE_AGENTS tương ứng
bun install
nanoclaw start
```

---

### Use Case 6: Scheduled Automation

**Tình huống:** Muốn AI tự động chạy task định kỳ không cần trigger.

**Cấu hình scheduled tasks** (từ WhatsApp/Telegram):
```
@Andy mỗi sáng thứ Hai 8am, compile AI news từ Hacker News và gửi cho tôi
@Andy mỗi 5pm thứ Sáu, review git history tuần này và update CHANGELOG
@Andy mỗi ngày 9am, kiểm tra uptime của server và báo cáo
```

NanoClaw lưu tasks vào SQLite scheduler và tự động execute theo lịch.

---

## 9. Chạy Multi-instance Trên Nhiều VPS

### Yêu cầu

- Tất cả instances phải kết nối vào **cùng một** Discord/Telegram channel
- Mỗi agent chỉ chạy trên **một** instance (không duplicate)
- Leader (Andy) nên chạy cùng instance với user input channel

### Setup từng bước

**Bước 1: Chọn channel platform**

Discord hoặc Telegram — cả team dùng cùng một kênh.

**Bước 2: Tạo bot cho mỗi agent** (như hướng dẫn ở mục 7)

**Bước 3: Deploy từng instance**

```bash
# Trên mỗi VPS
git clone https://github.com/qwibitai/NanoClaw.git nanoclaw-vps01
cd nanoclaw-vps01
nano .env
```

```env
# .env cho VPS-01 (chạy leader + emma)
ANTHROPIC_API_KEY=sk-ant-...
INSTANCE_ID=vps-01
INSTANCE_AGENTS=andy,emma
DISCORD_BOT_TOKEN_ANDY=...
DISCORD_BOT_TOKEN_EMMA=...
NANOCLAW_CHANNEL_PLATFORM=discord
NANOCLAW_CHANNEL_ID=123456789
```

**Bước 4: Cấu hình `config/agent-swarm.json`**

Trong `instance.localAgents`, chỉ liệt kê agents của instance đó:
```json
{
  "instance": {
    "id": "vps-01",
    "localAgents": ["andy", "emma"]
  }
}
```

**Bước 5: Khởi động**

```bash
bun install && npm run build
nanoclaw start
nanoclaw status
```

**Kiểm tra hoạt động:**
```bash
nanoclaw logs -f
# Bạn sẽ thấy: "Channel messenger initialized"
# Và khi có task: "Assigning subtask via channel" (remote) vs "Assigning subtask locally"
```

---

## 10. Troubleshooting

### Daemon không start

```bash
nanoclaw status
# Nếu: "Daemon không chạy"

# Kiểm tra logs
nanoclaw logs --lines 50

# Thử start thủ công (xem error trực tiếp)
bun src/index.ts
```

Lỗi thường gặp:
- `Missing ANTHROPIC_API_KEY` → Kiểm tra `.env`
- `Socket already in use` → `rm -f store/nanoclaw.sock && nanoclaw start`
- `Container not found` → `./container/build.sh`

### Agent không respond

```bash
# Kiểm tra agent đang busy hay idle
nanoclaw agent list

# Xem log của agent cụ thể
nanoclaw logs --agent sarah

# Nếu agent bị stuck, restart daemon
nanoclaw restart
```

### Team channel không hoạt động

```bash
# Kiểm tra config
nanoclaw channel

# Kiểm tra bot tokens
nanoclaw logs | grep "bot token\|Missing bot\|Channel messenger"
```

Lỗi thường gặp:
- `Missing bot token for agent` → Kiểm tra `DISCORD_BOT_TOKEN_AGENTID` trong `.env`
- `Failed to initialize channel messenger` → Bot chưa được mời vào server/group
- Agents không nhận message → Kiểm tra intents đã bật trong Discord Developer Portal

### Task bị timeout

Task mặc định timeout sau 5 phút. Để tăng:

```bash
nanoclaw config set taskTimeoutMs 600000  # 10 phút
# Hoặc per-agent trong config/agent-swarm.json:
# "timeoutMs": 600000
```

### Xem chi tiết lỗi

```bash
# Logs realtime với filter error
nanoclaw logs -f --level error

# Hoặc debug mode
DEBUG=* nanoclaw start
```

### Reset hoàn toàn

```bash
nanoclaw stop
rm -f store/nanoclaw.sock
rm -f store/nanoclaw.db    # CẢNH BÁO: xóa toàn bộ task history và memory
nanoclaw start
```

---

## Tham Khảo Thêm

| Tài liệu | Mô tả |
|---------|-------|
| [docs/REQUIREMENTS.md](REQUIREMENTS.md) | Architecture decisions |
| [docs/SECURITY.md](SECURITY.md) | Security model |
| [docs/ai/design/feature-team-mesh.md](ai/design/feature-team-mesh.md) | Team mesh architecture |
| [docs/ai/planning/feature-team-mesh.md](ai/planning/feature-team-mesh.md) | Team mesh implementation phases |
| Discord community | [discord.gg/VDdww8qS42](https://discord.gg/VDdww8qS42) |

---

*Tài liệu này được viết cho NanoClaw v1.1+. Nếu gặp vấn đề không có trong guide, hãy dùng `/debug` trong Claude Code hoặc hỏi trong Discord.*
