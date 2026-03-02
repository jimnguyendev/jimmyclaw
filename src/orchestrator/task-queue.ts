import { randomUUID } from 'crypto';
import { Database } from 'bun:sqlite';
import { eq, and, isNull, desc, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { swarmTasks } from '../db/schema.js';
import { SwarmTask, TaskStatus, TaskType } from './types.js';
import { logger } from '../logger.js';

export class TaskQueue {
  private db: ReturnType<typeof drizzle>;
  private rawDb: Database;

  constructor(rawDb: Database) {
    this.rawDb = rawDb;
    this.db = drizzle(rawDb);
  }

  createTask(params: {
    type: TaskType;
    prompt: string;
    fromAgent: string;
    toAgent?: string;
    context?: string;
    priority?: number;
    parentTaskId?: string;
    userId?: string;
    chatJid?: string;
    timeoutMs?: number;
  }): SwarmTask {
    const task: SwarmTask = {
      id: randomUUID(),
      type: params.type,
      priority: params.priority ?? 0,
      prompt: params.prompt,
      context: params.context,
      fromAgent: params.fromAgent,
      toAgent: params.toAgent,
      parentTaskId: params.parentTaskId,
      status: 'pending',
      createdAt: new Date().toISOString(),
      timeoutMs: params.timeoutMs ?? 300000,
      retries: 0,
      maxRetries: 3,
      userId: params.userId,
      chatJid: params.chatJid,
    };

    (this.rawDb.run as (sql: string, ...bindings: unknown[]) => void)(
      `INSERT INTO swarm_tasks (
        id, type, priority, prompt, context, from_agent, to_agent, parent_task_id,
        status, created_at, timeout_ms, retries, max_retries, user_id, chat_jid
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      task.id,
      task.type,
      task.priority,
      task.prompt,
      task.context ?? null,
      task.fromAgent,
      task.toAgent ?? null,
      task.parentTaskId ?? null,
      task.status,
      task.createdAt,
      task.timeoutMs,
      task.retries,
      task.maxRetries,
      task.userId ?? null,
      task.chatJid ?? null,
    );

    logger.info({ taskId: task.id, type: task.type, from: task.fromAgent }, 'Task created');
    return task;
  }

  getTask(taskId: string): SwarmTask | undefined {
    const row = this.db
      .select()
      .from(swarmTasks)
      .where(eq(swarmTasks.id, taskId))
      .get();
    return row ? this.rowToTask(row) : undefined;
  }

  getNextPendingTask(agentId?: string): SwarmTask | undefined {
    const query = agentId
      ? this.db
          .select()
          .from(swarmTasks)
          .where(and(eq(swarmTasks.status, 'pending'), eq(swarmTasks.to_agent, agentId)))
          .orderBy(desc(swarmTasks.priority), swarmTasks.created_at)
          .limit(1)
      : this.db
          .select()
          .from(swarmTasks)
          .where(eq(swarmTasks.status, 'pending'))
          .orderBy(desc(swarmTasks.priority), swarmTasks.created_at)
          .limit(1);

    const row = query.get();
    return row ? this.rowToTask(row) : undefined;
  }

  getPendingTasksForAgent(agentId: string): SwarmTask[] {
    const rows = this.db
      .select()
      .from(swarmTasks)
      .where(and(eq(swarmTasks.status, 'pending'), eq(swarmTasks.to_agent, agentId)))
      .orderBy(desc(swarmTasks.priority), swarmTasks.created_at)
      .all();
    return rows.map((r) => this.rowToTask(r));
  }

  assignTask(taskId: string, agentId: string): void {
    const now = new Date().toISOString();
    (this.rawDb.run as (sql: string, ...bindings: unknown[]) => void)(
      `UPDATE swarm_tasks SET to_agent = ?, status = 'assigned', started_at = ? WHERE id = ?`,
      agentId,
      now,
      taskId,
    );
    logger.info({ taskId, agentId }, 'Task assigned');
  }

  startTask(taskId: string): void {
    const now = new Date().toISOString();
    (this.rawDb.run as (sql: string, ...bindings: unknown[]) => void)(
      `UPDATE swarm_tasks SET status = 'processing', started_at = ? WHERE id = ?`,
      now,
      taskId,
    );
    logger.info({ taskId }, 'Task started');
  }

  completeTask(taskId: string, result: string, tokensUsed?: number, cost?: number): void {
    const now = new Date().toISOString();
    (this.rawDb.run as (sql: string, ...bindings: unknown[]) => void)(
      `UPDATE swarm_tasks SET status = 'done', result = ?, completed_at = ?, tokens_used = ?, cost = ? WHERE id = ?`,
      result,
      now,
      tokensUsed ?? null,
      cost ?? null,
      taskId,
    );
    logger.info({ taskId, tokensUsed }, 'Task completed');
  }

  failTask(taskId: string, error: string): void {
    const now = new Date().toISOString();
    (this.rawDb.run as (sql: string, ...bindings: unknown[]) => void)(
      `UPDATE swarm_tasks SET status = 'failed', error = ?, completed_at = ? WHERE id = ?`,
      error,
      now,
      taskId,
    );
    logger.error({ taskId, error }, 'Task failed');
  }

  timeoutTask(taskId: string): void {
    const now = new Date().toISOString();
    (this.rawDb.run as (sql: string, ...bindings: unknown[]) => void)(
      `UPDATE swarm_tasks SET status = 'timeout', completed_at = ? WHERE id = ?`,
      now,
      taskId,
    );
    logger.warn({ taskId }, 'Task timed out');
  }

  incrementRetry(taskId: string): boolean {
    const task = this.getTask(taskId);
    if (!task) return false;

    if (task.retries >= task.maxRetries) {
      this.failTask(taskId, 'Max retries exceeded');
      return false;
    }

    (this.rawDb.run as (sql: string, ...bindings: unknown[]) => void)(
      `UPDATE swarm_tasks SET retries = retries + 1, status = 'pending', to_agent = NULL WHERE id = ?`,
      taskId,
    );
    logger.info({ taskId, retries: task.retries + 1 }, 'Task retry');
    return true;
  }

  getTasksByStatus(status: TaskStatus): SwarmTask[] {
    const rows = this.db
      .select()
      .from(swarmTasks)
      .where(eq(swarmTasks.status, status))
      .orderBy(swarmTasks.created_at)
      .all();
    return rows.map((r) => this.rowToTask(r));
  }

  getChildTasks(parentTaskId: string): SwarmTask[] {
    const rows = this.db
      .select()
      .from(swarmTasks)
      .where(eq(swarmTasks.parent_task_id, parentTaskId))
      .all();
    return rows.map((r) => this.rowToTask(r));
  }

  getStaleTasks(timeoutMs: number): SwarmTask[] {
    const cutoff = new Date(Date.now() - timeoutMs).toISOString();
    const rows = this.db
      .select()
      .from(swarmTasks)
      .where(
        and(
          sql`${swarmTasks.status} IN ('assigned', 'processing')`,
          sql`${swarmTasks.started_at} < ${cutoff}`,
        ),
      )
      .all();
    return rows.map((r) => this.rowToTask(r));
  }

  cleanupOldTasks(maxAge: number): number {
    const cutoff = new Date(Date.now() - maxAge).toISOString();
    const result = (this.rawDb.run as (...args: unknown[]) => { changes: number })(
      `DELETE FROM swarm_tasks WHERE status IN ('done', 'failed', 'timeout') AND completed_at < ?`,
      cutoff,
    );
    return result.changes;
  }

  private rowToTask(row: Record<string, unknown>): SwarmTask {
    return {
      id: row.id as string,
      type: row.type as TaskType,
      priority: row.priority as number,
      prompt: row.prompt as string,
      context: row.context as string | undefined,
      fromAgent: row.from_agent as string,
      toAgent: row.to_agent as string | undefined,
      parentTaskId: row.parent_task_id as string | undefined,
      status: row.status as TaskStatus,
      result: row.result as string | undefined,
      error: row.error as string | undefined,
      tokensUsed: row.tokens_used as number | undefined,
      cost: row.cost as number | undefined,
      createdAt: row.created_at as string,
      startedAt: row.started_at as string | undefined,
      completedAt: row.completed_at as string | undefined,
      timeoutMs: row.timeout_ms as number,
      retries: row.retries as number,
      maxRetries: row.max_retries as number,
      userId: row.user_id as string | undefined,
      chatJid: row.chat_jid as string | undefined,
    };
  }
}
