/**
 * Trace Collector
 * In-memory trace collection and querying.
 */

import {
  Span,
  Trace,
  TraceStats,
  TraceFilter,
  SpanKind,
  SpanStatus,
  SpanEvent,
  CacheMetrics,
} from './types.js';
import { generateTraceId, generateSpanId, TraceContext } from './context.js';

export class TraceCollector {
  private traces: Map<string, Trace> = new Map();
  private activeSpans: Map<string, Span> = new Map();
  private maxTraces: number;
  private onSpanEnd?: (span: Span) => void;

  constructor(maxTraces: number = 1000) {
    this.maxTraces = maxTraces;
  }

  setOnSpanEnd(handler: (span: Span) => void): void {
    this.onSpanEnd = handler;
  }

  startSpan(
    name: string,
    options: {
      kind?: SpanKind;
      parentSpanId?: string;
      traceId?: string;
      attributes?: Record<string, string | number | boolean>;
    } = {}
  ): Span {
    let traceId = options.traceId || TraceContext.getTraceId();
    const spanId = generateSpanId();
    const parentSpanId = options.parentSpanId || TraceContext.getParentSpanId();

    if (!traceId && parentSpanId) {
      const parentSpan = this.activeSpans.get(parentSpanId);
      if (parentSpan) {
        traceId = parentSpan.traceId;
      }
    }

    if (!traceId) {
      traceId = generateTraceId();
    }

    const span: Span = {
      id: spanId,
      traceId,
      parentSpanId,
      name,
      kind: options.kind || 'internal',
      startTime: new Date(),
      status: 'unset',
      attributes: options.attributes || {},
      events: [],
    };

    this.activeSpans.set(spanId, span);

    if (!this.traces.has(traceId)) {
      this.traces.set(traceId, {
        traceId,
        spans: [],
        startTime: new Date(),
      });
    }

    return span;
  }

  endSpan(span: Span, status: SpanStatus = 'ok'): void {
    span.endTime = new Date();
    span.status = status;

    this.activeSpans.delete(span.id);

    const trace = this.traces.get(span.traceId);
    if (trace) {
      trace.spans.push(span);
      trace.endTime = new Date();

      if (this.traces.size > this.maxTraces) {
        this.evictOldestTrace();
      }
    }

    if (this.onSpanEnd) {
      this.onSpanEnd(span);
    }
  }

  addEvent(
    span: Span,
    name: string,
    attributes?: Record<string, string | number | boolean>
  ): void {
    span.events.push({
      name,
      timestamp: new Date(),
      attributes,
    });
  }

  setAttribute(span: Span, key: string, value: string | number | boolean): void {
    span.attributes[key] = value;
  }

  setAttributes(
    span: Span,
    attrs: Record<string, string | number | boolean>
  ): void {
    Object.assign(span.attributes, attrs);
  }

  getTrace(traceId: string): Trace | undefined {
    return this.traces.get(traceId);
  }

  getSpan(spanId: string): Span | undefined {
    return this.activeSpans.get(spanId);
  }

  queryTraces(filter: TraceFilter): Trace[] {
    let traces = Array.from(this.traces.values());

    if (filter.traceId) {
      traces = traces.filter((t) => t.traceId === filter.traceId);
    }

    if (filter.startTimeAfter) {
      traces = traces.filter((t) => t.startTime >= filter.startTimeAfter!);
    }

    if (filter.startTimeBefore) {
      traces = traces.filter((t) => t.startTime <= filter.startTimeBefore!);
    }

    if (filter.status) {
      traces = traces.filter((t) =>
        t.spans.some((s) => s.status === filter.status)
      );
    }

    traces.sort((a, b) => b.startTime.getTime() - a.startTime.getTime());

    if (filter.limit) {
      traces = traces.slice(0, filter.limit);
    }

    return traces;
  }

  querySpans(filter: TraceFilter): Span[] {
    const spans: Span[] = [];

    for (const trace of this.traces.values()) {
      for (const span of trace.spans) {
        if (filter.traceId && span.traceId !== filter.traceId) continue;
        if (filter.name && !span.name.includes(filter.name)) continue;
        if (filter.status && span.status !== filter.status) continue;
        spans.push(span);
      }
    }

    spans.sort((a, b) => b.startTime.getTime() - a.startTime.getTime());

    if (filter.limit) {
      return spans.slice(0, filter.limit);
    }

    return spans;
  }

  stats(): TraceStats {
    let oldestTrace: Date | undefined;
    for (const trace of this.traces.values()) {
      if (!oldestTrace || trace.startTime < oldestTrace) {
        oldestTrace = trace.startTime;
      }
    }

    let totalSpans = 0;
    for (const trace of this.traces.values()) {
      totalSpans += trace.spans.length;
    }

    return {
      totalTraces: this.traces.size,
      totalSpans,
      activeSpans: this.activeSpans.size,
      oldestTrace,
    };
  }

  clear(): void {
    this.traces.clear();
    this.activeSpans.clear();
  }

  private evictOldestTrace(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, trace] of this.traces.entries()) {
      if (trace.startTime.getTime() < oldestTime) {
        oldestTime = trace.startTime.getTime();
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.traces.delete(oldestKey);
    }
  }
}

export class TracingMiddleware {
  private collector: TraceCollector;
  private enabled: boolean;

  constructor(collector: TraceCollector, enabled: boolean = true) {
    this.collector = collector;
    this.enabled = enabled;
  }

  enable(): void {
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
  }

  startLLMSpan(
    provider: string,
    model: string,
    options: { promptTokens?: number; parentSpanId?: string } = {}
  ): Span | null {
    if (!this.enabled) return null;

    const span = this.collector.startSpan(`llm.${provider}.${model}`, {
      kind: 'client',
      parentSpanId: options.parentSpanId,
      attributes: {
        'llm.provider': provider,
        'llm.model': model,
        ...(options.promptTokens ? { 'llm.prompt_tokens': options.promptTokens } : {}),
      },
    });

    TraceContext.fromSpan(span);
    return span;
  }

  endLLMSpan(
    span: Span | null,
    options: {
      completionTokens?: number;
      totalTokens?: number;
      cacheHit?: boolean;
      durationMs?: number;
    } = {}
  ): void {
    if (!span) return;

    if (options.completionTokens) {
      this.collector.setAttribute(span, 'llm.completion_tokens', options.completionTokens);
    }
    if (options.totalTokens) {
      this.collector.setAttribute(span, 'llm.total_tokens', options.totalTokens);
    }
    if (options.cacheHit !== undefined) {
      this.collector.setAttribute(span, 'llm.cache_hit', options.cacheHit);
    }
    if (options.durationMs) {
      this.collector.setAttribute(span, 'llm.duration_ms', options.durationMs);
    }

    this.collector.endSpan(span, 'ok');
  }

  startToolSpan(
    toolName: string,
    options: { parentSpanId?: string } = {}
  ): Span | null {
    if (!this.enabled) return null;

    const span = this.collector.startSpan(`tool.${toolName}`, {
      kind: 'internal',
      parentSpanId: options.parentSpanId,
      attributes: {
        'tool.name': toolName,
      },
    });

    return span;
  }

  endToolSpan(span: Span | null, success: boolean = true): void {
    if (!span) return;
    this.collector.endSpan(span, success ? 'ok' : 'error');
  }

  recordCacheMetrics(span: Span | null, metrics: CacheMetrics): void {
    if (!span) return;
    this.collector.setAttributes(span, {
      'cache.read': metrics.cacheRead,
      'cache.hit': metrics.cacheHit,
      'cache.write': metrics.cacheWrite,
      'cache.cost_saved': metrics.cacheCostSaved,
    });
  }
}

export const defaultCollector = new TraceCollector();
export const defaultMiddleware = new TracingMiddleware(defaultCollector);
