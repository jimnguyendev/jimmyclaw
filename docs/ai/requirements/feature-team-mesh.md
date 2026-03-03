# Requirements: Team Mesh Communication

## Overview

Transform the current star-topology agent swarm into a real tech-company-style team where agents communicate horizontally, break down tasks intelligently, ask clarifying questions, and report progress — like real teammates on Slack.

## Business Goals

- Agents should feel like a real team: leader delegates, workers collaborate, anyone can ask questions
- Users watch the work happen in real-time via Discord/Telegram channel
- Tasks complete faster through parallel subtask execution
- System handles ambiguous requests gracefully via clarification loops

## Current State (Gap Analysis)

| Aspect | Current | Needed |
|--------|---------|--------|
| Topology | Star (leader ↔ worker only) | Mesh (any agent ↔ any agent) |
| Task planning | Keyword scoring | LLM-generated subtask breakdown |
| Clarification | None (guess and proceed) | Ask → wait → proceed |
| Roles | 5 hardcoded TypeScript types | Extensible via config |
| Progress | None | Typing/working status in channel |
| Context sharing | None between workers | Shared task context store |

## Functional Requirements

### FR-1: Horizontal Agent Delegation
- Worker agents can assign subtasks to other worker agents directly
- Messages flow: `worker-A → channel → worker-B` without going through leader
- Leader receives final aggregated result

### FR-2: LLM-Based Task Planning
- Leader uses LLM call to decompose complex tasks into subtask list
- Each subtask specifies: description, assigned role, dependencies, expected output
- Plan is posted to channel so team (and user) can see it

### FR-3: Clarification Protocol
- Any agent can post `[ask]` message before proceeding
- System pauses that agent's subtask and routes question to human
- On human reply, agent resumes with answer as additional context
- Timeout (5 min default) → agent proceeds with best guess, notes assumption

### FR-4: Custom Roles
- `AgentRole` no longer a hardcoded union type
- Roles defined in `config/agent-swarm.json` under `roles[]`
- Each role has: `id`, `description`, `defaultPrompt`, `canDelegate: boolean`
- System prompt auto-includes role description

### FR-5: Progress Indicators
- Agents post status to channel: `[thinking]`, `[working on X]`, `[done]`
- Typing indicator sent while LLM is streaming
- Status messages are ephemeral (auto-deleted after task done, or kept in thread)

### FR-6: Shared Task Context
- Each top-level task gets a context object: `{ taskId, goal, subtasks[], artifacts{} }`
- Agents can read/write artifacts (key-value: filename → content summary)
- Context persists in SQLite for the task lifetime

## Non-Functional Requirements

- Adding mesh delegation must not break existing single-agent fallback
- Clarification timeout must not block other running subtasks
- Custom roles must be backward-compatible with existing `agent-swarm.json`
- Progress messages should be throttled (max 1 per 3s per agent) to avoid spam

## Out of Scope

- Real-time voice/video agent communication
- Agent-to-agent direct DMs (all communication via team channel)
- Persistent agent memory across task sessions (handled by existing RAG)
