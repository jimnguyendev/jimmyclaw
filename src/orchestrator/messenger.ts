import { randomUUID } from 'crypto';
import { Database } from 'bun:sqlite';
import { eq, and, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { swarmMessages } from '../db/schema.js';
import { SwarmMessage, MessageType } from './types.js';
import { logger } from '../logger.js';

export class Messenger {
  private db: ReturnType<typeof drizzle>;
  private rawDb: Database;

  constructor(rawDb: Database) {
    this.rawDb = rawDb;
    this.db = drizzle(rawDb);
  }

  sendMessage(params: {
    fromAgent: string;
    toAgent?: string;
    type: MessageType;
    content: string;
    taskId?: string;
  }): SwarmMessage {
    const message: SwarmMessage = {
      id: randomUUID(),
      fromAgent: params.fromAgent,
      toAgent: params.toAgent,
      type: params.type,
      content: params.content,
      taskId: params.taskId,
      createdAt: new Date().toISOString(),
    };

    (this.rawDb.run as (sql: string, ...bindings: unknown[]) => void)(
      `INSERT INTO swarm_messages (id, from_agent, to_agent, type, content, task_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      message.id,
      message.fromAgent,
      message.toAgent ?? null,
      message.type,
      message.content,
      message.taskId ?? null,
      message.createdAt,
    );

    logger.debug(
      { msgId: message.id, from: message.fromAgent, to: message.toAgent, type: message.type },
      'Message sent',
    );
    return message;
  }

  broadcast(fromAgent: string, content: string, taskId?: string): SwarmMessage {
    return this.sendMessage({
      fromAgent,
      toAgent: undefined,
      type: 'broadcast',
      content,
      taskId,
    });
  }

  getUnreadMessages(agentId: string): SwarmMessage[] {
    const rows = this.db
      .select()
      .from(swarmMessages)
      .where(
        and(
          eq(swarmMessages.to_agent, agentId),
          isNull(swarmMessages.read_at),
        ),
      )
      .all();

    return rows.map((r) => this.rowToMessage(r));
  }

  getBroadcastMessages(since: string): SwarmMessage[] {
    const rows = this.db
      .select()
      .from(swarmMessages)
      .where(
        and(
          isNull(swarmMessages.to_agent),
          sql`${swarmMessages.created_at} > ${since}`,
        ),
      )
      .all();

    return rows.map((r) => this.rowToMessage(r));
  }

  markAsRead(messageId: string): void {
    const now = new Date().toISOString();
    (this.rawDb.run as (sql: string, ...bindings: unknown[]) => void)(`UPDATE swarm_messages SET read_at = ? WHERE id = ?`, now, messageId);
  }

  markAllAsRead(agentId: string): void {
    const now = new Date().toISOString();
    (this.rawDb.run as (sql: string, ...bindings: unknown[]) => void)(
      `UPDATE swarm_messages SET read_at = ? WHERE to_agent = ? AND read_at IS NULL`,
      now,
      agentId,
    );
  }

  getMessagesForTask(taskId: string): SwarmMessage[] {
    const rows = this.db
      .select()
      .from(swarmMessages)
      .where(eq(swarmMessages.task_id, taskId))
      .all();
    return rows.map((r) => this.rowToMessage(r));
  }

  cleanupOldMessages(maxAge: number): number {
    const cutoff = new Date(Date.now() - maxAge).toISOString();
    const result = (this.rawDb.run as (...args: unknown[]) => { changes: number })(`DELETE FROM swarm_messages WHERE created_at < ?`, cutoff);
    return result.changes;
  }

  private rowToMessage(row: Record<string, unknown>): SwarmMessage {
    return {
      id: row.id as string,
      fromAgent: row.from_agent as string,
      toAgent: row.to_agent as string | undefined,
      type: row.type as MessageType,
      content: row.content as string,
      taskId: row.task_id as string | undefined,
      readAt: row.read_at as string | undefined,
      createdAt: row.created_at as string,
    };
  }
}

import { sql } from 'drizzle-orm';
