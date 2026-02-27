---
phase: design
title: Anti-Hallucination System Design
description: Technical architecture for verification rules and citation system
---

# System Design & Architecture

## Architecture Overview
**What is the high-level system structure?**

```mermaid
graph TD
    subgraph User
        Q[Question]
    end
    
    subgraph Agent
        CLAUDE[CLAUDE.md]
        CLAUDE --> RULES[Verification Rules]
        
        RULES --> |before answering| CHECK{Info Found?}
        CHECK --> |Yes| CITE[Format with Citation]
        CHECK --> |No| DONT[Say "I don't know"]
        CHECK --> |Partial| WARN[Label as Uncertain]
        
        CITE --> RESP[Response]
        DONT --> RESP
        WARN --> RESP
    end
    
    subgraph Memory
        MEM[MEMORY.md]
        KNOW[knowledge/]
        CONV[conversations/]
    end
    
    Q --> CLAUDE
    CLAUDE --> |search| MEM
    CLAUDE --> |search| KNOW
    CLAUDE --> |search| CONV
    MEM --> CHECK
    KNOW --> CHECK
    CONV --> CHECK
```

**Key components:**
- **CLAUDE.md**: Contains verification rules in system prompt
- **Verification Rules**: Prompt engineering for factual accuracy
- **Citation Format**: Standardized source linking
- **Confidence System**: Uncertainty labeling

## Data Models
**What data do we need to manage?**

### Verification Rules (in CLAUDE.md)
```markdown
## Anti-Hallucination Rules

### Before Answering Factual Questions
1. **SEARCH**: Check MEMORY.md, knowledge/, and conversations/
2. **VERIFY**: Confirm information exists with exact wording
3. **CITE**: Include source file and section in response
4. **ADMIT**: Say "I don't have this information" if not found

### What to NEVER Do
- Invent phone numbers, emails, or addresses
- Guess dates, times, or schedules
- Make up names, relationships, or roles
- Present speculation as fact
- Fill in missing information from assumptions

### Citation Format
> Source: [filename.md#section]
> 
> [Your verified answer here]

### Confidence Levels
- **Verified**: Found in memory with source
- **Likely**: Deduced from related information
- **Uncertain**: Partial or conflicting information
```

### Response Format
```typescript
interface VerifiedResponse {
  // For verified information
  content: string;
  citation?: {
    file: string;
    section?: string;
    lines?: [number, number];
  };
  
  // For uncertain information
  confidence?: 'verified' | 'likely' | 'uncertain';
  warning?: string;
  
  // For unknown information
  notFound?: boolean;
  suggestion?: string; // e.g., "Would you like me to search the web?"
}
```

### Citation Format Examples
```
// Good citation
> Source: contacts.md#john-doe
> 
> John's phone number is +1-555-0123.

// Multiple sources
> Sources: 
> - preferences.md#communication
> - memory/2026-02-27.md#meeting-notes
> 
> You prefer morning meetings before 10am.

// Not found
I don't have Jane's email address recorded. Would you like me to:
1. Search your email history
2. Add it if you provide it
```

## API Design
**How do components communicate?**

### No Code Changes Required
This feature is implemented entirely through prompt engineering:
- Update CLAUDE.md with verification rules
- Update global/CLAUDE.md for all groups
- Agent follows rules via system prompt

### CLAUDE.md Sections to Add
```markdown
## Response Protocol

### For Factual Questions
1. Search memory files first
2. If found: Answer with citation
3. If not found: Say "I don't have this information recorded"
4. Offer alternatives when appropriate

### Citation Format
Always include source for facts:
> Source: [filename.md#section]
> [Answer]

### Uncertainty Labeling
When uncertain, prefix with:
"[Uncertain] Based on [X], it appears that..."
```

## Component Breakdown
**What are the major building blocks?**

### Files to Modify
| File | Change |
|------|--------|
| `groups/main/CLAUDE.md` | Add verification rules |
| `groups/global/CLAUDE.md` | Add verification rules (for all groups) |

### No New Code
This feature requires only documentation updates:
- Prompt engineering in CLAUDE.md
- No TypeScript changes
- No new dependencies

### CLAUDE.md Sections
| Section | Purpose |
|---------|---------|
| Anti-Hallucination Rules | Core verification protocol |
| Citation Format | Standardized source linking |
| Confidence Levels | Uncertainty labeling |
| What to Never Do | Prohibited behaviors |

## Design Decisions
**Why did we choose this approach?**

### Decision 1: Prompt Engineering over Code
- **Chosen**: Rules in CLAUDE.md
- **Alternatives**: Post-processing validation, separate verification model
- **Rationale**: No code changes, works with all models, immediate effect

### Decision 2: Mandatory Citations
- **Chosen**: Require citations for all facts
- **Alternatives**: Optional citations, confidence-only
- **Rationale**: Forces verification, builds trust, enables fact-checking

### Decision 3: "I Don't Know" Default
- **Chosen**: Prefer admitting ignorance over guessing
- **Alternatives**: Best-effort guessing, hedged responses
- **Rationale**: Reduces hallucinations, builds trust

### Decision 4: Global + Per-Group Rules
- **Chosen**: Rules in both global and main CLAUDE.md
- **Alternatives**: Global only, per-group only
- **Rationale**: Ensures all groups have rules, allows customization

## Non-Functional Requirements
**How should the system perform?**

### Effectiveness
- Reduce hallucination rate by >50% (subjective measure)
- 100% of factual responses include citation or "I don't know"

### Compatibility
- Works with all Claude models (Haiku, Sonnet, Opus)
- Works with older models via stronger prompt enforcement
- No breaking changes to existing functionality

### Maintainability
- Rules are version-controlled
- Easy to update/extend
- No code to maintain

### Performance
- No additional latency (prompt is pre-loaded)
- No API calls for verification
