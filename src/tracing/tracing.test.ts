import { describe, test, expect, beforeEach } from 'bun:test';
import { TraceCollector, TracingMiddleware } from './collector.js';
import { TraceContext, generateTraceId, generateSpanId } from './context.js';

describe('TraceContext', () => {
  beforeEach(() => {
    TraceContext.clearContext();
  });

  test('sets and gets context', () => {
    TraceContext.setContext('trace-1', 'span-1', 'parent-1');
    
    expect(TraceContext.getTraceId()).toBe('trace-1');
    expect(TraceContext.getSpanId()).toBe('span-1');
    expect(TraceContext.getParentSpanId()).toBe('parent-1');
  });

  test('clears context', () => {
    TraceContext.setContext('trace-1', 'span-1');
    TraceContext.clearContext();
    
    expect(TraceContext.getContext()).toBeNull();
  });

  test('runWith sets and restores context', () => {
    TraceContext.setContext('outer-trace', 'outer-span');
    
    const result = TraceContext.runWith('inner-trace', 'inner-span', undefined, () => {
      expect(TraceContext.getTraceId()).toBe('inner-trace');
      return 'done';
    });
    
    expect(result).toBe('done');
    expect(TraceContext.getTraceId()).toBe('outer-trace');
  });

  test('runWithAsync works with async functions', async () => {
    const result = await TraceContext.runWithAsync('async-trace', 'async-span', undefined, async () => {
      await new Promise((r) => setTimeout(r, 5));
      expect(TraceContext.getTraceId()).toBe('async-trace');
      return 'async-done';
    });
    
    expect(result).toBe('async-done');
  });
});

describe('generateTraceId and generateSpanId', () => {
  test('generates valid trace ID', () => {
    const id = generateTraceId();
    expect(id.length).toBe(32);
    expect(/^[a-f0-9]+$/.test(id)).toBe(true);
  });

  test('generates valid span ID', () => {
    const id = generateSpanId();
    expect(id.length).toBe(16);
    expect(/^[a-f0-9]+$/.test(id)).toBe(true);
  });

  test('generates unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateTraceId());
    }
    expect(ids.size).toBe(100);
  });
});

describe('TraceCollector', () => {
  let collector: TraceCollector;

  beforeEach(() => {
    collector = new TraceCollector(100);
  });

  test('starts and ends spans', () => {
    const span = collector.startSpan('test-span');
    expect(span.name).toBe('test-span');
    expect(span.status).toBe('unset');
    expect(span.startTime).toBeDefined();
    
    collector.endSpan(span, 'ok');
    expect(span.endTime).toBeDefined();
    expect(span.status).toBe('ok');
  });

  test('creates trace for new spans', () => {
    const span = collector.startSpan('test-span');
    collector.endSpan(span);
    
    const trace = collector.getTrace(span.traceId);
    expect(trace).toBeDefined();
    expect(trace?.spans.length).toBe(1);
  });

  test('links spans to parent', () => {
    const parent = collector.startSpan('parent');
    const child = collector.startSpan('child', { parentSpanId: parent.id });
    
    expect(child.parentSpanId).toBe(parent.id);
    expect(child.traceId).toBe(parent.traceId);
    
    collector.endSpan(parent);
    collector.endSpan(child);
  });

  test('adds events to spans', () => {
    const span = collector.startSpan('test');
    collector.addEvent(span, 'event-1', { key: 'value' });
    
    expect(span.events.length).toBe(1);
    expect(span.events[0].name).toBe('event-1');
    expect(span.events[0].attributes?.key).toBe('value');
    
    collector.endSpan(span);
  });

  test('sets attributes on spans', () => {
    const span = collector.startSpan('test');
    collector.setAttribute(span, 'key1', 'value1');
    collector.setAttributes(span, { key2: 123, key3: true });
    
    expect(span.attributes.key1).toBe('value1');
    expect(span.attributes.key2).toBe(123);
    expect(span.attributes.key3).toBe(true);
    
    collector.endSpan(span);
  });

  test('queryTraces filters correctly', () => {
    const span1 = collector.startSpan('span-1');
    collector.endSpan(span1);
    
    const span2 = collector.startSpan('span-2');
    collector.endSpan(span2);

    const traces = collector.queryTraces({ limit: 1 });
    expect(traces.length).toBe(1);
  });

  test('querySpans filters correctly', () => {
    const span1 = collector.startSpan('important-span');
    collector.endSpan(span1, 'ok');
    
    const span2 = collector.startSpan('other-span');
    collector.endSpan(span2, 'error');

    const spans = collector.querySpans({ name: 'important' });
    expect(spans.length).toBe(1);
    expect(spans[0].name).toBe('important-span');

    const errorSpans = collector.querySpans({ status: 'error' });
    expect(errorSpans.length).toBe(1);
  });

  test('returns correct stats', () => {
    const span1 = collector.startSpan('span-1');
    collector.endSpan(span1);
    
    const span2 = collector.startSpan('span-2');
    // Don't end span2 to test activeSpans count
    
    const stats = collector.stats();
    expect(stats.totalTraces).toBe(2);
    expect(stats.totalSpans).toBe(1);
    expect(stats.activeSpans).toBe(1);
    
    collector.endSpan(span2);
  });

  test('evicts oldest traces when limit reached', () => {
    const smallCollector = new TraceCollector(3);
    
    for (let i = 0; i < 5; i++) {
      const span = smallCollector.startSpan(`span-${i}`);
      smallCollector.endSpan(span);
    }
    
    const stats = smallCollector.stats();
    expect(stats.totalTraces).toBeLessThanOrEqual(3);
  });

  test('clear removes all traces', () => {
    const span = collector.startSpan('test');
    collector.endSpan(span);
    
    expect(collector.stats().totalTraces).toBe(1);
    
    collector.clear();
    expect(collector.stats().totalTraces).toBe(0);
  });
});

describe('TracingMiddleware', () => {
  let collector: TraceCollector;
  let middleware: TracingMiddleware;

  beforeEach(() => {
    collector = new TraceCollector();
    middleware = new TracingMiddleware(collector, true);
  });

  test('startLLMSpan creates LLM span', () => {
    const span = middleware.startLLMSpan('anthropic', 'claude-3-sonnet', {
      promptTokens: 100,
    });
    
    expect(span).not.toBeNull();
    expect(span?.name).toBe('llm.anthropic.claude-3-sonnet');
    expect(span?.attributes['llm.provider']).toBe('anthropic');
    expect(span?.attributes['llm.model']).toBe('claude-3-sonnet');
    expect(span?.attributes['llm.prompt_tokens']).toBe(100);
    
    middleware.endLLMSpan(span, { completionTokens: 50, totalTokens: 150 });
    
    expect(span?.attributes['llm.completion_tokens']).toBe(50);
    expect(span?.attributes['llm.total_tokens']).toBe(150);
  });

  test('startToolSpan creates tool span', () => {
    const span = middleware.startToolSpan('read_file');
    
    expect(span).not.toBeNull();
    expect(span?.name).toBe('tool.read_file');
    expect(span?.attributes['tool.name']).toBe('read_file');
    
    middleware.endToolSpan(span, true);
    expect(span?.status).toBe('ok');
  });

  test('endToolSpan with failure sets error status', () => {
    const span = middleware.startToolSpan('fail_tool');
    middleware.endToolSpan(span, false);
    
    expect(span?.status).toBe('error');
  });

  test('disabled middleware returns null spans', () => {
    middleware.disable();
    
    const span = middleware.startLLMSpan('anthropic', 'claude');
    expect(span).toBeNull();
  });

  test('records cache metrics', () => {
    const span = middleware.startLLMSpan('anthropic', 'claude');
    middleware.recordCacheMetrics(span, {
      cacheRead: 10,
      cacheHit: 8,
      cacheWrite: 2,
      cacheCostSaved: 100,
    });
    
    expect(span?.attributes['cache.read']).toBe(10);
    expect(span?.attributes['cache.hit']).toBe(8);
    expect(span?.attributes['cache.write']).toBe(2);
    expect(span?.attributes['cache.cost_saved']).toBe(100);
    
    middleware.endLLMSpan(span);
  });

  test('handles null span gracefully', () => {
    middleware.endLLMSpan(null);
    middleware.endToolSpan(null);
    middleware.recordCacheMetrics(null, { cacheRead: 0, cacheHit: 0, cacheWrite: 0, cacheCostSaved: 0 });
  });
});
