/**
 * Types for Tracing
 */

export type SpanKind = 'internal' | 'server' | 'client' | 'producer' | 'consumer';
export type SpanStatus = 'unset' | 'ok' | 'error';

export interface SpanAttribute {
  key: string;
  value: string | number | boolean;
}

export interface SpanEvent {
  name: string;
  timestamp: Date;
  attributes?: Record<string, string | number | boolean>;
}

export interface Span {
  id: string;
  traceId: string;
  parentSpanId?: string;
  name: string;
  kind: SpanKind;
  startTime: Date;
  endTime?: Date;
  status: SpanStatus;
  attributes: Record<string, string | number | boolean>;
  events: SpanEvent[];
}

export interface Trace {
  traceId: string;
  spans: Span[];
  startTime: Date;
  endTime?: Date;
}

export interface TraceStats {
  totalTraces: number;
  totalSpans: number;
  activeSpans: number;
  oldestTrace?: Date;
}

export interface TraceFilter {
  traceId?: string;
  name?: string;
  status?: SpanStatus;
  startTimeAfter?: Date;
  startTimeBefore?: Date;
  limit?: number;
}

export interface CacheMetrics {
  cacheRead: number;
  cacheHit: number;
  cacheWrite: number;
  cacheCostSaved: number;
}
