---
phase: implementation
title: Anti-Hallucination System Implementation
description: Technical implementation guide for verification rules
---

# Implementation Guide

## Development Setup
**How do we get started?**

**Prerequisites:**
- Access to `groups/main/CLAUDE.md`
- Access to `groups/global/CLAUDE.md`

**No code changes required** - this is pure prompt engineering.

## Code Structure
**How is the code organized?**

```
groups/
├── main/
│   └── CLAUDE.md     # Add verification rules here
└── global/
    └── CLAUDE.md     # Add verification rules here (for all groups)
```

## Implementation Notes
**Key technical details to remember:**

### Section to Add: Anti-Hallucination Rules

Add this to both `groups/main/CLAUDE.md` and `groups/global/CLAUDE.md`:

```markdown
## Anti-Hallucination Rules

### Before Answering Factual Questions

You MUST follow this protocol for ANY question asking for specific information:

1. **SEARCH**: Check your memory files first
   - Read MEMORY.md for long-term facts
   - Check memory/YYYY-MM-DD.md for recent notes
   - Search knowledge/ for structured data

2. **VERIFY**: Confirm the information exists
   - Look for exact matches, not assumptions
   - Check multiple sources if available
   - Note any conflicts or ambiguities

3. **CITE**: Include source with your answer
   - Format: `> Source: [filename.md#section]`
   - Include line numbers if specific

4. **ADMIT**: Say "I don't know" when appropriate
   - If not found: "I don't have this information recorded."
   - Offer alternatives: "Would you like me to search the web?"

### What to NEVER Do

**Absolutely never:**
- Invent phone numbers, emails, or addresses
- Guess dates, times, or schedules
- Make up names, relationships, or roles
- Present speculation as fact
- Fill in missing information from assumptions
- Say "probably" or "likely" without a source

### Citation Format

For verified information:
```
> Source: [filename.md#section]

[Your verified answer here]
```

For multiple sources:
```
> Sources:
> - filename1.md#section
> - filename2.md#section

[Your verified answer here]
```

### Confidence Levels

When you cannot verify completely:

- **[Verified]**: Found in memory with exact source
- **[Uncertain]**: Deduced from related information - explain your reasoning
- **[Not Found]**: Say "I don't have this information recorded"

### Example Responses

**Good (verified with citation):**
> Source: contacts.md#john-doe
> 
> John's phone number is +1-555-0123.

**Good (not found, honest):**
I don't have Jane's email address recorded. Would you like me to:
1. Add it if you provide it
2. Search your email history

**Bad (hallucination):**
Jane's email is probably jane@example.com. (NEVER DO THIS)

**Bad (guessing):**
I think the meeting is at 2pm. (NEVER DO THIS)
```

### Placement in CLAUDE.md

Add this section **after** the "Memory" section and **before** the "Communication" section.

## Integration Points
**How do pieces connect?**

- **CLAUDE.md**: Loaded as system prompt by Claude Agent SDK
- **Memory Files**: Read by agent to verify facts
- **No Code**: Purely prompt-based implementation

## Error Handling
**How do we handle failures?**

| Scenario | Expected Behavior |
|----------|-------------------|
| Info not found | Say "I don't have this information" |
| Conflicting info | Note conflict, show both sources |
| Ambiguous query | Ask for clarification |
| Memory empty | Politely explain no memory yet |

## Performance Considerations
**How do we keep it fast?**

- Rules are in system prompt (no additional latency)
- Agent reads memory files as needed
- No additional API calls

## Testing Checklist

After implementation, test with:

1. **Known fact**: "What's my timezone?" (should cite MEMORY.md)
2. **Unknown fact**: "What's my blood type?" (should say not found)
3. **Speculative**: "Will it rain tomorrow?" (should clarify uncertainty)
4. **Ambiguous**: "What's John's number?" (should ask which John)
5. **Old model**: Test with Haiku to verify rules work with weaker models
