---
phase: requirements
title: Sub-Agent Model Configuration
description: Allow configuring different Claude models for different sub-agents
---

# Requirements & Problem Understanding

## Problem Statement
**What problem are we solving?**

Currently, all sub-agents in NanoClaw inherit the same model as the main agent. This is inefficient because:
- Research tasks don't need the most capable (expensive) model
- Code review benefits from stronger models like Opus
- Simple tasks waste resources when using Sonnet/Opus
- No way to optimize cost/performance per task type

**Who is affected?**
- All users who use agent teams or sub-agents
- Users concerned about API costs
- Users who want optimal performance for specific tasks

**Current situation:**
- `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1'` enables agent teams
- All sub-agents use the same model as parent
- No configuration for per-agent model selection

## Goals & Objectives
**What do we want to achieve?**

### Primary Goals
1. Support per-sub-agent model configuration
2. Provide sensible defaults for common agent types (researcher, coder, reviewer)
3. Allow group-level configuration via JSON file

### Secondary Goals
- Support model fallback when configured model unavailable
- Log model usage per sub-agent for cost tracking
- Support custom agent definitions beyond presets

### Non-goals
- Dynamic model switching mid-conversation
- A/B testing different models
- Multi-provider support (OpenAI, etc.)

## User Stories & Use Cases
**How will users interact with the solution?**

### Story 1: Cost-Optimized Research
> As a user, I want research tasks to use Haiku (cheaper) while coding uses Sonnet.

**Workflow:**
1. User creates `agent-config.json` in group folder
2. Configures researcher agent with `model: "haiku"`
3. When agent spawns researcher sub-agent, it uses Haiku
4. Cost is reduced while maintaining quality

### Story 2: High-Quality Review
> As a user, I want code reviews to use Opus for best analysis.

**Workflow:**
1. User configures reviewer agent with `model: "opus"`
2. When agent creates TeamCreate for review, Opus is used
3. Review quality is maximized

### Story 3: Default Behavior
> As a user, I want sensible defaults without configuration.

**Workflow:**
1. No config file exists
2. System uses sensible defaults (researcher=haiku, coder=sonnet, reviewer=opus)
3. Everything works out of the box

### Edge Cases
- Invalid model name in config
- Model not available (API limitations)
- Config file malformed JSON
- Sub-agent type not in config (use default)

## Success Criteria
**How will we know when we're done?**

- [ ] `agent-config.json` schema defined
- [ ] Config file read and parsed at container start
- [ ] Sub-agents use configured models
- [ ] Fallback to default model when config invalid
- [ ] Logging shows which model each sub-agent used
- [ ] Documentation for available models and agent types

## Constraints & Assumptions
**What limitations do we need to work within?**

### Technical Constraints
- Must work with Claude Agent SDK's `agents` option
- Available models: `haiku`, `sonnet`, `opus`, `inherit`
- Config must be JSON (not YAML) for simplicity

### Business Constraints
- No additional API costs for configuration feature itself
- Must not break existing agent teams functionality

### Assumptions
- Claude Agent SDK supports programmatic agent definitions
- Users understand trade-offs between models
- Model names map to specific Claude versions

## Questions & Open Items
**What do we still need to clarify?**

1. Should config be per-group or global?
2. How to handle model version updates (claude-3-5 vs claude-4)?
3. Should there be a CLI command to validate config?
4. How to expose model usage in logs/metrics?
5. Can we support custom agent prompts in config?
