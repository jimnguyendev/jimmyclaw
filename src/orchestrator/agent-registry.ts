import { Database } from 'bun:sqlite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { swarmAgents } from '../db/schema.js';
import { SwarmAgent, AgentStatus, AgentRole, AgentConfig, DEFAULT_AGENT_CONFIGS } from './types.js';
import { logger } from '../logger.js';

export class AgentRegistry {
  private db: ReturnType<typeof drizzle>;
  private rawDb: Database;
  private agents: Map<string, SwarmAgent> = new Map();

  constructor(rawDb: Database) {
    this.rawDb = rawDb;
    this.db = drizzle(rawDb);
  }

  registerAgent(config: AgentConfig): SwarmAgent {
    const agent: SwarmAgent = {
      id: config.id,
      role: config.role,
      model: config.model,
      fallbackModel: config.fallbackModel ?? undefined,
      status: 'idle',
      totalTasks: 0,
      successCount: 0,
      createdAt: new Date().toISOString(),
    };

    (this.rawDb.run as (sql: string, ...bindings: unknown[]) => void)(
      `INSERT OR REPLACE INTO swarm_agents (
        id, role, model, fallback_model, status, total_tasks, success_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      agent.id,
      agent.role,
      agent.model,
      agent.fallbackModel ?? null,
      agent.status,
      agent.totalTasks,
      agent.successCount,
      agent.createdAt,
    );

    this.agents.set(config.id, agent);
    logger.info({ agentId: agent.id, role: agent.role, model: agent.model }, 'Agent registered');
    return agent;
  }

  unregisterAgent(agentId: string): void {
    (this.rawDb.run as (sql: string, ...bindings: unknown[]) => void)(
      `DELETE FROM swarm_agents WHERE id = ?`,
      agentId,
    );
    this.agents.delete(agentId);
    logger.info({ agentId }, 'Agent unregistered');
  }

  getAgent(agentId: string): SwarmAgent | undefined {
    if (this.agents.has(agentId)) {
      return this.agents.get(agentId);
    }

    const row = this.db
      .select()
      .from(swarmAgents)
      .where(eq(swarmAgents.id, agentId))
      .get();

    if (row) {
      const agent = this.rowToAgent(row);
      this.agents.set(agentId, agent);
      return agent;
    }
    return undefined;
  }

  getAgentByRole(role: AgentRole): SwarmAgent | undefined {
    const row = this.db
      .select()
      .from(swarmAgents)
      .where(eq(swarmAgents.role, role))
      .get();
    return row ? this.rowToAgent(row) : undefined;
  }

  getAllAgents(): SwarmAgent[] {
    const rows = this.db.select().from(swarmAgents).all();
    return rows.map((r) => this.rowToAgent(r));
  }

  getIdleAgentsByRole(role: AgentRole): SwarmAgent[] {
    const rows = this.db
      .select()
      .from(swarmAgents)
      .where(eq(swarmAgents.role, role))
      .all();

    return rows
      .filter((r) => r.status === 'idle')
      .map((r) => this.rowToAgent(r));
  }

  updateStatus(agentId: string, status: AgentStatus): void {
    const now = new Date().toISOString();
    (this.rawDb.run as (sql: string, ...bindings: unknown[]) => void)(
      `UPDATE swarm_agents SET status = ?, last_heartbeat = ? WHERE id = ?`,
      status,
      now,
      agentId,
    );

    const agent = this.agents.get(agentId);
    if (agent) {
      agent.status = status;
      agent.lastHeartbeat = now;
    }
  }

  setCurrentTask(agentId: string, taskId: string | undefined): void {
    (this.rawDb.run as (sql: string, ...bindings: unknown[]) => void)(
      `UPDATE swarm_agents SET current_task_id = ? WHERE id = ?`,
      taskId ?? null,
      agentId,
    );

    const agent = this.agents.get(agentId);
    if (agent) {
      agent.currentTaskId = taskId;
    }
  }

  recordHeartbeat(agentId: string): void {
    const now = new Date().toISOString();
    (this.rawDb.run as (sql: string, ...bindings: unknown[]) => void)(
      `UPDATE swarm_agents SET last_heartbeat = ? WHERE id = ?`,
      now,
      agentId,
    );

    const agent = this.agents.get(agentId);
    if (agent) {
      agent.lastHeartbeat = now;
    }
  }

  incrementTaskCount(agentId: string, success: boolean): void {
    (this.rawDb.run as (sql: string, ...bindings: unknown[]) => void)(
      `UPDATE swarm_agents SET 
        total_tasks = total_tasks + 1,
        success_count = success_count + ?
       WHERE id = ?`,
      success ? 1 : 0,
      agentId,
    );

    const agent = this.agents.get(agentId);
    if (agent) {
      agent.totalTasks++;
      if (success) agent.successCount++;
    }
  }

  getStaleAgents(timeoutMs: number): SwarmAgent[] {
    const cutoff = new Date(Date.now() - timeoutMs).toISOString();
    const rows = this.db
      .select()
      .from(swarmAgents)
      .where(eq(swarmAgents.status, 'busy'))
      .all();

    return rows
      .filter((r) => r.last_heartbeat && r.last_heartbeat < cutoff)
      .map((r) => this.rowToAgent(r));
  }

  selectBestAgentForTask(taskType: string): SwarmAgent | undefined {
    const roleMap: Record<string, AgentRole> = {
      research: 'researcher',
      code: 'coder',
      review: 'reviewer',
      write: 'writer',
      general: 'researcher',
    };

    const role = roleMap[taskType] || 'researcher';
    const idleAgents = this.getIdleAgentsByRole(role);

    if (idleAgents.length === 0) {
      return undefined;
    }

    return idleAgents.reduce((best, agent) => {
      const bestSuccessRate = best.totalTasks > 0 ? best.successCount / best.totalTasks : 0;
      const agentSuccessRate = agent.totalTasks > 0 ? agent.successCount / agent.totalTasks : 0;
      return agentSuccessRate > bestSuccessRate ? agent : best;
    });
  }

  initializeDefaultAgents(): void {
    const defaultConfigs: AgentConfig[] = [
      { id: 'andy', ...DEFAULT_AGENT_CONFIGS.leader },
      { id: 'sarah', ...DEFAULT_AGENT_CONFIGS.researcher },
      { id: 'mike', ...DEFAULT_AGENT_CONFIGS.coder },
      { id: 'emma', ...DEFAULT_AGENT_CONFIGS.reviewer },
    ];

    for (const config of defaultConfigs) {
      const existing = this.getAgent(config.id);
      if (!existing) {
        this.registerAgent(config);
      }
    }
  }

  private rowToAgent(row: Record<string, unknown>): SwarmAgent {
    return {
      id: row.id as string,
      role: row.role as AgentRole,
      model: row.model as string,
      fallbackModel: row.fallback_model as string | undefined,
      status: row.status as AgentStatus,
      currentTaskId: row.current_task_id as string | undefined,
      lastHeartbeat: row.last_heartbeat as string | undefined,
      totalTasks: row.total_tasks as number,
      successCount: row.success_count as number,
      createdAt: row.created_at as string,
    };
  }
}
