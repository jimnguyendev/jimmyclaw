---
phase: implementation
title: Memory Structure Implementation
description: Technical implementation guide for memory structure
---

# Implementation Guide

## Development Setup
**How do we get started?**

No special setup required. Memory structure is purely file-based.

**Prerequisites:**
- Access to `groups/main/` directory
- Basic understanding of Markdown

## Code Structure
**How is the code organized?**

```
groups/main/
├── CLAUDE.md           # System prompt (update with memory protocol)
├── MEMORY.md           # Long-term curated facts
├── memory/             # Daily logs
│   ├── 2026-02-27.md   # Today's log
│   └── .gitkeep        # Keep folder in git
├── knowledge/          # Structured data
│   ├── customers.md
│   ├── preferences.md
│   └── .gitkeep
└── conversations/      # Existing (no changes)
```

## Implementation Notes
**Key technical details to remember:**

### Creating MEMORY.md
```markdown
# Memory

> Long-term facts about the user. Update when learning something important.

## Preferences
- Response style: [concise/detailed]
- Language: [preferred language]
- Timezone: [user timezone]

## Contacts
### [Name]
- Email: [email]
- Role: [role]
- Notes: [any notes]

## Projects
### [Project Name]
- Status: [active/paused/completed]
- Priority: [high/medium/low]
- Notes: [key information]

## Key Decisions
- YYYY-MM-DD: [Decision made and rationale]
```

### Creating Daily Log Template
```markdown
# YYYY-MM-DD

## Session Notes
- [Notes from today's conversation]

## Tasks Completed
- [Tasks the agent completed]

## Important Facts
- [New facts learned that should be remembered]
```

### Updating CLAUDE.md
Add this section to `groups/main/CLAUDE.md`:

```markdown
## Memory

You have access to persistent memory in these locations:

### MEMORY.md
Long-term curated facts about the user. Read this at session start.
Update when you learn something important that should persist.

### memory/YYYY-MM-DD.md
Daily logs for session notes. Append-only during the day.
Read today's file and yesterday's file at session start.

### knowledge/
Structured data files for customers, projects, etc.
Organized by topic, searchable with Grep.

### Memory Protocol
1. **Session Start**: Read MEMORY.md, memory/today.md, memory/yesterday.md
2. **During Session**: 
   - Append notes to daily log
   - Update MEMORY.md for permanent facts
   - Create/update files in knowledge/ for structured data
3. **When User Says "Remember This"**: Write to appropriate location
```

## Integration Points
**How do pieces connect?**

- **Container Mount**: `groups/main/` → `/workspace/group/`
- **Agent Access**: Uses existing `Read`, `Write`, `Edit` tools
- **No Code Changes**: Purely documentation and file structure

## Error Handling
**How do we handle failures?**

| Scenario | Handling |
|----------|----------|
| File doesn't exist | Create on first write |
| File too large | Log warning, suggest splitting |
| Write fails | Log error, continue without saving |

## Performance Considerations
**How do we keep it fast?**

- MEMORY.md: Keep under 500 lines
- Daily logs: Auto-archive after 30 days (manual for now)
- Knowledge files: Split if over 500 lines

## Security Notes
**What security measures are in place?**

- Memory files are in user-controlled directory
- No secrets should be stored in memory files
- Files are version-controlled via git (user responsibility)
