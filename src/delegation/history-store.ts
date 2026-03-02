import { Database } from 'bun:sqlite';
import { 
  DelegationHistoryRecord, 
  DelegationHistoryFilter, 
  DelegationHistoryStats, 
  DelegationHistoryStatus 
} from './history-types.js';

export class DelegationHistoryStore {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
    this.initTable();
  }

  private initTable(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS delegation_history (
        id TEXT PRIMARY KEY,
        source_agent TEXT NOT NULL,
        target_agent TEXT NOT NULL,
        user_id TEXT NOT NULL,
        task TEXT NOT NULL,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        result TEXT,
        error TEXT,
        iterations INTEGER DEFAULT 0,
        duration_ms INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        completed_at TEXT
      )
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_delegation_source ON delegation_history(source_agent)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_delegation_target ON delegation_history(target_agent)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_delegation_user ON delegation_history(user_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_delegation_status ON delegation_history(status)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_delegation_created ON delegation_history(created_at)`);
  }

  async save(record: DelegationHistoryRecord): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO delegation_history (
        id, source_agent, target_agent, user_id, task, mode, status,
        result, error, iterations, duration_ms, created_at, completed_at
      ) VALUES ($id, $sourceAgent, $targetAgent, $userId, $task, $mode, $status,
        $result, $error, $iterations, $durationMs, $createdAt, $completedAt)
    `);

    stmt.run({
      $id: record.id,
      $sourceAgent: record.sourceAgent,
      $targetAgent: record.targetAgent,
      $userId: record.userId,
      $task: record.task,
      $mode: record.mode,
      $status: record.status,
      $result: record.result ?? null,
      $error: record.error ?? null,
      $iterations: record.iterations,
      $durationMs: record.durationMs,
      $createdAt: record.createdAt.toISOString(),
      $completedAt: record.completedAt?.toISOString() ?? null,
    });
  }

  async get(id: string): Promise<DelegationHistoryRecord | null> {
    const stmt = this.db.prepare(`SELECT * FROM delegation_history WHERE id = $id`);
    const row = stmt.get({ $id: id }) as Record<string, unknown> | undefined;
    return row ? this.rowToRecord(row) : null;
  }

  async query(filter: DelegationHistoryFilter = {}): Promise<DelegationHistoryRecord[]> {
    let sql = 'SELECT * FROM delegation_history WHERE 1=1';
    const params: Record<string, string | number> = {};

    if (filter.sourceAgent) {
      sql += ' AND source_agent = $sourceAgent';
      params.$sourceAgent = filter.sourceAgent;
    }

    if (filter.targetAgent) {
      sql += ' AND target_agent = $targetAgent';
      params.$targetAgent = filter.targetAgent;
    }

    if (filter.userId) {
      sql += ' AND user_id = $userId';
      params.$userId = filter.userId;
    }

    if (filter.status) {
      sql += ' AND status = $status';
      params.$status = filter.status;
    }

    if (filter.startDate) {
      sql += ' AND created_at >= $startDate';
      params.$startDate = filter.startDate.toISOString();
    }

    if (filter.endDate) {
      sql += ' AND created_at <= $endDate';
      params.$endDate = filter.endDate.toISOString();
    }

    sql += ' ORDER BY created_at DESC';

    if (filter.limit) {
      sql += ' LIMIT $limit';
      params.$limit = filter.limit;
    }

    if (filter.offset) {
      sql += ' OFFSET $offset';
      params.$offset = filter.offset;
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(params) as Record<string, unknown>[];
    return rows.map((row) => this.rowToRecord(row));
  }

  async getStats(): Promise<DelegationHistoryStats> {
    const stmt = this.db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
        AVG(duration_ms) as avgDurationMs,
        AVG(iterations) as avgIterations
      FROM delegation_history
    `);

    const row = stmt.get() as {
      total: number;
      completed: number;
      failed: number;
      cancelled: number;
      avgDurationMs: number | null;
      avgIterations: number | null;
    };

    return {
      total: row.total || 0,
      completed: row.completed || 0,
      failed: row.failed || 0,
      cancelled: row.cancelled || 0,
      avgDurationMs: Math.round(row.avgDurationMs || 0),
      avgIterations: Math.round(row.avgIterations || 0),
    };
  }

  async delete(id: string): Promise<boolean> {
    const stmt = this.db.prepare('DELETE FROM delegation_history WHERE id = $id');
    const result = stmt.run({ $id: id });
    return result.changes > 0;
  }

  async deleteOlderThan(date: Date): Promise<number> {
    const stmt = this.db.prepare('DELETE FROM delegation_history WHERE created_at < $date');
    const result = stmt.run({ $date: date.toISOString() });
    return result.changes;
  }

  async clear(): Promise<void> {
    this.db.run('DELETE FROM delegation_history');
  }

  private rowToRecord(row: Record<string, unknown>): DelegationHistoryRecord {
    return {
      id: row.id as string,
      sourceAgent: row.source_agent as string,
      targetAgent: row.target_agent as string,
      userId: row.user_id as string,
      task: row.task as string,
      mode: row.mode as string,
      status: row.status as DelegationHistoryStatus,
      result: row.result as string | undefined,
      error: row.error as string | undefined,
      iterations: row.iterations as number,
      durationMs: row.duration_ms as number,
      createdAt: new Date(row.created_at as string),
      completedAt: row.completed_at ? new Date(row.completed_at as string) : undefined,
    };
  }
}

export function createHistoryStore(db: Database): DelegationHistoryStore {
  return new DelegationHistoryStore(db);
}
