---
phase: testing
title: Sub-Agent Model Configuration Testing
description: Testing strategy for sub-agent model config feature
---

# Testing Strategy

## Test Coverage Goals
**What level of testing do we aim for?**

- Unit test coverage: 100% of config loading code
- Integration testing: SDK receives correct agents option
- End-to-end testing: Sub-agents use configured models

## Unit Tests
**What individual components need testing?**

### Config Loading (agent-config.ts)
- [ ] Test: loadAgentConfig returns default when no file
- [ ] Test: loadAgentConfig parses valid JSON
- [ ] Test: loadAgentConfig handles invalid JSON (fallback)
- [ ] Test: loadAgentConfig merges with defaults
- [ ] Test: loadAgentConfig handles missing fields

### Config Validation
- [ ] Test: Valid model names accepted
- [ ] Test: Invalid model names fall back to 'inherit'
- [ ] Test: Missing description uses default
- [ ] Test: Empty subAgents returns undefined

### SDK Option Building
- [ ] Test: buildAgentsOption returns undefined for empty config
- [ ] Test: buildAgentsOption builds correct structure
- [ ] Test: buildAgentsOption maps model names correctly
- [ ] Test: buildAgentsOption handles 'inherit' model

```typescript
// Example test
describe('loadAgentConfig', () => {
  it('returns default config when file not found', () => {
    const config = loadAgentConfig();
    expect(config.defaultModel).toBe('sonnet');
    expect(config.subAgents).toBeDefined();
  });

  it('merges user config with defaults', () => {
    // Create temp config file
    fs.writeFileSync('/tmp/test-config.json', JSON.stringify({
      subAgents: {
        custom: { model: 'opus', description: 'Custom agent' }
      }
    }));
    
    const config = loadAgentConfig('/tmp/test-config.json');
    expect(config.subAgents?.researcher).toBeDefined(); // Default
    expect(config.subAgents?.custom).toBeDefined(); // Custom
  });
});
```

## Integration Tests
**How do we test component interactions?**

### Container Integration
- [ ] Config file mounted at correct path
- [ ] Agent runner can read config
- [ ] Config changes reflected on restart

### SDK Integration
- [ ] `agents` option passed to query()
- [ ] Sub-agents created with correct model
- [ ] Sub-agents have correct tools

## End-to-End Tests
**What user flows need validation?**

### User Story 1: Cost-Optimized Research
- [ ] Given: agent-config.json with researcher=haiku
- [ ] When: Agent spawns researcher sub-agent
- [ ] Then: Verify Haiku model used (check logs)

### User Story 2: High-Quality Review
- [ ] Given: agent-config.json with reviewer=opus
- [ ] When: Agent spawns reviewer sub-agent
- [ ] Then: Verify Opus model used (check logs)

### User Story 3: Default Behavior
- [ ] Given: No config file
- [ ] When: Agent spawns any sub-agent
- [ ] Then: Default models used (check logs)

## Test Data
**What data do we use for testing?**

### Valid Config
```json
{
  "defaultModel": "sonnet",
  "subAgents": {
    "researcher": {
      "model": "haiku",
      "description": "Search and gather"
    },
    "reviewer": {
      "model": "opus",
      "description": "Review code"
    }
  }
}
```

### Invalid Config (for error handling)
```json
{
  "subAgents": {
    "broken": {
      "model": "invalid-model",
      "description": "Should fallback to inherit"
    }
  }
}
```

## Test Reporting & Coverage
**How do we verify and communicate test results?**

```bash
# Run tests
bun test container/agent-runner/src/agent-config.test.ts

# Coverage report
bun test --coverage
```

## Manual Testing
**What requires human validation?**

### Model Verification
1. Set researcher to haiku in config
2. Trigger research task
3. Check container logs for model name
4. Verify Haiku was used

### Config Hot-Reload
1. Start session with default config
2. Update agent-config.json
3. Restart container
4. Verify new config loaded

## Performance Testing
**How do we validate performance?**

| Metric | Target | Test Method |
|--------|--------|-------------|
| Config load | <10ms | Timing in code |
| Parse time | <5ms | Timing in code |
| No impact on startup | <100ms added | Container start timing |

## Bug Tracking
**How do we manage issues?**

- Document in GitHub issues
- Label with `feature:sub-agent-model-config`
- Track in project board
