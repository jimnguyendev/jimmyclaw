# Design: Team Mesh Communication

## Architecture Overview

```
Human → Channel → Leader
                    │
                    ▼ (LLM plan)
              ┌─────┴──────┐
              │  SubTask[]  │
              └─────┬──────┘
                    │ post plan to channel
                    ▼
         ┌──────────────────────┐
         │    Team Channel       │
         │  (Discord/Telegram)   │
         └──┬──────┬──────┬─────┘
            │      │      │
         sarah   mike   emma
       (research) (code) (review)
            │      │      │
            └──────┴──────┘
                   │
              aggregated
              results back
              to pendingChannelTasks
```

Agents communicate exclusively via the team channel. No direct P2P sockets. Channel is the single source of truth (and also human-readable audit log).

## Message Protocol Extensions

Extend `ParsedChannelMessage` with new message types:

```typescript
type AgentMessageType =
  | 'plan'       // leader posts subtask breakdown
  | 'assign'     // leader/worker assigns subtask to specific agent
  | 'ask'        // agent needs clarification from human or other agent
  | 'answer'     // human/agent answers a clarification question
  | 'status'     // agent posts progress update: thinking|working|done
  | 'artifact'   // agent posts an output artifact (code, doc, etc.)
  | 'done'       // existing: subtask complete with result

// Message body format (JSON in channel message):
// [nanoclaw:plan] { taskId, subtasks: [{id, role, description, deps}] }
// [nanoclaw:assign] { taskId, subtaskId, toAgent, description }
// [nanoclaw:ask] { taskId, subtaskId, fromAgent, question }
// [nanoclaw:answer] { taskId, subtaskId, toAgent, answer }
// [nanoclaw:status] { taskId, fromAgent, status: "thinking"|"working"|"done", detail? }
// [nanoclaw:artifact] { taskId, key, summary }
// [nanoclaw:done] { taskId, subtaskId?, result }
```

## Component Design

### 1. TaskPlanner (new)

```typescript
interface SubTask {
  id: string;
  role: AgentRole;        // which role should handle this
  description: string;    // what to do
  deps: string[];         // subtask IDs that must complete first
  expectedOutput: string; // what the result should look like
}

interface TaskPlan {
  taskId: string;
  goal: string;
  subtasks: SubTask[];
}

class TaskPlanner {
  async plan(task: SwarmTask, availableAgents: AgentConfig[]): Promise<TaskPlan>
  // Calls LLM with: task description + available agents + roles
  // Returns structured JSON plan
  // Falls back to single subtask if LLM fails
}
```

### 2. TaskContext Store (new)

```typescript
interface TaskContext {
  taskId: string;
  plan: TaskPlan;
  completedSubtasks: Map<string, string>;  // subtaskId → result
  artifacts: Map<string, string>;          // key → content/summary
  pendingClarifications: Map<string, ClarificationRequest>;
}

class TaskContextStore {
  private contexts = new Map<string, TaskContext>();

  create(taskId: string, plan: TaskPlan): TaskContext
  get(taskId: string): TaskContext | undefined
  recordResult(taskId: string, subtaskId: string, result: string): void
  recordArtifact(taskId: string, key: string, summary: string): void
  getReadySubtasks(taskId: string): SubTask[]  // deps all complete
  isComplete(taskId: string): boolean
  cleanup(taskId: string): void
}
```

### 3. ClarificationHandler (new)

```typescript
interface ClarificationRequest {
  taskId: string;
  subtaskId: string;
  fromAgent: string;
  question: string;
  resolve: (answer: string) => void;
  timeout: ReturnType<typeof setTimeout>;
}

class ClarificationHandler {
  private pending = new Map<string, ClarificationRequest>();

  // Agent calls this, awaits answer
  async askQuestion(params: Omit<ClarificationRequest, 'resolve'|'timeout'>): Promise<string>

  // Human reply routes here
  handleAnswer(taskId: string, answer: string): void

  // Cleanup on task end
  cancelAll(taskId: string): void
}
```

### 4. AgentRoleRegistry (new)

```typescript
interface RoleDefinition {
  id: string;
  description: string;
  defaultPrompt: string;
  canDelegate: boolean;
  keywords: string[];   // for task classification
}

class AgentRoleRegistry {
  private roles = new Map<string, RoleDefinition>();

  loadFromConfig(roles: RoleDefinition[]): void
  getRole(id: string): RoleDefinition | undefined
  getAllRoles(): RoleDefinition[]
  classifyTask(description: string): string  // returns best role id
}
```

### 5. ProgressReporter (new)

```typescript
class ProgressReporter {
  private lastReport = new Map<string, number>();  // agentId → timestamp
  private THROTTLE_MS = 3000;

  async reportStatus(agentId: string, taskId: string, status: string, detail?: string): Promise<void>
  // Throttled: skips if last report < THROTTLE_MS ago
  // Posts [nanoclaw:status] message to channel
}
```

## Modified Components

### orchestrator/index.ts changes

**`executeTask()`** — wrap with progress reporting:
```
agent posts [status: thinking]
→ calls LLM
→ posts [status: working on X]
→ completes
→ posts [status: done]
```

**`processUserMessage()`** — for complex tasks, use TaskPlanner:
```
classifyTask(msg)
→ if singleAgent: existing flow
→ if needsTeam: TaskPlanner.plan() → post plan → dispatch subtasks in parallel
→ gather results via TaskContextStore
→ leader synthesizes final response
```

**`handleChannelMessage()`** — handle new message types:
```
case 'ask': route to ClarificationHandler
case 'answer': route to ClarificationHandler
case 'assign': dispatch new subtask to named agent
case 'artifact': store in TaskContextStore
case 'done': existing logic + check TaskContextStore.isComplete
```

**`delegateViaChannel()`** — accept optional `subtaskId` for result tracking

### swarm-config.ts changes

- Remove hardcoded `AgentRole` union (keep as `string` or `type AgentRole = string`)
- `getAvailableRoles()` reads from `AgentRoleRegistry`
- Default roles defined in `config/agent-swarm.json` instead of code

### config/agent-swarm.json changes

```json
{
  "roles": [
    {
      "id": "leader",
      "description": "Orchestrates team, breaks down complex tasks, synthesizes results",
      "defaultPrompt": "You are the team lead. Break complex tasks into subtasks...",
      "canDelegate": true,
      "keywords": ["organize", "plan", "coordinate"]
    },
    {
      "id": "researcher",
      "description": "Finds information, analyzes data, summarizes findings",
      "defaultPrompt": "You are a researcher. Find accurate information...",
      "canDelegate": false,
      "keywords": ["research", "find", "search", "analyze"]
    }
    // ... etc
  ]
}
```

## Data Flow: Complex Task

```
1. User: "Build a REST API for user management with tests"

2. Leader receives via handleChannelMessage(fromHuman=true)

3. TaskPlanner.plan():
   LLM outputs:
   {
     subtasks: [
       { id: "s1", role: "researcher", description: "Research best practices for REST user APIs", deps: [] },
       { id: "s2", role: "coder", description: "Implement CRUD endpoints based on s1 findings", deps: ["s1"] },
       { id: "s3", role: "reviewer", description: "Review code quality and security of s2", deps: ["s2"] },
       { id: "s4", role: "coder", description: "Write unit tests for endpoints", deps: ["s2"] }
     ]
   }

4. Leader posts [nanoclaw:plan] to channel (visible to team + user)

5. Leader dispatches s1 (sarah/researcher) — no deps

6. Sarah completes s1 → posts [nanoclaw:done] with result
   TaskContextStore records result, s2 and (conceptually s4) now unblocked

7. Leader dispatches s2 (mike/coder) with s1 result as context
   Simultaneously dispatches s4 preparation if possible

8. Mike mid-task: unsure about auth format → posts [nanoclaw:ask]
   User replies → ClarificationHandler resolves → Mike continues

9. Mike completes s2 → done, s3 and s4 now runnable in parallel

10. Emma (reviewer) and Mike (tests) run in parallel

11. Both done → TaskContextStore.isComplete() = true

12. Leader synthesizes all results → single reply to user
```

## Failure Handling

- **Subtask fails**: leader retries once with different agent of same role, then reports partial result
- **Clarification timeout**: agent proceeds with explicit note "Assumed X because no response"
- **No agent for role**: fall back to leader handling it directly
- **Channel disconnect mid-task**: existing timeout logic + TaskContextStore cleanup

## Backward Compatibility

- If `roles[]` not in `agent-swarm.json`, system uses hardcoded defaults (existing 5 roles)
- If task is simple (single keyword match), existing flow unchanged
- `delegateViaChannel` signature unchanged (subtaskId is optional)
