---
phase: requirements
title: Anti-Hallucination System
description: Implement verification rules and citation requirements to reduce AI hallucinations
---

# Requirements & Problem Understanding

## Problem Statement
**What problem are we solving?**

AI models (especially older/smaller ones) can generate plausible-sounding but incorrect information. This includes:
- Inventing phone numbers, emails, addresses
- Guessing dates or times without verification
- Making up names or relationships
- Presenting speculation as fact

**Who is affected?**
- All NanoClaw users who rely on factual accuracy
- Users with older/smaller models (more prone to hallucination)
- Users in high-stakes scenarios (scheduling, contact info)

**Current situation:**
- No verification requirements in CLAUDE.md
- No citation format for sourced information
- Agent may guess when information is not found
- No "I don't know" behavior enforcement

## Goals & Objectives
**What do we want to achieve?**

### Primary Goals
1. Add verification rules to CLAUDE.md (all groups)
2. Require citations for factual claims
3. Enforce "I don't know" behavior when info not found
4. Provide structured format for verified responses

### Secondary Goals
- Confidence scoring for responses
- Warning labels for speculative content
- Source file linking in responses
- Multi-source verification for critical facts

### Non-goals
- Real-time fact-checking via web search
- Formal logic verification
- Mathematical proof checking

## User Stories & Use Cases
**How will users interact with the solution?**

### Story 1: Verified Contact Info
> As a user, I want accurate contact info with source, not guesses.

**Workflow:**
1. User asks "What's John's phone number?"
2. Agent searches memory for "John" and "phone"
3. If found: Returns with citation "Source: contacts.md#john"
4. If not found: Says "I don't have John's phone number recorded."

### Story 2: Schedule Verification
> As a user, I want accurate schedule info, not invented times.

**Workflow:**
1. User asks "When is my meeting tomorrow?"
2. Agent searches schedule files
3. If found: Returns with source citation
4. If multiple/conflicting: Notes discrepancy with sources
5. If not found: Offers to check calendar or set reminder

### Story 3: Speculation Labeling
> As a user, I want to know when agent is guessing vs certain.

**Workflow:**
1. User asks question with uncertain answer
2. Agent responds with confidence level
3. Low confidence responses include warning
4. User can request verification

### Edge Cases
- Conflicting information from multiple sources
- Partial information (have name, missing phone)
- Outdated information (old file vs new)
- Ambiguous queries (multiple "John"s)

## Success Criteria
**How will we know when we're done?**

- [ ] CLAUDE.md updated with verification rules
- [ ] Citation format defined and used
- [ ] "I don't know" behavior enforced
- [ ] Confidence levels for uncertain responses
- [ ] Source linking format standardized
- [ ] Works with all model types (old and new)

## Constraints & Assumptions
**What limitations do we need to work within?**

### Technical Constraints
- Must work via prompt engineering (no code changes to model)
- Must be compatible with Claude Agent SDK
- Cannot require external verification services

### Business Constraints
- Zero additional cost for verification
- Must not significantly increase response time
- Must work offline (no web verification)

### Assumptions
- Prompt engineering can reduce hallucinations
- Users prefer "I don't know" over wrong answers
- Citations help users verify information themselves
- Model temperature is already set appropriately

## Questions & Open Items
**What do we still need to clarify?**

1. Should citations be in response text or metadata?
2. How to handle multi-source conflicts in response?
3. Confidence threshold for "I don't know"?
4. Should there be a "force verify" command?
5. How to handle user-provided information (trust level)?
