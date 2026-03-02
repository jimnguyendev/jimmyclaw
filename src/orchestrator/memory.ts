import { Database } from 'bun:sqlite';
import { eq, lt, isNull, and } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { swarmMemory } from '../db/schema.js';
import { logger } from '../logger.js';

export interface MemoryEntry {
  key: string;
  value: string;
  type: 'string' | 'json' | 'markdown';
  updatedBy: string;
  updatedAt: string;
  expiresAt?: string;
}

export class SharedMemory {
  private db: ReturnType<typeof drizzle>;
  private rawDb: Database;

  constructor(rawDb: Database) {
    this.rawDb = rawDb;
    this.db = drizzle(rawDb);
  }

  set(
    key: string,
    value: string,
    updatedBy: string,
    type: 'string' | 'json' | 'markdown' = 'string',
    expiresAt?: string,
  ): void {
    const now = new Date().toISOString();

    (this.rawDb.run as (sql: string, ...bindings: unknown[]) => void)(
      `INSERT OR REPLACE INTO swarm_memory (key, value, type, updated_by, updated_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      key,
      value,
      type,
      updatedBy,
      now,
      expiresAt ?? null,
    );

    logger.debug({ key, by: updatedBy }, 'Memory updated');
  }

  get(key: string): MemoryEntry | undefined {
    this.cleanupExpired();

    const row = this.db
      .select()
      .from(swarmMemory)
      .where(eq(swarmMemory.key, key))
      .get();

    if (!row) return undefined;

    if (row.expires_at && new Date(row.expires_at as string) < new Date()) {
      this.delete(key);
      return undefined;
    }

    return this.rowToEntry(row);
  }

  getAsJson<T>(key: string): T | undefined {
    const entry = this.get(key);
    if (!entry || entry.type !== 'json') return undefined;

    try {
      return JSON.parse(entry.value) as T;
    } catch {
      return undefined;
    }
  }

  setJson<T>(key: string, value: T, updatedBy: string, expiresAt?: string): void {
    this.set(key, JSON.stringify(value), updatedBy, 'json', expiresAt);
  }

  delete(key: string): void {
    (this.rawDb.run as (sql: string, ...bindings: unknown[]) => void)(`DELETE FROM swarm_memory WHERE key = ?`, key);
  }

  exists(key: string): boolean {
    return this.get(key) !== undefined;
  }

  getAll(): MemoryEntry[] {
    this.cleanupExpired();

    const rows = this.db.select().from(swarmMemory).all();
    return rows.map((r) => this.rowToEntry(r));
  }

  getByPrefix(prefix: string): MemoryEntry[] {
    this.cleanupExpired();

    const rows = this.db
      .select()
      .from(swarmMemory)
      .where(sql`key LIKE ${prefix + '%'}`)
      .all();

    return rows.map((r) => this.rowToEntry(r));
  }

  increment(key: string, updatedBy: string, delta: number = 1): number {
    const entry = this.get(key);
    const current = entry ? parseInt(entry.value, 10) || 0 : 0;
    const newValue = current + delta;
    this.set(key, String(newValue), updatedBy);
    return newValue;
  }

  append(key: string, value: string, updatedBy: string, separator: string = '\n'): void {
    const entry = this.get(key);
    const newValue = entry ? entry.value + separator + value : value;
    this.set(key, newValue, updatedBy);
  }

  setWithTTL(key: string, value: string, updatedBy: string, ttlMs: number): void {
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    this.set(key, value, updatedBy, 'string', expiresAt);
  }

  cleanupExpired(): number {
    const now = new Date().toISOString();
    const result = (this.rawDb.run as (...args: unknown[]) => { changes: number })(
      `DELETE FROM swarm_memory WHERE expires_at IS NOT NULL AND expires_at < ?`,
      now,
    );
    return result.changes;
  }

  clear(): void {
    this.rawDb.exec(`DELETE FROM swarm_memory`);
  }

  export(): Record<string, unknown> {
    const entries = this.getAll();
    const result: Record<string, unknown> = {};

    for (const entry of entries) {
      if (entry.type === 'json') {
        try {
          result[entry.key] = JSON.parse(entry.value);
        } catch {
          result[entry.key] = entry.value;
        }
      } else {
        result[entry.key] = entry.value;
      }
    }

    return result;
  }

  private rowToEntry(row: Record<string, unknown>): MemoryEntry {
    return {
      key: row.key as string,
      value: row.value as string,
      type: row.type as 'string' | 'json' | 'markdown',
      updatedBy: row.updated_by as string,
      updatedAt: row.updated_at as string,
      expiresAt: row.expires_at as string | undefined,
    };
  }
}

import { sql } from 'drizzle-orm';
