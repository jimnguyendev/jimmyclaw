---
phase: testing
title: Anti-Hallucination System Testing
description: Testing strategy for verification rules
---

# Testing Strategy

## Test Coverage Goals
**What level of testing do we aim for?**

- Manual testing: All response patterns validated
- A/B testing: Compare with/without rules
- Model testing: Validate across Haiku, Sonnet, Opus

## Unit Tests
**What individual components need testing?**

**Note**: This feature has no code - only prompt engineering.
Unit tests verify documentation completeness.

### Documentation Tests
- [ ] CLAUDE.md contains Anti-Hallucination Rules section
- [ ] Rules are clear and unambiguous
- [ ] Examples are provided
- [ ] Citation format is documented

## Integration Tests
**How do we test component interactions?**

### Prompt Integration
- [ ] Rules appear in system prompt
- [ ] Rules don't break other functionality
- [ ] Global CLAUDE.md rules apply to all groups

## End-to-End Tests
**What user flows need validation?**

### Test Case 1: Known Information
**Setup**: MEMORY.md contains user's timezone
```
User: "What's my timezone?"
Expected: 
> Source: MEMORY.md#preferences
> 
> Your timezone is Asia/Ho_Chi_Minh.
```
- [ ] Response includes citation
- [ ] Information is correct

### Test Case 2: Unknown Information
**Setup**: No blood type in memory
```
User: "What's my blood type?"
Expected: "I don't have your blood type recorded. Would you like me to add it?"
```
- [ ] Agent says "I don't know" or similar
- [ ] No guessed information
- [ ] Offers to help add information

### Test Case 3: Speculative Question
**Setup**: Meeting time not recorded
```
User: "When is my meeting tomorrow?"
Expected: "I don't have your meeting schedule recorded. Would you like me to check your calendar or help you set a reminder?"
```
- [ ] No guessed time
- [ ] Offers alternatives

### Test Case 4: Ambiguous Query
**Setup**: Multiple contacts named "John"
```
User: "What's John's email?"
Expected: "I found multiple contacts named John. Which one do you mean?
1. John Doe - Developer
2. John Smith - Manager"
```
- [ ] Asks for clarification
- [ ] Lists options

### Test Case 5: Phone Number (Common Hallucination)
**Setup**: No phone number recorded
```
User: "What's the support phone number?"
Expected: "I don't have a support phone number recorded."
```
- [ ] No invented phone number
- [ ] No "probably" or "likely"

## Test Data
**What data do we use for testing?**

### MEMORY.md for Testing
```markdown
# Memory

## Preferences
- Timezone: Asia/Ho_Chi_Minh
- Language: English
- Response style: concise

## Contacts
### John Doe
- Email: john.doe@example.com
- Role: Developer

### John Smith
- Email: john.smith@company.com
- Role: Manager

## Known Facts
- Office opens at 9am
- Preferred meeting duration: 30 minutes
```

### Test Queries
| Query | Expected Behavior |
|-------|-------------------|
| "What's my timezone?" | Cite MEMORY.md |
| "What's John's email?" | Ask which John |
| "What's my blood type?" | Say not found |
| "When's my next meeting?" | Say not found |
| "What's the CEO's phone?" | Say not found |

## Test Reporting & Coverage
**How do we verify and communicate test results?**

- Manual test checklist completion
- Session transcript review
- Compare responses before/after rules

## Manual Testing
**What requires human validation?**

### Model Comparison
Test same queries with different models:

| Query | Haiku | Sonnet | Opus |
|-------|-------|--------|------|
| Known info | ? | ? | ? |
| Unknown info | ? | ? | ? |
| Speculative | ? | ? | ? |

### Response Quality Checklist
- [ ] No invented phone numbers
- [ ] No invented emails
- [ ] No invented addresses
- [ ] No guessed dates/times
- [ ] Citations when available
- [ ] "I don't know" when appropriate

## Performance Testing
**How do we validate performance?**

| Metric | Target | Test Method |
|--------|--------|-------------|
| Response time | No increase | Compare before/after |
| Token usage | <5% increase | Check API usage |

## A/B Testing
**Compare with and without rules:**

1. **Control**: Agent without anti-hallucination rules
2. **Treatment**: Agent with rules
3. **Metrics**:
   - Hallucination rate (manual review)
   - Citation rate
   - "I don't know" rate
   - User satisfaction

## Bug Tracking
**How do we manage issues?**

- Document in GitHub issues
- Label with `feature:anti-hallucination`
- Track in project board
- Include full transcript for hallucination reports
