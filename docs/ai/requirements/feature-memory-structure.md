---
phase: requirements
title: Memory Structure Enhancement
description: Implement OpenClaw-style memory with MEMORY.md, daily logs, and knowledge indexing
---

# Requirements & Problem Understanding

## Problem Statement
**What problem are we solving?**

NanoClaw currently uses passive memory where the agent must proactively read files to recall context. This leads to:
- Agent forgetting important information between sessions
- No semantic search capability for finding related past information
- No auto memory flush before context compaction
- Flat file structure that doesn't scale with growing knowledge

**Who is affected?**
- All NanoClaw users who rely on the assistant to remember preferences, facts, and context
- Users with long-running conversations that exceed context windows

**Current situation:**
- Memory stored in `conversations/*.md` (archived before compaction)
- Structured files like `customers.md`, `preferences.md` require manual reading
- No indexing or semantic search

## Goals & Objectives
**What do we want to achieve?**

### Primary Goals
1. Implement OpenClaw-style memory layer with MEMORY.md + memory/ folder structure
2. Add daily log system for session notes (append-only)
3. Create knowledge folder for structured, indexed data
4. Enable semantic search over memory files

### Secondary Goals
- Add auto memory flush before context compaction
- Support memory citations in responses
- Temporal decay for ranking recent vs old memories

### Non-goals
- Full RAG implementation (separate feature: rag-integration)
- Vector database setup (part of rag-integration)
- Multi-agent memory sharing

## User Stories & Use Cases
**How will users interact with the solution?**

### Story 1: Long-term Preferences
> As a user, I want my preferences to persist across sessions so that I don't have to repeat them.

**Workflow:**
1. User tells agent "Remember that I prefer concise responses"
2. Agent writes to MEMORY.md under preferences section
3. Next session, agent reads MEMORY.md and applies preference

### Story 2: Daily Context
> As a user, I want the agent to recall what we discussed yesterday without me repeating context.

**Workflow:**
1. Agent logs important notes to `memory/YYYY-MM-DD.md` during session
2. Next session, agent reads today + yesterday's daily logs
3. Context is restored without user intervention

### Story 3: Knowledge Retrieval
> As a user, I want to ask "What do you know about project X?" and get comprehensive answer.

**Workflow:**
1. Agent searches knowledge/ folder semantically
2. Returns consolidated information with citations
3. Indicates when information is not found

### Edge Cases
- Memory file doesn't exist yet (first session)
- Memory file exceeds size limits
- Conflicting information between MEMORY.md and daily logs

## Success Criteria
**How will we know when we're done?**

- [ ] MEMORY.md created in groups/main/ with proper structure
- [ ] memory/ folder with daily log files working
- [ ] knowledge/ folder for structured data
- [ ] Agent automatically reads memory at session start
- [ ] Agent writes to appropriate memory files during conversation
- [ ] Memory files are properly mounted in container

## Constraints & Assumptions
**What limitations do we need to work within?**

### Technical Constraints
- Must work within existing container architecture
- Cannot require external services (vector DB, etc.) for basic functionality
- Memory files must be human-readable Markdown

### Business Constraints
- Zero additional cost for basic memory features
- Must not significantly increase container startup time

### Assumptions
- Users have basic file system access for viewing memory files
- Claude Agent SDK's CLAUDE.md loading is sufficient for basic memory
- Semantic search will be added in rag-integration feature

## Questions & Open Items
**What do we still need to clarify?**

1. Should memory be per-group or shared across groups?
2. What's the maximum size for MEMORY.md before splitting?
3. Should daily logs auto-delete after N days?
4. How to handle memory conflicts (same fact, different values)?
5. Should there be a "forget" mechanism for users?
