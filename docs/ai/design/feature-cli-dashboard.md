---
phase: design
title: CLI Dashboard
description: Interactive terminal UI và command-line interface để cấu hình và monitor NanoClaw
status: planned
---

# Feature: CLI Dashboard

## Mục tiêu

NanoClaw hiện tại là daemon chạy ngầm — cấu hình thông qua file `.env`, JSON, và chat commands trong Telegram/Discord. Tất cả mọi thứ phải có thể cấu hình trực tiếp từ terminal, đặc biệt hữu ích khi quản lý nhiều VPS.

---

## Hiện trạng

| Thứ | Cách làm hiện tại | Hạn chế |
|-----|-------------------|---------|
| Cấu hình cơ bản | Sửa `.env` tay | Không validate, không gợi ý |
| Cấu hình swarm | Chat `/swarm config set key val` | Phải mở Telegram/Discord |
| Xem trạng thái | Chat `/swarm status` | Không realtime |
| Xem logs | `cat store/logs/nanoclaw.log` | Không filter |
| Thêm agent | Chat `/swarm agent add ...` | Phải nhớ syntax |
| Restart service | `launchctl kickstart ...` | Lệnh dài, khó nhớ |

---

## Hai chế độ CLI

### Chế độ 1: Interactive TUI (`nanoclaw`)

Chạy `nanoclaw` không có argument → mở terminal dashboard fullscreen:

```
╔══════════════════════════════════════════════════════════════════╗
║  NanoClaw  v2.0   VPS-1   ● Running   [q]uit  [?]help           ║
╠═════════════════════╦════════════════════════════════════════════╣
║  AGENTS             ║  ACTIVITY LOG                              ║
║  ─────────────────  ║  ──────────────────────────────────────── ║
║  ● Nam   leader     ║  10:32 Nam → @Linh research GraphQL       ║
║    claude-sonnet    ║  10:33 Linh → researching...              ║
║  ● Linh  researcher ║  10:45 Linh → @Nam done, file: docs/..   ║
║    glm-4.7-flash    ║  10:46 Nam → @Duc write example code      ║
║  ● Duc   coder      ║  10:47 Duc → on it...                     ║
║    glm-5       busy ║  10:58 Duc → @Nam code ready              ║
║  ● Trang reviewer   ║  11:00 Trang → reviewing...               ║
║    glm-4.7-flash    ║                                            ║
║                     ║                                            ║
║  [a]dd [r]emove     ║                                            ║
║  [e]dit             ║                                            ║
╠═════════════════════╬════════════════════════════════════════════╣
║  TASK QUEUE         ║  SYSTEM                                    ║
║  ─────────────────  ║  ──────────────────────────────────────── ║
║  ⏳ research #a3f  ║  Channel:  Discord #team-workspace         ║
║  ⚙  code     #b2e  ║  Platform: Telegram + Discord              ║
║  ✓  review   #c1d  ║  Memory:   45MB / 512MB                    ║
║  ✓  write    #d0c  ║  Uptime:   2d 4h 12m                       ║
║                     ║  Tasks today: 47 (42 success, 5 failed)   ║
║  [t]ask detail      ║  Cost today: $0.12                        ║
╚═════════════════════╩════════════════════════════════════════════╝
```

**Keyboard navigation:**
- `Tab` / `Shift+Tab` — chuyển panel
- `a` — add agent (interactive prompt)
- `e` — edit agent được chọn
- `r` — remove agent được chọn
- `c` — mở config editor
- `l` — xem logs fullscreen
- `s` — service control (start/stop/restart)
- `q` — thoát TUI (daemon vẫn chạy)
- `?` — help

---

### Chế độ 2: Command Mode (`nanoclaw <command>`)

Dùng cho scripting, CI/CD, automation:

```bash
# --- Status & Monitor ---
nanoclaw status                        # tổng quan nhanh
nanoclaw status --json                 # output JSON cho scripting
nanoclaw agents                        # list agents
nanoclaw tasks                         # list tasks hiện tại
nanoclaw logs                          # tail logs realtime
nanoclaw logs --lines 100              # N dòng cuối
nanoclaw logs --agent linh             # filter theo agent
nanoclaw logs --level error            # filter theo level

# --- Agent Management ---
nanoclaw agent add <id> <role> <model>
nanoclaw agent remove <id>
nanoclaw agent rename <old> <new>
nanoclaw agent model <id> <model>
nanoclaw agent prompt <id>             # mở editor sửa system prompt

# --- Config ---
nanoclaw config show                   # in config hiện tại
nanoclaw config set <key> <value>      # sửa một key
nanoclaw config edit                   # mở $EDITOR
nanoclaw config reset                  # về default

# --- Channel ---
nanoclaw channel show                  # xem channel config
nanoclaw channel set discord <channelId>
nanoclaw channel set telegram <chatId>
nanoclaw channel test                  # gửi test message

# --- Service ---
nanoclaw start
nanoclaw stop
nanoclaw restart
nanoclaw service install               # register launchd/systemd
nanoclaw service uninstall

# --- Env / Secrets ---
nanoclaw env show                      # in keys (không in values)
nanoclaw env set <KEY> <VALUE>
nanoclaw env unset <KEY>
```

---

## Kiến trúc

```
src/cli/
├── index.ts              ← entry point, phân nhánh TUI vs command
├── commands/
│   ├── status.ts
│   ├── agents.ts
│   ├── tasks.ts
│   ├── logs.ts
│   ├── config.ts
│   ├── channel.ts
│   ├── service.ts
│   └── env.ts
├── tui/
│   ├── app.tsx           ← root Ink component
│   ├── panels/
│   │   ├── AgentsPanel.tsx
│   │   ├── ActivityPanel.tsx
│   │   ├── TasksPanel.tsx
│   │   └── SystemPanel.tsx
│   └── hooks/
│       ├── useAgents.ts
│       ├── useTasks.ts
│       └── useLogs.ts
└── shared/
    ├── api-client.ts     ← giao tiếp với daemon qua Unix socket
    └── formatter.ts      ← format output cho terminal
```

### Giao tiếp CLI ↔ Daemon

CLI không import code của daemon trực tiếp. Giao tiếp qua **Unix socket** (`store/nanoclaw.sock`):

```
CLI process                    Daemon process
──────────                     ──────────────
nanoclaw agents  →  socket  →  AgentRegistry.list()
                 ←  socket  ←  JSON response
```

Daemon expose một lightweight API server trên Unix socket. CLI connect vào để query và mutate state.

**Lý do dùng socket thay vì import trực tiếp:**
- CLI là process riêng, daemon là process riêng
- CLI có thể chạy khi daemon đang running mà không conflict
- Daemon không cần restart khi CLI thay đổi
- Nhiều CLI instance có thể connect cùng lúc

---

## Tech stack

| Thành phần | Thư viện | Lý do |
|-----------|---------|-------|
| TUI framework | `ink` (React cho CLI) | Bun compatible, component-based |
| Command parsing | `commander` | Lightweight, không cần config file |
| Interactive prompts | `@inquirer/prompts` | Select, input, confirm |
| Syntax highlighting | `chalk` | Đã quen thuộc |
| Table rendering | `cli-table3` | Cho agents/tasks list |
| Log tailing | native `fs.watch` | Không cần thêm dep |

`ink` phù hợp vì codebase đã dùng Bun — ink render React components ra terminal, dễ build panel layout như mockup trên.

---

## Daemon API (Unix socket)

Thêm vào `src/index.ts` hoặc file riêng `src/api-server.ts`:

```typescript
// Endpoints
GET  /status          → { uptime, platform, memory, tasksToday, cost }
GET  /agents          → AgentConfig[]
POST /agents          → add agent
PUT  /agents/:id      → update agent
DELETE /agents/:id    → remove agent

GET  /tasks           → SwarmTask[] (pending + processing)
GET  /tasks/:id       → SwarmTask detail

GET  /config          → SwarmConfigFile
PUT  /config          → update config (partial)
POST /config/reset    → reset to default
POST /config/reload   → reload from disk

GET  /logs?lines=N&agent=X&level=Y  → log lines
GET  /logs/stream     → SSE stream của logs realtime

POST /service/restart  → restart daemon (self-restart)
```

---

## package.json — bin field

```json
{
  "bin": {
    "nanoclaw": "./dist/cli/index.js"
  },
  "scripts": {
    "dev": "bun run src/index.ts",
    "dev:cli": "bun run src/cli/index.ts",
    "build": "bun build src/index.ts --outdir dist/daemon --target bun",
    "build:cli": "bun build src/cli/index.ts --outdir dist/cli --target bun"
  }
}
```

Sau khi `npm install -g` hoặc `bun link`, gõ `nanoclaw` từ bất kỳ đâu.

---

## UX flows quan trọng

### Thêm agent mới (interactive)

```
$ nanoclaw agent add

? Agent ID (tên): duc
? Role: (dùng mũi tên)
  ❯ researcher
    coder
    reviewer
    writer
? Model:
  ❯ glm-4.7-flash  (free)
    glm-5           (free)
    claude-haiku    ($0.25/M)
    claude-sonnet   ($3/M)
? Fallback model: glm-4.7-flash
? Customize system prompt? (y/N): n

✓ Agent "duc" thêm thành công
  Reload config? (Y/n): y
✓ Config reloaded
```

### Xem logs realtime

```
$ nanoclaw logs --agent duc --level info

[10:32:01] INFO  duc  Received task: write GraphQL example
[10:32:02] INFO  duc  Using model: glm-5
[10:32:45] INFO  duc  Task completed in 43s, 1240 tokens
[10:32:45] INFO  duc  Sending result to Nam
▋
```

### Config interactive

```
$ nanoclaw config edit

Current settings:
  maxParallelTasks:     4
  taskTimeoutMs:        300000  (5m)
  heartbeatIntervalMs:  30000   (30s)

? What to change? (dùng mũi tên)
  ❯ maxParallelTasks
    taskTimeoutMs
    heartbeatIntervalMs
    messageRetentionMs

? maxParallelTasks (hiện tại: 4): 6

✓ Updated. Restart required to apply? No (hot reload)
```

---

## Không build

- Web dashboard (browser-based) — ngoài scope, overkill cho personal tool
- Remote management qua HTTP (chỉ Unix socket local)
- Authentication cho CLI (local tool, dùng Unix socket permissions)
