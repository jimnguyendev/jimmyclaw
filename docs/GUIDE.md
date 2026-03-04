# JimmyClaw — Hướng Dẫn Sử Dụng

> Phiên bản: 1.2+ | Cập nhật: 2026-03

---

## Mục Lục

1. [Tổng quan hệ thống](#1-tổng-quan-hệ-thống)
2. [API Keys cần thiết](#2-api-keys-cần-thiết)
3. [Cài đặt — macOS / Linux (native)](#3-cài-đặt--macos--linux-native)
4. [Cài đặt — VPS với Docker](#4-cài-đặt--vps-với-docker)
5. [Cấu hình cơ bản](#5-cấu-hình-cơ-bản)
6. [CLI Dashboard](#6-cli-dashboard)
7. [Agent Swarm — Team AI](#7-agent-swarm--team-ai)
8. [Kênh giao tiếp nhóm (Discord / Telegram)](#8-kênh-giao-tiếp-nhóm-discord--telegram)
9. [Multi-container — Scale agents](#9-multi-container--scale-agents)
10. [Use Cases](#10-use-cases)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. Tổng Quan Hệ Thống

JimmyClaw là một AI assistant cá nhân chạy trên một tiến trình Bun duy nhất. Các AI agent chạy bên trong container Linux được cô lập hoàn toàn (Apple Container trên macOS, Docker trên Linux/VPS).

### Kiến trúc

```
Người dùng (WhatsApp / Telegram / Discord)
        │
        ▼
 ┌─────────────────────────────────────┐
 │         JimmyClaw Daemon (Bun)       │
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
        ▼ docker run / docker exec
  jimmyclaw-agent container
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
| **CLI** | `jimmyclaw` command để quản lý daemon, agents, config, logs |

---

## 2. API Keys Cần Thiết

| Key | Bắt buộc | Mục đích |
|-----|---------|---------|
| `ANTHROPIC_API_KEY` | Có* | Claude models |
| `CLAUDE_CODE_OAUTH_TOKEN` | Có* | Claude subscription |
| `Z_AI_API_KEY` | Không | Z.ai / GLM models (rẻ hơn cho worker agents) |
| `OPENROUTER_API_KEY` | Không | RAG embeddings |

*Cần ít nhất một trong hai Anthropic keys.

> **Tiết kiệm chi phí:** Dùng `Z_AI_API_KEY` với các model GLM (glm-4.7-flash, glm-5) cho worker agents. Chỉ dùng Claude cho leader và các task quan trọng.

---

## 3. Cài Đặt — macOS / Linux (native)

Dành cho máy cá nhân, development, hoặc khi không muốn dùng Docker.

### Yêu cầu

| Phần mềm | Phiên bản |
|---------|----------|
| **Bun** | 1.2+ |
| **Claude Code** | Latest |
| **Docker** (macOS) hoặc **Apple Container** | — |

```bash
# Bun
curl -fsSL https://bun.sh/install | bash

# Claude Code
npm install -g @anthropic-ai/claude-code

# Container runtime — chọn một:

# macOS — Apple Container (nhẹ hơn, native Apple Silicon)
brew install --cask apple/container/container

# macOS / Linux — Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
```

### Cài đặt

```bash
git clone https://github.com/qwibitai/JimmyClaw.git
cd JimmyClaw
claude
```

Trong Claude Code, chạy setup wizard:

```
/setup
```

Wizard tự động:
- Chạy `bun install`
- Tạo `.env` với API keys
- Authenticate WhatsApp / Telegram
- Build agent container image
- Đăng ký daemon service (launchd trên macOS, systemd trên Linux)

### Thêm channel (tuỳ chọn)

```
/add-telegram      # Thêm Telegram
/add-gmail         # Thêm Gmail
```

### Khởi động

```bash
jimmyclaw start
jimmyclaw status
```

Qua service manager:
```bash
# macOS
launchctl kickstart -k gui/$(id -u)/com.jimmyclaw

# Linux
systemctl --user start jimmyclaw
```

---

## 4. Cài Đặt — VPS với Docker

Dành cho VPS Linux. Chỉ cần Docker — không cần cài Bun hay Claude Code trên host.

### Yêu cầu

- Docker Engine 24+
- Docker Compose v2

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
```

### Bước 1: Clone repo

```bash
git clone https://github.com/qwibitai/JimmyClaw.git /opt/jimmyclaw
cd /opt/jimmyclaw
```

### Bước 2: Chuẩn bị thư mục và `.env`

```bash
bash docker-prepare.sh /opt/jimmyclaw
```

Script tự tạo:
- `groups/`, `store/`, `data/`, `config/` — thư mục dữ liệu bind-mount ra host
- `.env` từ `.env.example`
- Tự detect `DOCKER_GID` và ghi vào `.env`

Sau đó điền API keys:

```bash
nano /opt/jimmyclaw/.env
```

```env
ANTHROPIC_API_KEY=sk-ant-...
# Hoặc:
CLAUDE_CODE_OAUTH_TOKEN=...

# Tuỳ chọn — rẻ hơn cho worker agents:
Z_AI_API_KEY=...

# Channel
TELEGRAM_BOT_TOKEN=...
```

### Bước 3: Build agent container image

Agent container (`jimmyclaw-agent`) là sandbox chạy Claude Agent SDK bên trong. Cần build một lần:

```bash
docker build -t jimmyclaw-agent:latest -f container/Dockerfile container/
```

### Bước 4: Start

```bash
docker compose -f docker-compose.yml \
  -f docker-compose.standalone.yml \
  -f docker-compose.sandbox.yml \
  up -d --build
```

Kiểm tra:
```bash
docker compose logs -f jimmyclaw
```

### Cập nhật phiên bản mới

```bash
git pull
docker compose -f docker-compose.yml \
  -f docker-compose.standalone.yml \
  -f docker-compose.sandbox.yml \
  up -d --build
```

### Docker Compose overlays

| File | Mục đích |
|------|---------|
| `docker-compose.yml` | Base — service definition, env vars (bắt buộc) |
| `docker-compose.standalone.yml` | Bind mounts ra host disk — dễ edit `groups/`, backup |
| `docker-compose.sandbox.yml` | Mount Docker socket để spawn agent containers |

> **Lưu ý bảo mật:** `docker-compose.sandbox.yml` mount `/var/run/docker.sock` vào daemon container, cho phép nó tạo/xóa containers trên host. Chỉ dùng trên VPS do bạn kiểm soát.

---

## 5. Cấu Hình Cơ Bản

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
    },
    {
      "id": "mike",
      "role": "coder",
      "model": "glm-4.7-flash",
      "timeoutMs": 120000
    },
    {
      "id": "emma",
      "role": "reviewer",
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

### Thay đổi cấu hình qua CLI

```bash
jimmyclaw config set maxParallelTasks 6
jimmyclaw config reload    # Reload không cần restart
jimmyclaw config reset     # Reset về mặc định
```

---

## 6. CLI Dashboard

### Cài đặt CLI (native mode)

```bash
bun run build
echo 'alias jimmyclaw="bun /path/to/jimmyclaw/src/cli/index.ts"' >> ~/.zshrc
```

### Daemon management

```bash
jimmyclaw start
jimmyclaw stop
jimmyclaw restart
jimmyclaw status
jimmyclaw status --json    # JSON output cho scripting
```

### Agent management

```bash
jimmyclaw agent list

jimmyclaw agent add --id lisa --role writer --model glm-4.7-flash
jimmyclaw agent model sarah glm-5
jimmyclaw agent prompt mike        # Sửa system prompt
jimmyclaw agent rename andy boss
jimmyclaw agent remove lisa
```

### Tasks

```bash
jimmyclaw tasks
jimmyclaw task <task-id>
```

### Logs

```bash
jimmyclaw logs
jimmyclaw logs --lines 200
jimmyclaw logs --agent sarah
jimmyclaw logs --level error
jimmyclaw logs -f              # Realtime follow
```

### Team channel

```bash
jimmyclaw channel
jimmyclaw channel set discord --channel-id 123456789
jimmyclaw channel set telegram --channel-id -100123456789
jimmyclaw channel enable
jimmyclaw channel disable
```

### TUI Dashboard

```bash
jimmyclaw    # Không có argument → mở TUI
```

TUI hiển thị: uptime, memory, cost, danh sách agents (idle/busy), tasks đang chạy, live logs.

---

## 7. Agent Swarm — Team AI

### Cách hoạt động

Khi người dùng gửi yêu cầu phức tạp, **Andy (leader)** sẽ:

1. **Phân tích** — task > 50 từ hoặc có từ "and/then/also" → dùng TaskPlanner
2. **LLM plan** — chia nhỏ thành subtasks với dependencies
3. **Dispatch parallel** — subtasks không phụ thuộc nhau chạy song song
4. **Tổng hợp** — khi tất cả xong, Andy synthesize và trả lời user

```
User: "Research Node.js best practices rồi viết một REST API template"
                    │
              Andy (leader)
              classifies → complex task
                    │
           TaskPlanner.plan()
          ┌──────────────────────┐
          │ s1: sarah/researcher  │  deps: []
          │ s2: mike/coder        │  deps: [s1]
          └──────────────────────┘
                    │
          ┌─────────▼──────────┐
          │  Wave 1: s1 (sarah) │
          └─────────┬──────────┘
                    │ s1 done → kết quả pass vào context
          ┌─────────▼──────────┐
          │  Wave 2: s2 (mike)  │
          └─────────┬──────────┘
                    │
           Andy synthesizes → trả lời user
```

### Task classification tự động

| Từ khóa trong tin nhắn | Role được chọn |
|----------------------|----------------|
| research, find, analyze, tìm kiếm | researcher (Sarah) |
| code, implement, build, viết code | coder (Mike) |
| review, check, bug, cải thiện | reviewer (Emma) |
| write, document, guide, tài liệu | writer |
| organize, plan, coordinate | leader |

### Thêm agent / role mới

```json
// config/agent-swarm.json — thêm vào roles[]
{
  "id": "devops",
  "description": "Handles deployment, CI/CD, infrastructure",
  "defaultPrompt": "You are a DevOps engineer.",
  "keywords": ["deploy", "docker", "kubernetes", "nginx"]
}
```

```bash
jimmyclaw agent add --id ops-bot --role devops --model glm-4.7-flash
jimmyclaw config reload
```

---

## 8. Kênh Giao Tiếp Nhóm (Discord / Telegram)

Mỗi agent có bot riêng, giao tiếp trong một channel — giống team Slack thực tế.

### Setup Discord

**1. Tạo bot cho từng agent**

1. Vào [discord.com/developers/applications](https://discord.com/developers/applications)
2. Tạo application mới cho mỗi agent (Andy, Sarah, Mike, Emma)
3. Bot → Reset Token → copy token
4. Bật: `MESSAGE CONTENT INTENT`, `SERVER MEMBERS INTENT`, `PRESENCE INTENT`
5. Mời tất cả bots vào server

**2. Điền `.env`**

```env
DISCORD_BOT_TOKEN_ANDY=MTxxxxxxx...
DISCORD_BOT_TOKEN_SARAH=MTxxxxxxx...
DISCORD_BOT_TOKEN_MIKE=MTxxxxxxx...
DISCORD_BOT_TOKEN_EMMA=MTxxxxxxx...
```

**3. Lấy Channel ID**

Discord: Settings → Advanced → Developer Mode ON → chuột phải channel → Copy Channel ID.

**4. Kích hoạt**

```bash
jimmyclaw channel set discord --channel-id YOUR_CHANNEL_ID
jimmyclaw channel enable
jimmyclaw config reload
```

Hoặc dùng skill trong Claude Code: `/add-discord`

### Setup Telegram Bot Pool

```
/add-telegram-swarm
```

Skill hướng dẫn tạo bot pool cho từng agent qua @BotFather.

### Giao tiếp trong channel

```
[Andy]   @sarah Research Node.js best practices
[Sarah]  🤔 [thinking...]
[Sarah]  ✅ Đây là kết quả research...
[Andy]   @mike Implement REST API based on: [sarah's findings]
[Mike]   🔨 [working on: Implement REST API...]
[Mike]   ✅ Code đây...
[Andy]   Tổng hợp: [final answer to user]
```

---

## 9. Multi-container — Scale Agents

Chạy nhiều JimmyClaw instances trên cùng một VPS (hoặc nhiều VPS) — mỗi instance chạy một tập agents khác nhau, tất cả giao tiếp qua cùng Discord/Telegram channel.

### Kiến trúc

```
Discord/Telegram Channel (kênh giao tiếp chung)
              │
     ┌────────┴────────┐
     │                 │
Instance leader     Instance workers
INSTANCE_ID=leader  INSTANCE_ID=workers
Andy + Emma         Sarah + Mike
```

### Cấu hình

**Instance 1 — leader (`.env`):**

```env
INSTANCE_ID=leader
INSTANCE_AGENTS=andy,emma
DISCORD_BOT_TOKEN_ANDY=...
DISCORD_BOT_TOKEN_EMMA=...
TEAM_CHANNEL_PLATFORM=discord
DISCORD_TEAM_CHANNEL_ID=123456789
```

**Instance 2 — workers (`.env.workers`):**

```env
INSTANCE_ID=workers
INSTANCE_AGENTS=sarah,mike
DISCORD_BOT_TOKEN_SARAH=...
DISCORD_BOT_TOKEN_MIKE=...
TEAM_CHANNEL_PLATFORM=discord
DISCORD_TEAM_CHANNEL_ID=123456789
```

### Deploy trên cùng VPS

```bash
# Instance leader
INSTANCE_ID=leader INSTANCE_AGENTS=andy,emma \
docker compose -f docker-compose.yml \
  -f docker-compose.standalone.yml \
  -f docker-compose.sandbox.yml \
  -p jimmyclaw-leader up -d

# Instance workers (dùng cùng groups/ và store/)
INSTANCE_ID=workers INSTANCE_AGENTS=sarah,mike \
docker compose -f docker-compose.yml \
  -f docker-compose.standalone.yml \
  -f docker-compose.sandbox.yml \
  -p jimmyclaw-workers up -d
```

### Deploy trên nhiều VPS

Trên mỗi VPS, clone repo và chạy `docker-prepare.sh`, sau đó start với `INSTANCE_ID` và `INSTANCE_AGENTS` tương ứng. Cả hai VPS phải trỏ vào cùng Discord/Telegram channel.

Andy gửi `[jimmyclaw:assign]` message → Sarah/Mike trên instance khác nhận → xử lý → post kết quả → Andy nhận.

---

## 10. Use Cases

### Personal AI Assistant

Cấu hình tối thiểu: 1 agent (Andy), không cần team channel.

```bash
git clone ... && cd JimmyClaw && claude
/setup   # chọn WhatsApp hoặc Telegram
```

```
@Andy tóm tắt Hacker News hôm nay
@Andy nhắc tôi review code lúc 5pm hàng ngày
```

---

### Developer Workflow

4 agents mặc định: Andy (leader), Sarah (research), Mike (code), Emma (review).

```
@Andy build một REST API cho user management với tests
```

```
[Andy]  s1 → Sarah: Research best practices
        s2 → Mike: Implement (deps: s1)
        s3 → Emma: Review (deps: s2)
[Sarah] ✅ Best practices: ...
[Mike]  ✅ Code: ...
[Emma]  ✅ Review: 2 issues found...
[Andy]  ✅ Xong!
```

---

### Team Knowledge Base

Mỗi group chat → context riêng biệt với `groups/{name}/CLAUDE.md` và `groups/{name}/MEMORY.md`.

```markdown
# groups/engineering/CLAUDE.md
You help the engineering team. Check MEMORY.md for recent decisions.
```

```
@Andy ai đang on-call tuần này?
@Andy viết PR description cho branch feature/user-auth
```

---

### Scheduled Automation

```
@Andy mỗi sáng thứ Hai 8am, compile AI news từ Hacker News và gửi cho tôi
@Andy mỗi 5pm thứ Sáu, review git history tuần này và update CHANGELOG
```

JimmyClaw lưu vào SQLite scheduler và tự động execute theo lịch.

---

## 11. Troubleshooting

### Daemon không start

```bash
jimmyclaw logs --lines 50
bun src/index.ts    # Xem error trực tiếp
```

| Lỗi | Fix |
|-----|-----|
| `Missing ANTHROPIC_API_KEY` | Kiểm tra `.env` |
| `Socket already in use` | `rm -f store/jimmyclaw.sock` |
| `Container not found` | `docker build -t jimmyclaw-agent:latest -f container/Dockerfile container/` |

### Docker: agent container không spawn

```bash
# Kiểm tra HOST_PROJECT_ROOT có đúng không
docker exec jimmyclaw-jimmyclaw-1 env | grep HOST_PROJECT_ROOT

# Kiểm tra Docker socket accessible
docker exec jimmyclaw-jimmyclaw-1 docker info
```

Nếu `docker info` lỗi permission: kiểm tra `DOCKER_GID` trong `.env` khớp với GID thực trên host:
```bash
getent group docker | cut -d: -f3
```

### Agent không respond

```bash
jimmyclaw agent list
jimmyclaw logs --agent sarah
jimmyclaw restart
```

### Team channel không hoạt động

```bash
jimmyclaw channel
jimmyclaw logs | grep "bot token\|Missing bot\|Channel messenger"
```

| Lỗi | Fix |
|-----|-----|
| `Missing bot token for agent` | Kiểm tra `DISCORD_BOT_TOKEN_<AGENTID>` trong `.env` |
| `Failed to initialize channel messenger` | Bot chưa được mời vào server |
| Agents không nhận message | Kiểm tra intents đã bật trong Discord Developer Portal |

### Task timeout

```bash
jimmyclaw config set taskTimeoutMs 600000  # 10 phút
# Per-agent trong config/agent-swarm.json: "timeoutMs": 600000
```

### Reset hoàn toàn

```bash
jimmyclaw stop
rm -f store/jimmyclaw.sock
rm -f store/jimmyclaw.db    # CẢNH BÁO: xóa toàn bộ task history và memory
jimmyclaw start
```

Docker:
```bash
docker compose down
rm -rf store/ groups/ data/    # CẢNH BÁO: xóa toàn bộ dữ liệu
bash docker-prepare.sh /opt/jimmyclaw
docker compose ... up -d
```

---

## Tham Khảo Thêm

| Tài liệu | Mô tả |
|---------|-------|
| [docs/REQUIREMENTS.md](REQUIREMENTS.md) | Architecture decisions |
| [docs/SECURITY.md](SECURITY.md) | Security model |
| Discord community | [discord.gg/VDdww8qS42](https://discord.gg/VDdww8qS42) |

---

*JimmyClaw v1.2+. Gặp vấn đề không có trong guide: dùng `/debug` trong Claude Code hoặc hỏi Discord.*
