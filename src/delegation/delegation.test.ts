import { describe, test, expect, beforeEach } from 'bun:test';
import { AgentLinkStore } from './link-store.js';
import { DelegationManager } from './manager.js';
import { DelegationTools } from './tools.js';
import { AgentLink, DelegationContext } from './types.js';

describe('AgentLinkStore', () => {
  let store: AgentLinkStore;

  beforeEach(() => {
    store = new AgentLinkStore();
  });

  test('creates and retrieves links', () => {
    const link: AgentLink = {
      sourceAgent: 'agent-a',
      targetAgent: 'agent-b',
      direction: 'outbound',
      maxConcurrent: 3,
    };
    store.createLink(link);

    const retrieved = store.getLink('agent-a', 'agent-b');
    expect(retrieved).toBeDefined();
    expect(retrieved?.sourceAgent).toBe('agent-a');
    expect(retrieved?.targetAgent).toBe('agent-b');
  });

  test('creates bidirectional links', () => {
    const link: AgentLink = {
      sourceAgent: 'agent-a',
      targetAgent: 'agent-b',
      direction: 'bidirectional',
      maxConcurrent: 5,
    };
    store.createLink(link);

    expect(store.canDelegate('agent-a', 'agent-b')).toBe(true);
    expect(store.canDelegate('agent-b', 'agent-a')).toBe(true);
  });

  test('canDelegate checks direction', () => {
    store.createLink({
      sourceAgent: 'agent-a',
      targetAgent: 'agent-b',
      direction: 'outbound',
      maxConcurrent: 3,
    });

    expect(store.canDelegate('agent-a', 'agent-b')).toBe(true);
    expect(store.canDelegate('agent-b', 'agent-a')).toBe(false);
  });

  test('checkUserPermission respects user allow/deny lists', () => {
    store.createLink({
      sourceAgent: 'agent-a',
      targetAgent: 'agent-b',
      direction: 'outbound',
      maxConcurrent: 3,
      settings: {
        userAllow: ['user1', 'user2'],
      },
    });

    expect(store.checkUserPermission('agent-a', 'agent-b', 'user1')).toBe(true);
    expect(store.checkUserPermission('agent-a', 'agent-b', 'user3')).toBe(false);
  });

  test('checkUserPermission denies users in deny list', () => {
    store.createLink({
      sourceAgent: 'agent-a',
      targetAgent: 'agent-b',
      direction: 'outbound',
      maxConcurrent: 3,
      settings: {
        userDeny: ['blocked-user'],
      },
    });

    expect(store.checkUserPermission('agent-a', 'agent-b', 'blocked-user')).toBe(false);
    expect(store.checkUserPermission('agent-a', 'agent-b', 'other-user')).toBe(true);
  });

  test('getOutboundLinks returns correct links', () => {
    store.createLink({
      sourceAgent: 'agent-a',
      targetAgent: 'agent-b',
      direction: 'outbound',
      maxConcurrent: 3,
    });
    store.createLink({
      sourceAgent: 'agent-a',
      targetAgent: 'agent-c',
      direction: 'outbound',
      maxConcurrent: 3,
    });

    const links = store.getOutboundLinks('agent-a');
    expect(links.length).toBe(2);
  });

  test('removes links', () => {
    store.createLink({
      sourceAgent: 'agent-a',
      targetAgent: 'agent-b',
      direction: 'outbound',
      maxConcurrent: 3,
    });

    expect(store.hasLink('agent-a', 'agent-b')).toBe(true);
    store.removeLink('agent-a', 'agent-b');
    expect(store.hasLink('agent-a', 'agent-b')).toBe(false);
  });
});

describe('DelegationManager', () => {
  let manager: DelegationManager;
  let linkStore: AgentLinkStore;
  const context: DelegationContext = { userId: 'user1', sessionId: 'session1' };

  beforeEach(() => {
    linkStore = new AgentLinkStore();
    manager = new DelegationManager(linkStore);

    linkStore.createLink({
      sourceAgent: 'main-agent',
      targetAgent: 'researcher',
      direction: 'outbound',
      maxConcurrent: 3,
    });
  });

  test('rejects delegation without link', async () => {
    await expect(
      manager.delegate('unknown-agent', { targetAgent: 'researcher', task: 'test' }, context)
    ).rejects.toThrow('No delegation link');
  });

  test('rejects delegation without permission', async () => {
    linkStore.createLink({
      sourceAgent: 'main-agent',
      targetAgent: 'researcher',
      direction: 'outbound',
      maxConcurrent: 3,
      settings: { userDeny: ['user1'] },
    });

    await expect(
      manager.delegate('main-agent', { targetAgent: 'researcher', task: 'test' }, context)
    ).rejects.toThrow('not authorized');
  });

  test('performs sync delegation', async () => {
    manager.setAgentRunner(async () => ({
      content: 'Research complete',
      iterations: 1,
    }));

    const result = await manager.delegate(
      'main-agent',
      { targetAgent: 'researcher', task: 'Search for X', mode: 'sync' },
      context
    );

    expect(result.success).toBe(true);
    expect(result.content).toBe('Research complete');
    expect(result.delegationId).toBeDefined();
  });

  test('returns immediately for async delegation', async () => {
    manager.setAgentRunner(async () => ({
      content: 'Research complete',
      iterations: 1,
    }));

    const result = await manager.delegate(
      'main-agent',
      { targetAgent: 'researcher', task: 'Search for X', mode: 'async' },
      context
    );

    expect(result.success).toBe(true);
    expect(result.delegationId).toBeDefined();
  });

  test('tracks active delegations', async () => {
    let resolveRunner: () => void;
    manager.setAgentRunner(async () => {
      await new Promise<void>((r) => { resolveRunner = r; });
      return { content: 'done', iterations: 1 };
    });

    const promise = manager.delegate(
      'main-agent',
      { targetAgent: 'researcher', task: 'test', mode: 'sync' },
      context
    );

    await new Promise((r) => setTimeout(r, 10));
    const active = manager.listActive('main-agent');
    expect(active.length).toBe(1);

    resolveRunner!();
    await promise;

    const activeAfter = manager.listActive('main-agent');
    expect(activeAfter.length).toBe(0);
  });

  test('cancels delegation', async () => {
    let resolveRunner: () => void;
    manager.setAgentRunner(async () => {
      await new Promise<void>((r) => { resolveRunner = r; });
      return { content: 'done', iterations: 1 };
    });

    const result = await manager.delegate(
      'main-agent',
      { targetAgent: 'researcher', task: 'test', mode: 'async' },
      context
    );

    await new Promise((r) => setTimeout(r, 5));

    const task = manager.getTask(result.delegationId);
    if (task && task.status === 'running') {
      const cancelled = manager.cancel(result.delegationId);
      expect(cancelled).toBe(true);
    }

    resolveRunner!();
    await new Promise((r) => setTimeout(r, 10));
  });

  test('emits events', async () => {
    const events: string[] = [];
    manager.onEvent((e) => events.push(e.type));

    manager.setAgentRunner(async () => ({
      content: 'done',
      iterations: 1,
    }));

    await manager.delegate(
      'main-agent',
      { targetAgent: 'researcher', task: 'test', mode: 'sync' },
      context
    );

    expect(events).toContain('started');
    expect(events).toContain('completed');
  });
});

describe('DelegationTools', () => {
  let tools: DelegationTools;
  let linkStore: AgentLinkStore;
  let manager: DelegationManager;
  const context: DelegationContext = { userId: 'user1', sessionId: 'session1' };

  beforeEach(() => {
    linkStore = new AgentLinkStore();
    manager = new DelegationManager(linkStore);
    tools = new DelegationTools(manager, linkStore);

    linkStore.createLink({
      sourceAgent: 'main-agent',
      targetAgent: 'researcher',
      direction: 'outbound',
      maxConcurrent: 3,
    });

    tools.registerAgent({
      key: 'researcher',
      name: 'Research Agent',
      description: 'Searches for information',
      model: 'claude-3-haiku',
    });
  });

  test('registers and lists agents', () => {
    const agents = tools.listAgents();
    expect(agents.length).toBe(1);
    expect(agents[0].key).toBe('researcher');
  });

  test('gets available targets', () => {
    const targets = tools.getAvailableTargets('main-agent');
    expect(targets.length).toBe(1);
    expect(targets[0].key).toBe('researcher');
  });

  test('generates agents markdown', () => {
    const md = tools.generateAgentsMd('main-agent');
    expect(md).toContain('Research Agent');
    expect(md).toContain('researcher');
  });

  test('searches agents', () => {
    const results = tools.searchAgents('research');
    expect(results.length).toBe(1);
  });

  test('provides tool definitions', () => {
    const defs = tools.getToolDefinitions();
    expect(defs.length).toBe(4);
    expect(defs.map((d) => d.name)).toContain('delegate');
    expect(defs.map((d) => d.name)).toContain('delegate_search');
  });
});
