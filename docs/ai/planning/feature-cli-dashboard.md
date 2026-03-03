---
phase: planning
title: CLI Dashboard — Implementation Plan
status: planned
---

# Implementation Plan: CLI Dashboard

## Thứ tự build

```
Phase 1: Unix socket API (daemon side)
    ↓
Phase 2: CLI commands (non-interactive)
    ↓
Phase 3: Interactive prompts (agent add/edit)
    ↓
Phase 4: TUI dashboard (Ink)
```

Mỗi phase hoạt động độc lập. Có thể ship sau Phase 2 — đã dùng được.

---

## Phase 1: Unix Socket API

**Mục tiêu:** Daemon expose API, CLI connect vào query/mutate.

**File mới:** `src/api-server.ts`

```typescript
import { serve } from 'bun';

export function startApiServer(deps: {
  agentRegistry: AgentRegistry;
  taskQueue: TaskQueue;
  swarmConfig: SwarmConfig;
  messenger: Messenger;
}) {
  const server = Bun.listen({
    unix: SOCKET_PATH,   // store/nanoclaw.sock
    socket: {
      data(socket, data) {
        const req = JSON.parse(data.toString());
        handleRequest(req, deps).then(res => {
          socket.write(JSON.stringify(res));
        });
      }
    }
  });
}
```

**Endpoints cần implement:**

```
GET /status
GET /agents
POST /agents
PUT /agents/:id
DELETE /agents/:id
GET /tasks
GET /config
PUT /config
POST /config/reset
POST /config/reload
GET /logs
GET /logs/stream   ← SSE qua socket
POST /service/restart
```

**Files sửa:**
- `src/index.ts` — khởi động `startApiServer()` sau khi init xong
- `src/config.ts` — thêm `SOCKET_PATH = path.join(STORE_DIR, 'nanoclaw.sock')`

**Acceptance criteria:**
- [ ] `echo '{"method":"GET","path":"/status"}' | nc -U store/nanoclaw.sock` trả về JSON
- [ ] Socket file được tạo khi daemon start
- [ ] Socket bị xóa khi daemon stop (cleanup on exit)

---

## Phase 2: CLI Commands

**File mới:** `src/cli/index.ts` — entry point

```typescript
import { program } from 'commander';

program.name('nanoclaw').version('2.0.0');

program.command('status').action(statusCmd);
program.command('agents').action(agentsCmd);
program.command('tasks').action(tasksCmd);
program.command('logs').option('--lines <n>').option('--agent <id>').action(logsCmd);

const agent = program.command('agent');
agent.command('add <id> <role> <model>').action(agentAddCmd);
agent.command('remove <id>').action(agentRemoveCmd);
agent.command('rename <old> <new>').action(agentRenameCmd);
agent.command('model <id> <model>').action(agentModelCmd);

const config = program.command('config');
config.command('show').action(configShowCmd);
config.command('set <key> <value>').action(configSetCmd);
config.command('reset').action(configResetCmd);
config.command('reload').action(configReloadCmd);

const service = program.command('service');
service.command('start').action(serviceStartCmd);
service.command('stop').action(serviceStopCmd);
service.command('restart').action(serviceRestartCmd);

// Không có subcommand → mở TUI
if (process.argv.length === 2) {
  openTui();
} else {
  program.parse();
}
```

**File mới:** `src/cli/shared/api-client.ts`

```typescript
export class ApiClient {
  async request(method: string, path: string, body?: unknown) {
    // Connect Unix socket → send request → parse response
  }
  async get(path: string) { return this.request('GET', path); }
  async post(path: string, body: unknown) { return this.request('POST', path, body); }
  async put(path: string, body: unknown) { return this.request('PUT', path, body); }
  async delete(path: string) { return this.request('DELETE', path); }
}
```

**Files mới:** `src/cli/commands/*.ts` — mỗi command 1 file

**package.json thêm:**
```json
{
  "bin": { "nanoclaw": "./dist/cli/index.js" },
  "scripts": {
    "build:cli": "bun build src/cli/index.ts --outdir dist/cli --target bun"
  },
  "dependencies": {
    "commander": "^12"
  }
}
```

**Acceptance criteria:**
- [ ] `nanoclaw status` in ra bảng có uptime, agents, task count
- [ ] `nanoclaw agents` in danh sách agents với model và status
- [ ] `nanoclaw agent add nam leader claude-sonnet` thêm agent thành công
- [ ] `nanoclaw logs` tail log realtime
- [ ] Tất cả commands có `--json` flag cho scripting

---

## Phase 3: Interactive Prompts

**Thêm vào commands khi thiếu argument:**

```bash
nanoclaw agent add          # ← không có args → interactive
nanoclaw agent add duc      # ← thiếu role → hỏi tiếp
nanoclaw agent add duc coder glm-5  # ← đủ args → direct
```

**Dependencies:**
```bash
bun add @inquirer/prompts
```

**File mới:** `src/cli/prompts/agent-prompt.ts`

```typescript
import { select, input, confirm } from '@inquirer/prompts';

export async function promptNewAgent(partial: Partial<AgentArgs>) {
  const id = partial.id ?? await input({ message: 'Agent ID:' });
  const role = partial.role ?? await select({
    message: 'Role:',
    choices: ['researcher', 'coder', 'reviewer', 'writer']
  });
  const model = partial.model ?? await select({
    message: 'Model:',
    choices: [
      { value: 'glm-4.7-flash', name: 'glm-4.7-flash (free)' },
      { value: 'glm-5',         name: 'glm-5 (free)' },
      { value: 'claude-haiku',  name: 'claude-haiku ($0.25/M)' },
      { value: 'claude-sonnet', name: 'claude-sonnet ($3/M)' },
    ]
  });
  return { id, role, model };
}
```

**Acceptance criteria:**
- [ ] `nanoclaw agent add` không args → hỏi từng bước, validate input
- [ ] `nanoclaw config edit` → select key → nhập value → confirm → apply
- [ ] `nanoclaw env set` → prompt nếu không có args

---

## Phase 4: TUI Dashboard (Ink)

**Dependencies:**
```bash
bun add ink react
bun add -d @types/react
```

**File mới:** `src/cli/tui/app.tsx`

```tsx
import { render, Box, Text, useInput, useApp } from 'ink';
import { AgentsPanel } from './panels/AgentsPanel.js';
import { ActivityPanel } from './panels/ActivityPanel.js';
import { TasksPanel } from './panels/TasksPanel.js';
import { SystemPanel } from './panels/SystemPanel.js';

export function App() {
  const { exit } = useApp();

  useInput((input) => {
    if (input === 'q') exit();
  });

  return (
    <Box flexDirection="column" height={process.stdout.rows}>
      <Header />
      <Box flexGrow={1}>
        <Box flexDirection="column" width="30%">
          <AgentsPanel />
          <TasksPanel />
        </Box>
        <Box flexDirection="column" flexGrow={1}>
          <ActivityPanel />
          <SystemPanel />
        </Box>
      </Box>
      <StatusBar />
    </Box>
  );
}

render(<App />);
```

**Hooks để fetch data từ socket:**

```typescript
// src/cli/tui/hooks/useAgents.ts
export function useAgents() {
  const [agents, setAgents] = useState<AgentConfig[]>([]);

  useEffect(() => {
    const client = new ApiClient();
    client.get('/agents').then(setAgents);

    // Poll mỗi 2s để refresh
    const interval = setInterval(() => {
      client.get('/agents').then(setAgents);
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  return agents;
}
```

**Acceptance criteria:**
- [ ] `nanoclaw` không args → TUI hiện ra
- [ ] Agents panel show status realtime (idle/busy)
- [ ] Activity panel stream log mới nhất
- [ ] Tasks panel show pending/processing tasks
- [ ] `a` key → add agent workflow (dùng prompts từ Phase 3)
- [ ] `q` key → thoát, daemon vẫn chạy

---

## Files cần tạo/sửa — tổng hợp

### Tạo mới
```
src/api-server.ts
src/cli/index.ts
src/cli/shared/api-client.ts
src/cli/shared/formatter.ts
src/cli/commands/status.ts
src/cli/commands/agents.ts
src/cli/commands/tasks.ts
src/cli/commands/logs.ts
src/cli/commands/config.ts
src/cli/commands/service.ts
src/cli/commands/env.ts
src/cli/prompts/agent-prompt.ts
src/cli/prompts/config-prompt.ts
src/cli/tui/app.tsx
src/cli/tui/panels/AgentsPanel.tsx
src/cli/tui/panels/ActivityPanel.tsx
src/cli/tui/panels/TasksPanel.tsx
src/cli/tui/panels/SystemPanel.tsx
src/cli/tui/hooks/useAgents.ts
src/cli/tui/hooks/useTasks.ts
src/cli/tui/hooks/useLogs.ts
```

### Sửa
```
src/index.ts        ← thêm startApiServer()
src/config.ts       ← thêm SOCKET_PATH
package.json        ← thêm bin, build:cli script, dependencies
```

---

## Dependencies mới

```json
{
  "dependencies": {
    "commander": "^12.0.0",
    "@inquirer/prompts": "^5.0.0",
    "ink": "^5.0.0",
    "react": "^18.0.0",
    "chalk": "^5.0.0",
    "cli-table3": "^0.6.0"
  }
}
```

---

## Không thay đổi

- Chat commands `/swarm ...` — vẫn giữ, hoạt động song song
- Daemon architecture — không đổi
- Config files format — không đổi
- `.env` file — không đổi
