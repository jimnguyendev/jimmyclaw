import { describe, it, expect, beforeEach } from 'bun:test';
import { TaskContextStore } from './task-context-store.js';
import { TaskPlan } from './types.js';

describe('TaskContextStore', () => {
  let store: TaskContextStore;
  
  beforeEach(() => {
    store = new TaskContextStore();
  });
  
  const createMockPlan = (taskId: string): TaskPlan => ({
    taskId,
    goal: 'Test task',
    subtasks: [
      {
        id: 's1',
        role: 'researcher',
        description: 'Research something',
        deps: [],
        expectedOutput: 'Research findings'
      },
      {
        id: 's2',
        role: 'coder',
        description: 'Implement something',
        deps: ['s1'],
        expectedOutput: 'Code implementation'
      }
    ]
  });
  
  describe('create', () => {
    it('should create task context', () => {
      const plan = createMockPlan('task-1');
      const context = store.create('task-1', plan);
      
      expect(context).toBeDefined();
      expect(context.taskId).toBe('task-1');
      expect(context.plan.subtasks).toHaveLength(2);
      expect(context.completedSubtasks.size).toBe(0);
      expect(context.artifacts.size).toBe(0);
    });
  });
  
  describe('get', () => {
    it('should return existing context', () => {
      const plan = createMockPlan('task-1');
      store.create('task-1', plan);
      
      const context = store.get('task-1');
      
      expect(context).toBeDefined();
      expect(context?.taskId).toBe('task-1');
    });
    
    it('should return undefined for non-existent context', () => {
      const context = store.get('task-2');
      
      expect(context).toBeUndefined();
    });
  });
  
  describe('recordResult', () => {
    it('should record subtask result', () => {
      const plan = createMockPlan('task-1');
      store.create('task-1', plan);
      
      store.recordResult('task-1', 's1', 'Research completed');
      
      const context = store.get('task-1');
      expect(context?.completedSubtasks.get('s1')).toBe('Research completed');
    });
  });
  
  describe('recordArtifact', () => {
    it('should record artifact', () => {
      const plan = createMockPlan('task-1');
      store.create('task-1', plan);
      
      store.recordArtifact('task-1', 'doc.md', 'Documentation for API');
      
      const context = store.get('task-1');
      expect(context?.artifacts.get('doc.md')).toBe('Documentation for API');
    });
  });
  
  describe('getReadySubtasks', () => {
    it('should return subtasks with no dependencies', () => {
      const plan = createMockPlan('task-1');
      store.create('task-1', plan);
      
      const ready = store.getReadySubtasks('task-1');
      
      expect(ready).toHaveLength(1);
      expect(ready[0].id).toBe('s1');
    });
    
    it('should return subtasks whose dependencies are complete', () => {
      const plan = createMockPlan('task-1');
      store.create('task-1', plan);
      
      store.recordResult('task-1', 's1', 'Research done');
      
      const ready = store.getReadySubtasks('task-1');
      
      expect(ready).toHaveLength(1);
      expect(ready[0].id).toBe('s2');
    });
    
    it('should not return completed subtasks', () => {
      const plan = createMockPlan('task-1');
      store.create('task-1', plan);
      
      store.recordResult('task-1', 's1', 'Research done');
      store.recordResult('task-1', 's2', 'Code done');
      
      const ready = store.getReadySubtasks('task-1');
      
      expect(ready).toHaveLength(0);
    });
  });
  
  describe('isComplete', () => {
    it('should return false when no subtasks completed', () => {
      const plan = createMockPlan('task-1');
      store.create('task-1', plan);
      
      expect(store.isComplete('task-1')).toBe(false);
    });
    
    it('should return false when some subtasks completed', () => {
      const plan = createMockPlan('task-1');
      store.create('task-1', plan);
      
      store.recordResult('task-1', 's1', 'Research done');
      
      expect(store.isComplete('task-1')).toBe(false);
    });
    
    it('should return true when all subtasks completed', () => {
      const plan = createMockPlan('task-1');
      store.create('task-1', plan);
      
      store.recordResult('task-1', 's1', 'Research done');
      store.recordResult('task-1', 's2', 'Code done');
      
      expect(store.isComplete('task-1')).toBe(true);
    });
  });
  
  describe('getCompletedResults', () => {
    it('should return map of completed results', () => {
      const plan = createMockPlan('task-1');
      store.create('task-1', plan);
      
      store.recordResult('task-1', 's1', 'Result 1');
      store.recordResult('task-1', 's2', 'Result 2');
      
      const results = store.getCompletedResults('task-1');
      
      expect(results.size).toBe(2);
      expect(results.get('s1')).toBe('Result 1');
      expect(results.get('s2')).toBe('Result 2');
    });
    
    it('should return empty map for non-existent task', () => {
      const results = store.getCompletedResults('task-2');
      
      expect(results.size).toBe(0);
    });
  });
  
  describe('cleanup', () => {
    it('should remove context', () => {
      const plan = createMockPlan('task-1');
      store.create('task-1', plan);
      
      store.cleanup('task-1');
      
      expect(store.get('task-1')).toBeUndefined();
    });
  });
  
  describe('cleanupAll', () => {
    it('should remove all contexts', () => {
      store.create('task-1', createMockPlan('task-1'));
      store.create('task-2', createMockPlan('task-2'));
      
      store.cleanupAll();
      
      expect(store.get('task-1')).toBeUndefined();
      expect(store.get('task-2')).toBeUndefined();
    });
  });
});
