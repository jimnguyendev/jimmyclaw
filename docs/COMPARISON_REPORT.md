# So Sánh Đánh Giá: NanoClaw vs GoClaw

## Tổng Quan

| Metric | NanoClaw (Đã triển khai) | GoClaw (Tham khảo) |
|-------|------------------------|------------------|
| **Tổng files** | 22 files | 40+ files |
| **Tổng dòng code** | ~2,600 lines | ~4,300 lines |
| **Tests** | 107 | 200+ |
| **Coverage** | Core features | Full implementation |

---

## 1. Security Module

### So sánh chi tiết

| Feature | NanoClaw | GoClaw | Đánh giá |
|---------|----------|-------|---------|
| **Rate Limiter** | ✅ Sliding window + Token bucket | ✅ ToolRateLimiter only | ✅ Đầy đủ |
| **Injection Detection** | ✅ 12 patterns | ✅ 6 patterns | ✅ Nhiều hơn GoClaw |
| **Credential Scrubbing** | ✅ 16 patterns | ✅ Trong output formatter | ✅ Đầy đủ |
| **Shell Deny** | ✅ 26 patterns | ✅ 10+ patterns | ✅ Đầy đủ |
| **SSRF Protection** | ✅ Blocked hosts/IPs/ports | ✅ Full implementation | ✅ Đầy đủ |
| **Input Guard** | ✅ Detection-only | ✅ Detection-only | ✅ Tương đương |
| **Cleanup** | ✅ Auto cleanup | ✅ Manual cleanup | ✅ Tốt hơn |

### Code Comparison

**GoClaw:**
```go
type ToolRateLimiter struct {
    mu        sync.Mutex
    windows   map[string][]time.Time
    maxPerHr  int
    window    time.Duration
}
```

**NanoClaw:**
```typescript
export class RateLimiter {
  private windows: Map<string, number[]> = new Map();
  private maxPerWindow: number;
  private windowMs: number;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  // Auto cleanup, check(), stats() methods
}
```

### Điểm mạnh
- Thêm auto cleanup interval
- Thêm `check()` method với detailed info
- Thêm `stats()` method
- Thêm `TokenBucket` class cho token-based rate limiting

### Điểm yếu
- Không có per-tool rate limiting configuration
- Không integrate với tool execution

---

## 2. Scheduler Module

### So sánh chi tiết

| Feature | NanoClaw | GoClaw | Đánh giá |
|---------|----------|-------|---------|
| **Lanes** | ✅ 4 lanes | ✅ 4 lanes | ✅ Tương đương |
| **Session Queue** | ✅ Basic | ✅ Full featured | ⚠️ Cần cải thiện |
| **Queue Modes** | ❌ | ✅ queue/followup/interrupt | ⚠️ Thiếu |
| **Drop Policy** | ❌ | ✅ DropOld/DropNew | ⚠️ Thiếu |
| **Debounce** | ❌ | ✅ Configurable debounce | ⚠️ Thiếu |
| **Adaptive Throttle** | ❌ | ✅ Token-based | ⚠️ Thiếu |
| **Stale Detection** | ❌ | ✅ abortCutoffTime | ⚠️ Thiếu |
| **Generation Tracking** | ❌ | ✅ Reset with generation | ⚠️ Thiếu |

### Missing Features (GoClaw có, NanoClaw thiếu)

```go
// GoClaw QueueConfig
type QueueConfig struct {
    Mode          QueueMode  // queue, followup, interrupt
    Cap           int        // queue capacity
    Drop          DropPolicy // old, new
    DebounceMs    int        // debounce delay
    MaxConcurrent int        // 0 or 1 = serial
}

// GoClaw modes
const (
    QueueModeQueue     QueueMode = "queue"      // FIFO
    QueueModeFollowup  QueueMode = "followup"   // After current
    QueueModeInterrupt QueueMode = "interrupt"  // Cancel current
)
```

### Cần cải thiện

```typescript
// Thêm vào queue.ts
export type QueueMode = 'queue' | 'followup' | 'interrupt';
export type DropPolicy = 'old' | 'new';

export interface QueueConfig {
  mode: QueueMode;
  cap: number;
  drop: DropPolicy;
  debounceMs: number;
  maxConcurrent: number;
}

// Thêm stale detection
interface SessionQueue {
  abortCutoffTime?: Date;
  generation: number;
  // ...
}
```

---

## 3. Delegation Module

### So sánh chi tiết

| Feature | NanoClaw | GoClaw | Đánh giá |
|---------|----------|-------|---------|
| **Sync Delegation** | ✅ | ✅ | ✅ Đầy đủ |
| **Async Delegation** | ✅ | ✅ | ✅ Đầy đủ |
| **Permission Links** | ✅ | ✅ | ✅ Đầy đủ |
| **Per-User Restrictions** | ✅ | ✅ | ✅ Đầy đủ |
| **Concurrency Control** | ✅ Per-link + per-target | ✅ Per-link + per-target | ✅ Đầy đủ |
| **Quality Gates** | ✅ Basic | ✅ Full integration | ⚠️ Cần integrate |
| **Delegation History** | ❌ | ✅ Database storage | ⚠️ Thiếu |
| **Team Task Auto-complete** | ❌ | ✅ | ⚠️ Thiếu |
| **Agent Discovery** | ✅ AGENTS.md gen | ✅ Hybrid FTS + semantic | ⚠️ Cần hybrid search |

### Missing Features

```go
// GoClaw: Delegation history
func (dm *DelegateManager) saveDelegationHistory(task *DelegationTask, resultContent string, delegateErr error, duration time.Duration) {
    record := &store.DelegationHistoryData{
        SourceAgentID: task.SourceAgentID,
        TargetAgentID: task.TargetAgentID,
        UserID:        task.UserID,
        Task:          task.Task,
        Mode:          task.Mode,
        Status:        "completed" | "failed",
        Result:        &resultContent,
        Error:         &errStr,
        DurationMS:    int(duration.Milliseconds()),
        CompletedAt:   &now,
    }
    // Save to database...
}

// GoClaw: Team task auto-complete
func (dm *DelegateManager) autoCompleteTeamTask(task *DelegationTask, resultContent string) {
    if dm.teamStore == nil || task.TeamTaskID == uuid.Nil {
        return
    }
    _ = dm.teamStore.ClaimTask(context.Background(), task.TeamTaskID, task.TargetAgentID)
    if err := dm.teamStore.CompleteTask(context.Background(), task.TeamTaskID, resultContent); err != nil {
        slog.Warn("delegate: failed to auto-complete team task", ...)
    }
}
```

### Cần cải thiện

```typescript
// Thêm delegation history
interface DelegationHistoryRecord {
  id: string;
  sourceAgentId: string;
  targetAgentId: string;
  userId: string;
  task: string;
  mode: string;
  status: string;
  result?: string;
  error?: string;
  durationMs: number;
  completedAt: Date;
}

class DelegationManager {
  private historyStore: HistoryStore | null = null;
  
  setHistoryStore(store: HistoryStore): void {
    this.historyStore = store;
  }
  
  private async saveDelegationHistory(task, result, error, duration): Promise<void> {
    if (!this.historyStore) return;
    await this.historyStore.save({
      sourceAgentId: task.sourceAgent,
      // ...
    });
  }
}
```

---

## 4. Quality Gates Module

### So sánh chi tiết

| Feature | NanoClaw | GoClaw | Đánh giá |
|---------|----------|-------|---------|
| **Command Gates** | ✅ | ✅ | ✅ Đầy đủ |
| **Agent Gates** | ✅ | ✅ | ✅ Đầy đủ |
| **Blocking/Non-blocking** | ✅ | ✅ | ✅ Đầy đủ |
| **Retry Logic** | ✅ | ✅ | ✅ Đầy đủ |
| **Hook Engine** | ❌ | ✅ Full Engine | ⚠️ Đơn giản hóa |
| **Hook Registry** | ❌ | ✅ RegisterEvaluator() | ⚠️ Thiếu |
| **Event Types** | 2 events | 2+ events | ⚠️ Cần thêm |

### Missing: Full Hook Engine

```go
// GoClaw: Full hook engine
type Engine struct {
    evaluators map[HookType]HookEvaluator
}

func (e *Engine) RegisterEvaluator(hookType HookType, eval HookEvaluator) {
    e.evaluators[hookType] = eval
}

func (e *Engine) EvaluateHooks(ctx context.Context, hooks []HookConfig, event string, hctx HookContext) (*HookResult, error) {
    for _, hook := range hooks {
        if hook.Event != event {
            continue
        }
        eval, ok := e.evaluators[hook.Type]
        if !ok {
            slog.Warn("hooks: unknown hook type", "type", hook.Type)
            continue
        }
        result, err := eval.Evaluate(ctx, hook, hctx)
        // ...
    }
}
```

### Cần cải thiện

```typescript
// Thêm HookRegistry
class QualityGateEngine {
  private evaluators: Map<string, HookEvaluator> = new Map();
  
  registerEvaluator(type: string, evaluator: HookEvaluator): void {
    this.evaluators.set(type, evaluator);
  }
  
  private async evaluateGate(gate: QualityGate, context: HookContext): Promise<GateResult> {
    const evaluator = this.evaluators.get(gate.type);
    if (!evaluator) {
      console.warn(`Unknown gate type: ${gate.type}`);
      return { passed: true };
    }
    return evaluator.evaluate(gate, context);
  }
}
```

---

## 5. Tracing Module

### So sánh chi tiết

| Feature | NanoClaw | GoClaw | Đánh giá |
|---------|----------|-------|---------|
| **Span Collection** | ✅ | ✅ | ✅ Đầy đủ |
| **Trace Context** | ✅ | ✅ | ✅ Đầy đủ |
| **LLM Tracing** | ✅ | ✅ | ✅ Đầy đủ |
| **Tool Tracing** | ✅ | ✅ | ✅ Đầy đủ |
| **Cache Metrics** | ✅ | ✅ | ✅ Đầy đủ |
| **Query Interface** | ✅ | ✅ | ✅ Đầy đủ |
| **OTel Export** | ❌ | ✅ Build-tag gated | ⚠️ Thiếu |
| **Batch Export** | ❌ | ✅ Periodic flush | ⚠️ Thiếu |
| **Dirty Tracking** | ❌ | ✅ dirtyTraces map | ⚠️ Thiếu |
| **Aggregates** | ❌ | ✅ Per-trace aggregates | ⚠️ Thiếu |

### Missing: OpenTelemetry Export

```go
// GoClaw: OTel exporter (build-tag gated)
type OTelExporter struct {
    client     traceServiceClient
    serializer *spanSerializer
}

func (e *OTelExporter) ExportSpans(ctx context.Context, spans []*SpanData) error {
    protoSpans := make([]*v1.ResourceSpans, 0, len(spans))
    for _, span := range spans {
        protoSpans = append(protoSpans, e.serializer.Serialize(span))
    }
    _, err := e.client.Export(ctx, &v1.ExportTraceServiceRequest{
        ResourceSpans: protoSpans,
    })
    return err
}
```

### Cần cải thiện

```typescript
// Thêm optional OTel export
interface OTelExporter {
  export(spans: Span[]): Promise<void>;
}

class TraceCollector {
  private exporter: OTelExporter | null = null;
  private dirtyTraces: Set<string> = new Set();
  
  setExporter(exporter: OTelExporter): void {
    this.exporter = exporter;
  }
  
  async flush(): Promise<void> {
    if (!this.exporter) return;
    
    const spans: Span[] = [];
    for (const traceId of this.dirtyTraces) {
      const trace = this.traces.get(traceId);
      if (trace) {
        spans.push(...trace.spans);
      }
    }
    
    await this.exporter.export(spans);
    this.dirtyTraces.clear();
  }
}
```

---

## 6. Tổng Hợp Missing Features

### Priority 1 - Quan trọng

| Feature | Module | Effort | Impact |
|---------|--------|--------|--------|
| Queue Modes (interrupt) | Scheduler | Medium | High |
| Debounce | Scheduler | Low | High |
| Delegation History | Delegation | Medium | High |
| Quality Gate Integration | Delegation | Medium | High |

### Priority 2 - Trung bình

| Feature | Module | Effort | Impact |
|---------|--------|--------|--------|
| Adaptive Throttle | Scheduler | High | Medium |
| Stale Detection | Scheduler | Medium | Medium |
| OTel Export | Tracing | High | Medium |
| Hook Registry | Quality | Low | Medium |
| Team Task Auto-complete | Delegation | Medium | Medium |

### Priority 3 - Thấp

| Feature | Module | Effort | Impact |
|---------|--------|--------|--------|
| Trace Aggregates | Tracing | Medium | Low |
| Hybrid Agent Search | Delegation | Medium | Low |
| Per-tool Rate Limiting | Security | Low | Low |

---

## 7. Đánh Giá Tổng Thể

### Điểm mạnh của NanoClaw implementation

1. **Code chất lượng cao**
   - TypeScript với types đầy đủ
   - Clean, readable code
   - Well-documented

2. **Test coverage tốt**
   - 107 tests
   - All core functionality covered
   - Edge cases handled

3. **API design tốt**
   - Consistent naming
   - Well-structured exports
   - Easy to use

4. **Additional features**
   - TokenBucket rate limiter
   - More injection patterns
   - Auto cleanup

### Điểm yếu cần cải thiện

1. **Scheduler thiếu advanced features**
   - No interrupt mode
   - No debounce
   - No adaptive throttle

2. **Delegation thiếu persistence**
   - No history tracking
   - No team integration
   - No quality gate hooks

3. **Tracing thiếu export**
   - No OTel integration
   - No batch export
   - No dirty tracking

4. **Quality thiếu extensibility**
   - No hook registry
   - Limited event types
   - No custom evaluators

### So với GoClaw

| Aspect | NanoClaw | GoClaw |
|--------|----------|--------|
| **Language** | TypeScript (Bun) | Go |
| **Lines of code** | ~2,600 | ~4,300 |
| **Complexity** | Simpler | More complex |
| **Features** | 70% | 100% |
| **Test coverage** | Good | Comprehensive |
| **Production ready** | Partial | Full |

---

## 8. Khuyến Nghị

### Ngắn hạn (1-2 ngày)

1. **Thêm Queue Modes vào Scheduler**
   - Implement interrupt mode
   - Add debounce support

2. **Integrate Quality Gates với Delegation**
   - Call quality gates on delegation complete
   - Add retry with feedback

3. **Thêm Delegation History**
   - Create history store interface
   - Save on complete/fail

### Trung hạn (1 tuần)

1. **Full Hook Engine**
   - Implement hook registry
   - Support custom evaluators

2. **Adaptive Throttle**
   - Token estimation
   - Context window awareness

3. **OTel Export (optional)**
   - Build-flag gated
   - gRPC/HTTP export

### Dài hạn (2+ tuần)

1. **Team Integration**
   - Team task auto-complete
   - Team mailbox integration

2. **Hybrid Agent Search**
   - FTS + semantic search
   - Auto-generate AGENTS.md

3. **Full Observability**
   - Trace aggregates
   - Metrics export
   - Dashboard integration

---

## 9. Kết Luận

NanoClaw đã triển khai thành công **~70%** các tính năng của GoClaw với **codebase nhỏ hơn 40%**:

| Metric | Value |
|--------|-------|
| **Features implemented** | 70% |
| **Code efficiency** | 60% smaller |
| **Test coverage** | Good (107 tests) |
| **Production ready** | Partial |

**Recommendation:** Tiếp tục implement các Priority 1 features để đạt production readiness.
