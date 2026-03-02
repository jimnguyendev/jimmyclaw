/**
 * Trace Context
 * Propagates trace context through async operations.
 */

import { Span } from './types.js';

const TRACE_CONTEXT_KEY = Symbol('traceContext');

interface TraceContextValue {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
}

const asyncLocalStorage = new Map<string, TraceContextValue>();

export class TraceContext {
  private static currentContext: TraceContextValue | null = null;

  static setContext(traceId: string, spanId: string, parentSpanId?: string): void {
    const key = `${traceId}:${spanId}`;
    asyncLocalStorage.set(key, { traceId, spanId, parentSpanId });
    TraceContext.currentContext = { traceId, spanId, parentSpanId };
  }

  static getContext(): TraceContextValue | null {
    return TraceContext.currentContext;
  }

  static clearContext(): void {
    if (TraceContext.currentContext) {
      const key = `${TraceContext.currentContext.traceId}:${TraceContext.currentContext.spanId}`;
      asyncLocalStorage.delete(key);
    }
    TraceContext.currentContext = null;
  }

  static getTraceId(): string | undefined {
    return TraceContext.currentContext?.traceId;
  }

  static getSpanId(): string | undefined {
    return TraceContext.currentContext?.spanId;
  }

  static getParentSpanId(): string | undefined {
    return TraceContext.currentContext?.parentSpanId;
  }

  static runWith<T>(
    traceId: string,
    spanId: string,
    parentSpanId: string | undefined,
    fn: () => T
  ): T {
    const previous = TraceContext.currentContext;
    TraceContext.setContext(traceId, spanId, parentSpanId);
    try {
      return fn();
    } finally {
      TraceContext.currentContext = previous;
    }
  }

  static async runWithAsync<T>(
    traceId: string,
    spanId: string,
    parentSpanId: string | undefined,
    fn: () => Promise<T>
  ): Promise<T> {
    const previous = TraceContext.currentContext;
    TraceContext.setContext(traceId, spanId, parentSpanId);
    try {
      return await fn();
    } finally {
      TraceContext.currentContext = previous;
    }
  }

  static fromSpan(span: Span): void {
    TraceContext.setContext(span.traceId, span.id, span.parentSpanId);
  }
}

export function generateTraceId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 32);
}

export function generateSpanId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 16);
}

function randomUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
