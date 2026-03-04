---
phase: requirements
title: Multi-LLM Provider Support
description: Enable multiple LLM providers for flexibility, cost optimization, and resilience
---

# Requirements: Multi-LLM Provider Support

## Problem Statement
**What problem are we solving?**

JimmyClaw hiện tại chỉ hỗ trợ Claude thông qua Claude Agent SDK. Điều này tạo ra:
- **Vendor lock-in**: Phụ thuộc hoàn toàn vào Anthropic
- **Single point of failure**: Khi Claude API down, toàn bộ system không hoạt động
- **Cost inefficiency**: Không thể dùng model rẻ hơn cho task đơn giản
- **Privacy limitations**: Không support local models

**Who is affected?**
- Single users muốn flexibility trong LLM selection
- Users quan tâm về cost optimization
- Users cần privacy với local models

**Current situation/workaround:**
- Không có workaround - chỉ dùng được Claude
- Phải switch project khác nếu muốn dùng LLM khác

## Goals & Objectives
**What do we want to achieve?**

### Primary Goals
1. Support 5+ LLM providers: Claude, OpenAI, Gemini, Groq, Ollama (local)
2. Easy switching giữa providers (runtime, không cần restart)
3. Fallback mechanism khi provider chính fail
4. Per-task provider selection (task đơn giản → model rẻ)

### Secondary Goals
- Cost tracking per provider
- Latency comparison giữa providers
- Streaming support cho tất cả providers

### Non-goals
- Multi-tenant provider management (không cần cho personal use)
- Complex routing rules (keep it simple)
- Provider-specific features không universally available

## User Stories & Use Cases
**How will users interact with the solution?**

### Core User Stories

1. **As a user, I want to switch LLM providers at runtime**
   - `/switch-model gemini` → Switch to Gemini
   - `/switch-model claude` → Switch back to Claude
   - No restart required

2. **As a user, I want automatic fallback when provider fails**
   - Primary: Claude → Fallback: OpenAI → Fallback: Gemini
   - Auto-retry với exponential backoff
   - Notify user về fallback

3. **As a user, I want to use local models for privacy**
   - `/switch-model ollama:llama3`
   - All processing stays local
   - No API calls to external services

4. **As a user, I want to see cost per provider**
   - `/costs --today --by-provider`
   - Track token usage và costs
   - Export to CSV

5. **As a user, I want to specify provider per delegation**
   - `@researcher use gemini for this task`
   - Override default provider for specific task

### Edge Cases
- Provider API key expired/invalid
- Rate limit exceeded
- Network timeout
- Local model not available (Ollama not running)
- Streaming fails mid-response

## Success Criteria
**How will we know when we're done?**

### Must Have
- [ ] Support 5 providers: Claude, OpenAI, Gemini, Groq, Ollama
- [ ] Runtime switching without restart
- [ ] Fallback mechanism với 3 levels
- [ ] Streaming support cho all providers
- [ ] Cost tracking per provider

### Should Have
- [ ] Per-task provider override
- [ ] Latency comparison dashboard
- [ ] Provider health checks

### Nice to Have
- [ ] Auto provider selection based on task complexity
- [ ] Cost optimization suggestions

### Acceptance Criteria
```
GIVEN user has configured multiple providers
WHEN user sends "/switch-model gemini"
THEN system switches to Gemini immediately
AND next message uses Gemini

GIVEN primary provider (Claude) is down
WHEN user sends a message
THEN system automatically falls back to OpenAI
AND user is notified of fallback
AND response is generated successfully

GIVEN user has Ollama running locally
WHEN user sends "/switch-model ollama:llama3"
THEN system uses local Llama3 model
AND no external API calls are made
```

## Constraints & Assumptions
**What limitations do we need to work within?**

### Technical Constraints
- Must maintain compatibility với existing Claude Agent SDK integration
- Streaming must work consistently across providers
- Container isolation must not be compromised
- SQLite storage for cost tracking (no external DB)

### Business Constraints
- Zero additional infrastructure cost (use existing API keys)
- Single-user focus (no multi-tenant)

### Time/Budget Constraints
- Implementation: 2-3 days
- Testing: 1 day
- No paid services required

### Assumptions
- Users have their own API keys for each provider
- Ollama is installed locally if using local models
- Network connectivity is stable for cloud providers

## Questions & Open Items
**What do we still need to clarify?**

### Resolved
- ✅ Provider priority order: Claude → OpenAI → Gemini → Groq → Ollama
- ✅ Storage: SQLite for costs, env vars for API keys
- ✅ No need for provider-specific dashboard

### Open Questions
1. **Provider-specific features**: How to handle features only available in some providers (e.g., Claude's extended thinking)?
   - Proposal: Graceful degradation, document limitations

2. **Token counting**: Each provider counts tokens differently. Unified or per-provider?
   - Proposal: Per-provider with normalization

3. **Model selection within provider**: Support multiple models per provider?
   - Proposal: Yes, format `provider:model` (e.g., `openai:gpt-4o-mini`)

### Research Needed
- [ ] OpenAI-compatible API endpoints (Groq, many others use this)
- [ ] Gemini API streaming format
- [ ] Ollama API compatibility
