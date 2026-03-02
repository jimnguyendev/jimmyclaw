/**
 * Sliding Window Rate Limiter
 * Tracks actions per key within a configurable time window.
 * Ported from GoClaw's ToolRateLimiter.
 */
export class RateLimiter {
  private windows: Map<string, number[]> = new Map();
  private maxPerWindow: number;
  private windowMs: number;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(maxPerWindow: number, windowMs: number = 3600000) {
    this.maxPerWindow = maxPerWindow;
    this.windowMs = windowMs;
    
    if (maxPerWindow > 0) {
      this.cleanupInterval = setInterval(() => this.cleanup(), windowMs);
    }
  }

  allow(key: string): boolean {
    if (this.maxPerWindow <= 0) return true;

    const now = Date.now();
    const cutoff = now - this.windowMs;

    let entries = this.windows.get(key) || [];
    entries = entries.filter((t) => t > cutoff);

    if (entries.length >= this.maxPerWindow) {
      return false;
    }

    entries.push(now);
    this.windows.set(key, entries);
    return true;
  }

  check(key: string): { allowed: boolean; remaining: number; resetIn: number } {
    if (this.maxPerWindow <= 0) {
      return { allowed: true, remaining: Infinity, resetIn: 0 };
    }

    const now = Date.now();
    const cutoff = now - this.windowMs;

    let entries = this.windows.get(key) || [];
    entries = entries.filter((t) => t > cutoff);

    const allowed = entries.length < this.maxPerWindow;
    const remaining = Math.max(0, this.maxPerWindow - entries.length);
    const oldestEntry = entries[0];
    const resetIn = oldestEntry ? Math.max(0, this.windowMs - (now - oldestEntry)) : 0;

    if (allowed) {
      entries.push(now);
      this.windows.set(key, entries);
    }

    return { allowed, remaining, resetIn };
  }

  private cleanup(): void {
    const cutoff = Date.now() - this.windowMs;
    for (const [key, entries] of this.windows.entries()) {
      const filtered = entries.filter((t) => t > cutoff);
      if (filtered.length === 0) {
        this.windows.delete(key);
      } else if (filtered.length !== entries.length) {
        this.windows.set(key, filtered);
      }
    }
  }

  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  stats(): { keys: number; totalEntries: number } {
    let totalEntries = 0;
    for (const entries of this.windows.values()) {
      totalEntries += entries.length;
    }
    return { keys: this.windows.size, totalEntries };
  }
}

export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number;

  constructor(maxTokens: number, refillRateMs: number) {
    this.maxTokens = maxTokens;
    this.tokens = maxTokens;
    this.refillRate = refillRateMs;
    this.lastRefill = Date.now();
  }

  consume(tokens: number = 1): boolean {
    this.refill();

    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }
    return false;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const tokensToAdd = Math.floor(elapsed / this.refillRate);
    
    if (tokensToAdd > 0) {
      this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
      this.lastRefill = now;
    }
  }

  available(): number {
    this.refill();
    return this.tokens;
  }
}
