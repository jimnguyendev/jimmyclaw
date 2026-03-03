# Implementation Plan: Team Mesh Communication

## Overview

5 phases. Each phase is independently deployable and tested. Start with Phase 1 (horizontal delegation) for immediate value, then layer on planning, clarification, custom roles, and progress indicators.

---

## Phase 1: Horizontal Agent Delegation (Mesh Topology)

**Goal**: Workers can assign subtasks to other workers via channel. No code changes required to individual agent logic — just message routing.

**Files to change**:
- `src/orchestrator/types.ts` — add `AgentMessageType` union
- `src/orchestrator/channel-messenger.ts` — parse new message format
- `src/orchestrator/index.ts` — `handleChannelMessage()` routes `assign` type

**Steps**:

1. **`types.ts`**: Add to `TaskType`:
   ```typescript
   export type TaskType = 'research' | 'code' | 'review' | 'write' | 'general' | 'done' | 'assign' | 'ask' | 'answer' | 'status' | 'plan' | 'artifact';
   ```

2. **`channel-messenger.ts`**: Update `parseMessage()` to detect `[nanoclaw:TYPE]` prefix in message text. Extract JSON payload after prefix.

3. **`index.ts` `handleChannelMessage()`**: Add cases:
   - `assign`: find target agent by id/role, call `delegateViaChannel()` with subtask description
   - Workers post `done` with `subtaskId` field for result tracking

4. **`delegateViaChannel()`**: Accept optional `subtaskId` param, include in the message sent to channel so reply can be correlated.

**Test**: Leader manually sends `[nanoclaw:assign]` message → target worker picks it up → posts `[nanoclaw:done]` → leader receives result.

---

## Phase 2: LLM-Based Task Planning

**Goal**: Leader uses LLM to break complex user requests into subtasks with explicit agent assignments.

**New files**:
- `src/orchestrator/task-planner.ts`
- `src/orchestrator/task-context-store.ts`

**Files to change**:
- `src/orchestrator/index.ts` — `processUserMessage()` uses TaskPlanner for complex tasks

**Steps**:

1. **`task-planner.ts`**:
   ```typescript
   export class TaskPlanner {
     constructor(private model: string, private agents: AgentConfig[]) {}

     async plan(taskDescription: string): Promise<TaskPlan> {
       // Build prompt: describe available agents + roles + task
       // Call Anthropic API (claude-haiku for speed/cost)
       // Parse JSON response
       // Validate subtask dep graph (no cycles)
       // Fallback: return single subtask if LLM fails
     }
   }
   ```

   Prompt template:
   ```
   You are a team lead. Break this task into subtasks for your team.
   Available agents: [list with roles and descriptions]
   Task: {description}
   Return JSON: { subtasks: [{ id, role, description, deps, expectedOutput }] }
   If task is simple enough for one agent, return single subtask.
   ```

2. **`task-context-store.ts`**:
   - `Map<taskId, TaskContext>` in memory
   - `getReadySubtasks(taskId)`: subtasks whose deps are all in `completedSubtasks`
   - Auto-cleanup after 1 hour (task TTL)

3. **`index.ts`** `processUserMessage()`:
   - Add complexity heuristic: if message > 50 words OR contains keywords like "and", "then", "also" → use TaskPlanner
   - Otherwise existing single-agent flow
   - After plan: dispatch all ready subtasks concurrently
   - On each `done`: check `getReadySubtasks()` and dispatch newly unblocked ones
   - On `isComplete()`: leader calls LLM to synthesize all results into final reply

**Test**: "Research Node.js best practices and write a summary doc" → planner returns 2 subtasks → both complete → synthesized reply.

---

## Phase 3: Clarification Protocol

**Goal**: Agents can ask the human a question and pause execution until answered.

**New files**:
- `src/orchestrator/clarification-handler.ts`

**Files to change**:
- `src/orchestrator/index.ts` — route `ask` messages from agents, route human replies to clarification handler
- `src/orchestrator/channel-messenger.ts` — detect if human reply is an answer to a pending question

**Steps**:

1. **`clarification-handler.ts`**:
   ```typescript
   export class ClarificationHandler {
     private pending = new Map<string, ClarificationRequest>();

     async ask(taskId: string, agentId: string, question: string, timeoutMs = 300_000): Promise<string> {
       // Post [nanoclaw:ask] to channel (via channel messenger)
       // Return promise that resolves when handleAnswer() called
       // Timeout: resolve with "[no answer - proceeding with best guess]"
     }

     handleAnswer(taskId: string, answer: string): boolean {
       // Find pending clarification for this taskId, resolve it
     }
   }
   ```

2. **`index.ts`** `executeTask()`: Pass `ClarificationHandler.ask` as a capability to the agent's system prompt context. Agent can include `[nanoclaw:ask] {"question": "..."}` in its output.

   Alternatively: after each LLM response chunk, check if response contains `[nanoclaw:ask]` and pause.

3. **`handleChannelMessage()`**: If `fromHuman=true` and `pendingClarifications.size > 0` for any active task → check if it's an answer → route to `ClarificationHandler.handleAnswer()`.

4. Channel messenger posts the question with a `@user` mention so human gets notified.

**Test**: Coder agent includes `[nanoclaw:ask] {"question": "Should I use JWT or sessions?"}` → channel shows question → user replies → coder continues with answer.

---

## Phase 4: Custom Roles via Config

**Goal**: `AgentRole` is no longer hardcoded. Roles defined in `config/agent-swarm.json`.

**New files**:
- `src/orchestrator/role-registry.ts`

**Files to change**:
- `src/swarm-config.ts` — `getAvailableRoles()` reads from registry
- `src/orchestrator/types.ts` — `AgentRole = string` (breaking change, must audit all type guards)
- `config/agent-swarm.json` — add `roles[]` array
- `src/orchestrator/index.ts` — `classifyTask()` uses registry keywords

**Steps**:

1. **`config/agent-swarm.json`** — add:
   ```json
   "roles": [
     { "id": "leader", "description": "...", "defaultPrompt": "...", "canDelegate": true, "keywords": ["organize","plan"] },
     { "id": "researcher", "description": "...", "defaultPrompt": "...", "canDelegate": false, "keywords": ["research","find","search"] },
     { "id": "coder", "description": "...", "defaultPrompt": "...", "canDelegate": false, "keywords": ["code","implement","build","fix","debug"] },
     { "id": "reviewer", "description": "...", "defaultPrompt": "...", "canDelegate": false, "keywords": ["review","check","test","quality"] },
     { "id": "writer", "description": "...", "defaultPrompt": "...", "canDelegate": false, "keywords": ["write","document","summarize","draft"] }
   ]
   ```

2. **`role-registry.ts`**: Singleton loaded at startup from config. `classifyTask(text)` replaces the hardcoded `TASK_KEYWORDS` map in `types.ts`.

3. **`types.ts`**: Change `AgentRole` to `type AgentRole = string`. Add `TASK_KEYWORDS` deprecation comment.

4. **`swarm-config.ts`**: `getAvailableRoles()` → `roleRegistry.getAllRoles().map(r => r.id)`.

5. **System prompt**: When creating agent context, auto-prepend role's `defaultPrompt` to the agent's custom `systemPrompt`.

**Test**: Add new role "devops" to config → restart → `nanoclaw agent add` shows devops as option → task containing "deploy" routes to devops agent.

---

## Phase 5: Progress Indicators

**Goal**: Agents post visible status updates to channel. Human can watch work happening in real-time.

**New files**:
- `src/orchestrator/progress-reporter.ts`

**Files to change**:
- `src/orchestrator/index.ts` — `executeTask()` calls progress reporter at key points

**Steps**:

1. **`progress-reporter.ts`**:
   ```typescript
   export class ProgressReporter {
     private lastReport = new Map<string, number>();
     private THROTTLE_MS = 3000;

     async report(agentId: string, taskId: string, status: 'thinking' | 'working' | 'done', detail?: string): Promise<void> {
       const now = Date.now();
       const last = this.lastReport.get(agentId) ?? 0;
       if (now - last < this.THROTTLE_MS) return;
       this.lastReport.set(agentId, now);

       const text = `[nanoclaw:status] ${JSON.stringify({ taskId, fromAgent: agentId, status, detail })}`;
       await channelMessenger.sendAs(agentId, text);
     }
   }
   ```

2. **`executeTask()`** wrap:
   ```typescript
   await progress.report(agentId, taskId, 'thinking');
   // ... LLM call starts streaming ...
   await progress.report(agentId, taskId, 'working', taskDescription.slice(0, 50));
   // ... LLM completes ...
   await progress.report(agentId, taskId, 'done');
   ```

3. Telegram: use `sendChatAction('typing')` for real typing indicator during LLM stream.

4. Discord: use message edit to update a "status embed" rather than spamming new messages.

**Test**: Trigger multi-agent task → Discord/Telegram channel shows: `[sarah is thinking...]`, `[sarah working on: researching Node.js best practices]`, `[mike working on: implementing API]` etc.

---

## Implementation Order & Dependencies

```
Phase 1 (mesh routing)
    ↓
Phase 2 (task planning) — requires Phase 1 for dispatch
    ↓
Phase 4 (custom roles) — required by Phase 2 for role-based assignment
    ↓
Phase 3 (clarification) — requires Phase 2 context store
    ↓
Phase 5 (progress) — can be done anytime after Phase 1
```

Suggested order: **1 → 4 → 2 → 5 → 3**
- Phase 4 (roles) is config-only, low risk, enables Phase 2 to work properly
- Phase 3 (clarification) last because it requires human-in-the-loop testing

---

## File Change Summary

| File | Action | Phase |
|------|--------|-------|
| `src/orchestrator/types.ts` | Add message types, change AgentRole to string | 1, 4 |
| `src/orchestrator/channel-messenger.ts` | Parse `[nanoclaw:TYPE]` prefix | 1 |
| `src/orchestrator/index.ts` | Route new msg types, use planner, progress | 1,2,3,5 |
| `src/orchestrator/task-planner.ts` | New: LLM-based task breakdown | 2 |
| `src/orchestrator/task-context-store.ts` | New: track subtask state | 2 |
| `src/orchestrator/clarification-handler.ts` | New: ask/answer flow | 3 |
| `src/orchestrator/role-registry.ts` | New: dynamic role definitions | 4 |
| `src/orchestrator/progress-reporter.ts` | New: throttled status updates | 5 |
| `src/swarm-config.ts` | Use role-registry | 4 |
| `config/agent-swarm.json` | Add `roles[]` array | 4 |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| LLM plan is wrong/invalid JSON | Validate + fallback to single-agent |
| Subtask dep cycle | Check with topological sort before dispatch |
| Channel flooded with status messages | 3s throttle + optional `progress: false` config flag |
| AgentRole string breaks type safety | Keep `KNOWN_ROLES` constant for validation in APIs |
| Clarification question floods channel | Only one pending clarification per agent at a time |
