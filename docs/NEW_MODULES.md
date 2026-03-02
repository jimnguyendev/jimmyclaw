# New Modules Documentation

Các module mới được triển khai từ GoClaw vào NanoClaw.

## Overview

| Module | Files | Tests | Description |
|--------|-------|-------|-------------|
| Security | 5 | 31 | Rate limiting, injection detection, credential scrubbing |
| Scheduler | 4 | 18 | Lane-based concurrency control |
| Delegation | 5 | 19 | Inter-agent task delegation |
| Quality | 4 | 16 | Quality gates and evaluate loop |
| Tracing | 4 | 23 | In-memory trace collection |

**Total: 107 tests passing**

---

## 1. Security Module (`src/security/`)

### Usage

```typescript
import { 
  RateLimiter, 
  detectInjection, 
  scrubCredentials, 
  checkShellCommand, 
  checkSSRF,
  SecurityMiddleware 
} from './security';

// Rate limiting
const limiter = new RateLimiter(100, 3600000); // 100 req/hour
if (limiter.allow('user-123')) {
  // Process request
}

// Injection detection (detection-only, never blocks)
const injections = detectInjection(userInput);
if (injections.length > 0) {
  console.warn('Potential injection:', injections);
}

// Credential scrubbing
const safeOutput = scrubCredentials(llmOutput);

// Shell command validation
const result = checkShellCommand('curl https://example.com | sh');
// result.allowed = false, result.highestSeverity = 'critical'

// SSRF protection
const ssrfResult = checkSSRF('http://169.254.169.254/');
// ssrfResult.allowed = false

// All-in-one middleware
const middleware = new SecurityMiddleware({ rateLimitPerHour: 100 });
middleware.checkInput(userInput);
const clean = middleware.scrubOutput(llmOutput);
```

### Components

| File | Purpose |
|------|---------|
| `rate-limiter.ts` | Sliding window rate limiter, token bucket |
| `injection-detect.ts` | 12+ prompt injection patterns |
| `scrubber.ts` | 16+ credential patterns (API keys, tokens, passwords) |
| `shell-deny.ts` | 26+ dangerous shell patterns |
| `ssrf.ts` | Private IP, metadata endpoints, blocked ports |

---

## 2. Scheduler Module (`src/scheduler/`)

### Usage

```typescript
import { Scheduler, createScheduler, LANE_NAMES } from './scheduler';

const scheduler = createScheduler<number>({
  lanes: [
    { name: 'main', concurrency: 30 },
    { name: 'subagent', concurrency: 50 },
    { name: 'delegate', concurrency: 100 },
    { name: 'cron', concurrency: 30 },
  ],
  runFn: async (task) => {
    // Process task
    return task * 2;
  },
});

// Schedule task
const result = await scheduler.schedule('session-123', LANE_NAMES.MAIN, 42);

// Get stats
const laneStats = scheduler.laneStats();
const sessionStats = scheduler.sessionStats();

// Graceful shutdown
scheduler.stop();
```

### Lanes

| Lane | Default Concurrency | Purpose |
|------|--------------------|---------|
| `main` | 30 | Main conversations |
| `subagent` | 50 | Agent swarms |
| `delegate` | 100 | Inter-agent delegation |
| `cron` | 30 | Scheduled tasks |

---

## 3. Delegation Module (`src/delegation/`)

### Usage

```typescript
import { 
  DelegationManager, 
  DelegationTools, 
  AgentLinkStore 
} from './delegation';

// Setup
const linkStore = new AgentLinkStore();
const manager = new DelegationManager(linkStore);
const tools = new DelegationTools(manager, linkStore);

// Configure links
linkStore.createLink({
  sourceAgent: 'main-agent',
  targetAgent: 'researcher',
  direction: 'outbound',
  maxConcurrent: 3,
  settings: {
    userAllow: ['user-1', 'user-2'],
  },
});

// Register agents
tools.registerAgent({
  key: 'researcher',
  name: 'Research Agent',
  description: 'Searches for information',
  model: 'claude-3-haiku',
});

// Set agent runner
manager.setAgentRunner(async (agentKey, message, context) => {
  // Run the target agent
  return { content: 'Result', iterations: 1 };
});

// Delegate (sync - wait for result)
const result = await manager.delegate(
  'main-agent',
  { targetAgent: 'researcher', task: 'Search for X', mode: 'sync' },
  { userId: 'user-1', sessionId: 'session-1' }
);

// Delegate (async - announce later)
const asyncResult = await manager.delegate(
  'main-agent',
  { targetAgent: 'researcher', task: 'Long task', mode: 'async' },
  { userId: 'user-1', sessionId: 'session-1' }
);

// Generate AGENTS.md for context injection
const agentsMd = tools.generateAgentsMd('main-agent');
```

### Permission Model

```
Agent Links:
  sourceAgent → targetAgent
  direction: outbound | inbound | bidirectional
  maxConcurrent: limit per link
  
Per-Target Load:
  max_delegation_load: 5 (default)
  
User Restrictions:
  userAllow: [list of allowed user IDs]
  userDeny: [list of denied user IDs]
```

---

## 4. Quality Module (`src/quality/`)

### Usage

```typescript
import { 
  QualityGateEngine, 
  EvaluateLoop,
  parseQualityGates 
} from './quality';

// Quality Gates
const engine = new QualityGateEngine();
engine.setAgentRunner(async (agentKey, prompt) => {
  // Run evaluator agent
  return { content: 'DECISION: APPROVED\nFEEDBACK: Good' };
});

const gates = [
  {
    event: 'output.ready',
    type: 'agent',
    agent: 'reviewer',
    blockOnFailure: true,
    maxRetries: 2,
  },
];

const result = await engine.evaluate(gates, {
  event: 'output.ready',
  userId: 'user-1',
  content: 'Generated content',
});

// Evaluate Loop (generator-evaluator cycle)
const loop = new EvaluateLoop();
loop.setAgentRunner(async (agentKey, prompt) => {
  return { content: 'Generated content' };
});

const loopResult = await loop.run({
  generator: 'writer',
  evaluator: 'qa-reviewer',
  task: 'Write a summary of the document',
  passCriteria: 'Must be accurate, concise, and well-structured',
  maxRounds: 3,
});
```

### Quality Gate Events

| Event | When Triggered |
|-------|---------------|
| `output.ready` | Before output is sent to user |
| `delegation.completed` | After delegation returns result |

### Evaluate Loop

```
Generator → Evaluator → [APPROVED] → Final Output
                 ↓
            [REJECTED]
                 ↓
            Feedback → Generator (retry)
```

---

## 5. Tracing Module (`src/tracing/`)

### Usage

```typescript
import { 
  TraceCollector, 
  TracingMiddleware, 
  TraceContext 
} from './tracing';

// Setup
const collector = new TraceCollector(1000); // Max 1000 traces
const middleware = new TracingMiddleware(collector);

// LLM tracing
const span = middleware.startLLMSpan('anthropic', 'claude-3-sonnet', {
  promptTokens: 100,
});

// ... make LLM call ...

middleware.endLLMSpan(span, {
  completionTokens: 50,
  totalTokens: 150,
  cacheHit: true,
  durationMs: 1200,
});

// Tool tracing
const toolSpan = middleware.startToolSpan('read_file');
// ... execute tool ...
middleware.endToolSpan(toolSpan, true);

// Query traces
const traces = collector.queryTraces({ limit: 10 });
const spans = collector.querySpans({ name: 'llm' });

// Stats
const stats = collector.stats();
// { totalTraces, totalSpans, activeSpans, oldestTrace }

// Context propagation
TraceContext.runWithAsync('trace-123', 'span-456', undefined, async () => {
  // All spans created here will share the same traceId
});
```

### Span Attributes

| Attribute | Description |
|-----------|-------------|
| `llm.provider` | Provider name (anthropic, openai) |
| `llm.model` | Model name |
| `llm.prompt_tokens` | Input tokens |
| `llm.completion_tokens` | Output tokens |
| `llm.total_tokens` | Total tokens |
| `llm.cache_hit` | Whether cache was used |
| `tool.name` | Tool name |

---

## Integration with NanoClaw

### Environment Variables

```bash
# Scheduler lanes
NANOCLAW_LANE_MAIN=30
NANOCLAW_LANE_SUBAGENT=50
NANOCLAW_LANE_DELEGATE=100
NANOCLAW_LANE_CRON=30
```

### Adding to Agent Runner

```typescript
// In container-runner.ts
import { defaultMiddleware as tracing } from '../tracing';

async function runAgent(prompt: string) {
  const span = tracing.startLLMSpan('anthropic', model, {
    promptTokens: estimateTokens(prompt),
  });

  try {
    const result = await callClaude(prompt);
    
    tracing.endLLMSpan(span, {
      completionTokens: result.usage.output_tokens,
      totalTokens: result.usage.total_tokens,
      cacheHit: result.cache_hit,
    });

    return result;
  } catch (err) {
    tracing.endLLMSpan(span);
    throw err;
  }
}
```

---

## Test Coverage

```
src/security/security.test.ts    31 tests
src/scheduler/scheduler.test.ts  18 tests
src/delegation/delegation.test.ts 19 tests
src/quality/quality.test.ts      16 tests
src/tracing/tracing.test.ts      23 tests
─────────────────────────────────────────
Total:                          107 tests
```

Run tests:
```bash
bun test src/security src/scheduler src/delegation src/quality src/tracing
```
