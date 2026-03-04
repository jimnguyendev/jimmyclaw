---
phase: requirements
title: Agent Swarm - Multi-Agent Team Communication
description: Enable multiple AI agents to work together as a coordinated team with shared state and inter-agent communication
status: implemented
implemented_at: 2026-02-28
---

# Requirements: Agent Swarm

## Problem Statement
**What problem are we solving?**

JimmyClaw hiện tại chạy single agent (Claude) cho tất cả tasks. Điều này tạo ra:

1. **No parallelization** - Tasks phải xử lý sequential
2. **Cost inefficiency** - Tất cả requests dùng Claude, không tận dụng free models
3. **No specialization** - Một agent làm mọi thứ (research, code, review)
4. **No collaboration** - Không có cách để multiple agents làm việc cùng nhau
5. **Single point of failure** - Khi Claude down, không có fallback thực sự

**Who is affected?**
- Users muốn speed up work với parallel execution
- Users muốn cost optimization (dùng free models cho tasks đơn giản)
- Users muốn specialized agents (researcher, coder, reviewer)

**Current situation/workaround:**
- Manual switching giữa providers
- Sequential task execution
- No coordination layer

## Goals & Objectives

### Primary Goals

1. **Multi-agent orchestration** - Leader agent điều phối team
2. **Inter-agent communication** - Agents có thể gửi/nhận messages
3. **Task delegation** - Leader assign tasks to worker agents
4. **Shared memory** - Team knowledge accessible to all agents
5. **Parallel execution** - Multiple agents work simultaneously

### Secondary Goals

- Cost optimization qua free models
- Specialized agent roles (researcher, coder, reviewer)
- Real-time status tracking
- Graceful degradation khi agents fail

### Non-goals

- Multi-tenant (single user only)
- External API for agent control (internal use only)
- Complex routing rules (keep it simple)
- Web UI for agent management (CLI-first)

## User Stories & Use Cases

### Core User Stories

**US-1: Leader Delegates Research Task**
```
As a user
I want Andy (leader) to automatically delegate research to Sarah (researcher)
So that research is done by specialized agent with free model
```

**US-2: Parallel Task Execution**
```
As a user
I want multiple agents to work on different parts simultaneously
So that total time is reduced
```

**US-3: Agent Communication**
```
As Sarah (researcher)
I want to ask Mike (coder) a clarifying question
So that I can provide accurate research
```

**US-4: Shared Knowledge**
```
As any agent
I want to access team's shared memory
So that I don't duplicate work or miss context
```

**US-5: Task Status Tracking**
```
As Andy (leader)
I want to check status of delegated tasks
So that I can coordinate completion
```

### Use Case Scenarios

**Scenario 1: Build REST API (Team Effort)**
```
1. User: "Build a REST API for user management"
2. Andy (Leader):
   - Broadcasts: "Team, new project: REST API"
   - Assigns Sarah: "Research best practices"
   - Waits for Sarah's result
   - Assigns Mike: "Implement based on Sarah's research"
   - Waits for Mike's code
   - Assigns Emma: "Review Mike's code"
   - Collects feedback
   - Synthesizes and presents to user
```

**Scenario 2: Research Task (Parallel)**
```
1. User: "Compare Next.js, Remix, and Astro"
2. Andy (Leader):
   - Assigns Sarah: "Research Next.js pros/cons"
   - Assigns Mike: "Research Remix pros/cons"
   - Assigns Emma: "Research Astro pros/cons"
   - All three work in parallel
   - Andy synthesizes results
   - Presents comparison to user
```

**Scenario 3: Agent Collaboration**
```
1. Sarah (Researcher) needs clarification
2. Sarah sends message: "Mike, what's our coding standard for APIs?"
3. Mike responds: "We use REST with OpenAPI spec"
4. Sarah continues with informed research
```

### Edge Cases

- Agent goes offline during task
- Task takes too long (timeout)
- Conflicting responses from agents
- Circular delegation (A → B → A)
- Memory conflicts (two agents update same key)

## Success Criteria

### Must Have

- [ ] Spawn multiple agent instances
- [ ] Leader agent with delegation capability
- [ ] Inter-agent messaging (direct + broadcast)
- [ ] Task assignment and tracking
- [ ] Shared memory storage
- [ ] Agent health monitoring

### Should Have

- [ ] Parallel task execution
- [ ] Task result aggregation
- [ ] Agent role specialization
- [ ] Cost tracking per agent

### Nice to Have

- [ ] Dynamic agent spawning
- [ ] Agent performance metrics
- [ ] Automatic load balancing

### Acceptance Criteria

```gherkin
Feature: Agent Swarm Communication

Scenario: Leader delegates task to worker
  Given Andy is running as leader
  And Sarah is running as researcher
  When Andy assigns task "Research React 19" to Sarah
  Then Sarah receives the task
  And Sarah processes the task
  And Andy receives result notification

Scenario: Broadcast message to all agents
  Given 4 agents are running
  When Andy broadcasts "Team meeting in 5 minutes"
  Then all 3 other agents receive the message
  And each agent acknowledges receipt

Scenario: Shared memory access
  Given Sarah stores "project_type: REST API" in shared memory
  When Mike reads shared memory key "project_type"
  Then Mike receives "REST API"

Scenario: Agent goes offline
  Given Sarah is assigned a task
  And Sarah goes offline
  When timeout occurs
  Then Andy is notified of failure
  And Andy can reassign to another agent
```

## Constraints & Assumptions

### Technical Constraints

| Constraint | Description |
|------------|-------------|
| Single VPS | All agents run on same machine |
| SQLite | Shared database (no PostgreSQL) |
| HTTP/WebSocket | Communication protocol |
| Single user | No multi-tenant support |
| Container isolation | Each agent in own container (optional) |

### Resource Constraints

| Resource | Limit |
|----------|-------|
| Max agents | 4-8 per VPS |
| Memory per agent | 100-200 MB |
| Message size | 1 MB max |
| Task timeout | 5 minutes default |

### Assumptions

1. OpenCode CLI is installed for free model access
2. Claude API key available for leader agent
3. VPS has sufficient RAM (2GB+)
4. Network is reliable (localhost communication)

## Questions & Open Items

### Resolved

- ✅ Communication method: SQLite + HTTP notifications
- ✅ Agent roles: Leader, Researcher, Coder, Reviewer
- ✅ Models: Claude (leader), Gemini/Groq (workers via OpenCode)

### Open Questions

1. **Agent lifecycle**: Dynamic spawn or pre-configured?
   - Proposal: Pre-configured with startup script

2. **Message persistence**: How long to keep messages?
   - Proposal: 7 days, auto-cleanup

3. **Conflict resolution**: When two agents write same memory key?
   - Proposal: Last-write-wins with timestamp

4. **Authentication**: How to secure inter-agent communication?
   - Proposal: Shared secret in environment

### Research Needed

- [ ] OpenCode CLI subprocess management
- [ ] WebSocket vs HTTP for notifications
- [ ] Agent heartbeat mechanism
- [ ] Task queue persistence strategy
