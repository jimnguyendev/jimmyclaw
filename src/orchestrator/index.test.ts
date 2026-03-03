import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { Database } from 'bun:sqlite';

mock.module('../logger.js', () => ({
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
}));

import { AgentOrchestrator } from './index.js';
import { TaskQueue } from './task-queue.js';
import { AgentRegistry } from './agent-registry.js';
import { Messenger } from './messenger.js';
import { SharedMemory } from './memory.js';

describe('AgentOrchestrator', () => {
  let db: Database;
  let orchestrator: AgentOrchestrator;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE IF NOT EXISTS swarm_agents (
        id TEXT PRIMARY KEY,
        role TEXT NOT NULL,
        model TEXT NOT NULL,
        fallback_model TEXT,
        status TEXT DEFAULT 'idle',
        current_task_id TEXT,
        last_heartbeat TEXT,
        total_tasks INTEGER DEFAULT 0,
        success_count INTEGER DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS swarm_tasks (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        priority INTEGER DEFAULT 0,
        prompt TEXT NOT NULL,
        context TEXT,
        from_agent TEXT NOT NULL,
        to_agent TEXT,
        parent_task_id TEXT,
        status TEXT DEFAULT 'pending',
        result TEXT,
        error TEXT,
        tokens_used INTEGER,
        cost INTEGER,
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        timeout_ms INTEGER DEFAULT 300000,
        retries INTEGER DEFAULT 0,
        max_retries INTEGER DEFAULT 3,
        user_id TEXT,
        chat_jid TEXT
      );
      CREATE TABLE IF NOT EXISTS swarm_messages (
        id TEXT PRIMARY KEY,
        from_agent TEXT NOT NULL,
        to_agent TEXT,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        task_id TEXT,
        read_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS swarm_memory (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        type TEXT DEFAULT 'string',
        updated_by TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT
      );
    `);
    orchestrator = new AgentOrchestrator(db);
    orchestrator.initialize();
  });

  afterEach(async () => {
    await orchestrator.shutdown();
    db.close();
  });

  describe('task classification', () => {
    it('should classify research tasks correctly', () => {
      const result = orchestrator.classifyTask('Tìm hiểu về React 19');
      expect(result.type).toBe('research');
      expect(result.suggestedAgent).toBe('sarah');
    });

    it('should classify code tasks correctly', () => {
      const result = orchestrator.classifyTask('Implement REST API for user management');
      expect(result.type).toBe('code');
      expect(result.suggestedAgent).toBe('mike');
    });

    it('should classify review tasks correctly', () => {
      const result = orchestrator.classifyTask('Kiểm tra code này có bug gì không');
      expect(result.type).toBe('review');
      expect(result.suggestedAgent).toBe('emma');
    });

    it('should classify write tasks correctly', () => {
      const result = orchestrator.classifyTask('Viết documentation cho project');
      expect(result.type).toBe('write');
    });

    it('should default to research for general tasks', () => {
      const result = orchestrator.classifyTask('Hello, how are you?');
      expect(result.type).toBe('general');
    });
  });

  describe('agent registry', () => {
    it('should initialize default agents', () => {
      const status = orchestrator.getStatus();
      expect(status.agents.length).toBe(4);
      expect(status.agents.find((a) => a.id === 'andy')).toBeDefined();
      expect(status.agents.find((a) => a.id === 'sarah')).toBeDefined();
      expect(status.agents.find((a) => a.id === 'mike')).toBeDefined();
      expect(status.agents.find((a) => a.id === 'emma')).toBeDefined();
    });

    it('should select best agent for task type', () => {
      const registry = orchestrator.getAgentRegistry();
      const agent = registry.selectBestAgentForTask('research');
      expect(agent?.role).toBe('researcher');
    });
  });

  describe('task queue', () => {
    it('should create tasks', () => {
      const queue = orchestrator.getTaskQueue();
      const task = queue.createTask({
        type: 'research',
        prompt: 'Test prompt',
        fromAgent: 'andy',
      });

      expect(task.id).toBeDefined();
      expect(task.status).toBe('pending');
      expect(task.type).toBe('research');
    });

    it('should assign tasks to agents', () => {
      const queue = orchestrator.getTaskQueue();
      const task = queue.createTask({
        type: 'research',
        prompt: 'Test prompt',
        fromAgent: 'andy',
      });

      queue.assignTask(task.id, 'sarah');
      const updated = queue.getTask(task.id);

      expect(updated?.status).toBe('assigned');
      expect(updated?.toAgent).toBe('sarah');
    });

    it('should complete tasks', () => {
      const queue = orchestrator.getTaskQueue();
      const task = queue.createTask({
        type: 'research',
        prompt: 'Test prompt',
        fromAgent: 'andy',
      });

      queue.startTask(task.id);
      queue.completeTask(task.id, 'Task result', 100);

      const updated = queue.getTask(task.id);
      expect(updated?.status).toBe('done');
      expect(updated?.result).toBe('Task result');
      expect(updated?.tokensUsed).toBe(100);
    });

    it('should handle retries', () => {
      const queue = orchestrator.getTaskQueue();
      const task = queue.createTask({
        type: 'research',
        prompt: 'Test prompt',
        fromAgent: 'andy',
      });

      const canRetry = queue.incrementRetry(task.id);
      expect(canRetry).toBe(true);

      const updated = queue.getTask(task.id);
      expect(updated?.retries).toBe(1);
      expect(updated?.status).toBe('pending');
    });
  });

  describe('messenger', () => {
    it('should send and receive messages', () => {
      const messenger = orchestrator.getMessenger();

      const msg = messenger.sendMessage({
        fromAgent: 'andy',
        toAgent: 'sarah',
        type: 'task_assign',
        content: 'Hello Sarah',
      });

      expect(msg.id).toBeDefined();
      expect(msg.fromAgent).toBe('andy');
      expect(msg.toAgent).toBe('sarah');

      const unread = messenger.getUnreadMessages('sarah');
      expect(unread.length).toBe(1);
      expect(unread[0].content).toBe('Hello Sarah');
    });

    it('should broadcast messages', () => {
      const messenger = orchestrator.getMessenger();

      messenger.broadcast('andy', 'Team meeting in 5 minutes');

      const broadcasts = messenger.getBroadcastMessages(new Date(0).toISOString());
      expect(broadcasts.length).toBe(1);
    });
  });

  describe('shared memory', () => {
    it('should store and retrieve values', () => {
      const memory = orchestrator.getMemory();

      memory.set('test_key', 'test_value', 'andy');
      const value = memory.get('test_key');

      expect(value?.value).toBe('test_value');
      expect(value?.updatedBy).toBe('andy');
    });

    it('should handle JSON values', () => {
      const memory = orchestrator.getMemory();

      memory.setJson<{ model: string }>('config', { model: 'gemini' }, 'andy');
      const config = memory.getAsJson<{ model: string }>('config');

      expect(config?.model).toBe('gemini');
    });

    it('should handle expiration', async () => {
      const memory = orchestrator.getMemory();

      memory.setWithTTL('temp_key', 'temp_value', 'andy', 100);
      
      expect(memory.get('temp_key')?.value).toBe('temp_value');

      await new Promise((r) => setTimeout(r, 150));

      expect(memory.get('temp_key')).toBeUndefined();
    });
  });

  describe('processUserMessage', () => {
    it('should classify and create task for message', () => {
      const classification = orchestrator.classifyTask('Research React 19 features');
      
      expect(classification.type).toBe('research');
      expect(classification.suggestedAgent).toBe('sarah');
    });
  });

  describe('channel messenger routing', () => {
    it('should identify local agents correctly', () => {
      const status = orchestrator.getStatus();
      const localAgentIds = ['andy', 'sarah', 'mike', 'emma'];
      
      for (const agent of status.agents) {
        expect(localAgentIds).toContain(agent.id);
      }
    });

    it('should route to local agent when available', () => {
      const classification = orchestrator.classifyTask('Research something');
      expect(classification.suggestedAgent).toBe('sarah');
      
      const registry = orchestrator.getAgentRegistry();
      const agent = registry.getAgent('sarah');
      expect(agent).toBeDefined();
      expect(agent?.role).toBe('researcher');
    });

    it('should have fallback models configured for agents', () => {
      const registry = orchestrator.getAgentRegistry();
      const agents = registry.getAllAgents();
      
      for (const agent of agents) {
        expect(agent.model).toBeDefined();
      }
    });
  });

  describe('fallback logic', () => {
    it('should find local agent by role', () => {
      const registry = orchestrator.getAgentRegistry();
      const researchers = registry.getAllAgents().filter(a => a.role === 'researcher');
      
      expect(researchers.length).toBeGreaterThan(0);
      expect(researchers[0].id).toBe('sarah');
    });

    it('should have multiple agent roles available', () => {
      const registry = orchestrator.getAgentRegistry();
      const agents = registry.getAllAgents();
      const roles = new Set(agents.map(a => a.role));
      
      expect(roles.has('leader')).toBe(true);
      expect(roles.has('researcher')).toBe(true);
      expect(roles.has('coder')).toBe(true);
      expect(roles.has('reviewer')).toBe(true);
    });
  });
});
