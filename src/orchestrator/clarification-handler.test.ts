import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ClarificationHandler } from './clarification-handler.js';

describe('ClarificationHandler', () => {
  let handler: ClarificationHandler;
  
  beforeEach(() => {
    handler = new ClarificationHandler();
  });
  
  afterEach(() => {
    handler.cleanup();
  });
  
  describe('ask', () => {
    it('should create pending clarification', async () => {
      const promise = handler.ask('task-1', 'subtask-1', 'sarah', 'Should I use JWT or sessions?', 100);
      
      expect(handler.getPendingCount('task-1')).toBe(1);
      
      handler.cancelAll('task-1');
    });
    
    it('should resolve on answer', async () => {
      const promise = handler.ask('task-1', 'subtask-1', 'sarah', 'Should I use JWT?', 100);
      
      handler.handleAnswer('task-1', 'Use JWT tokens');
      
      const answer = await promise;
      expect(answer).toBe('Use JWT tokens');
    });
    
    it('should timeout after specified time', async () => {
      const promise = handler.ask('task-1', 'subtask-1', 'sarah', 'Quick question?', 100);
      
      const answer = await promise;
      expect(answer).toBe('[no answer - proceeding with best guess]');
    });
    
    it('should cancel old clarification if new one asked', async () => {
      const oldPromise = handler.ask('task-1', 'subtask-1', 'sarah', 'Old question?', 100);
      const newPromise = handler.ask('task-1', 'subtask-1', 'sarah', 'New question?', 100);
      
      const oldAnswer = await oldPromise;
      expect(oldAnswer).toBe('[cancelled - new question asked]');
      
      expect(handler.getPendingCount('task-1')).toBe(1);
      
      handler.cancelAll('task-1');
    });
  });
  
  describe('handleAnswer', () => {
    it('should resolve pending clarification', async () => {
      const promise = handler.ask('task-1', 'subtask-1', 'sarah', 'Should I use JWT?', 100);
      
      const resolved = handler.handleAnswer('task-1', 'Use JWT');
      
      expect(resolved).toBe(true);
      
      const answer = await promise;
      expect(answer).toBe('Use JWT');
    });
    
    it('should return false if no pending clarification', () => {
      const resolved = handler.handleAnswer('task-1', 'Use JWT');
      
      expect(resolved).toBe(false);
    });
    
    it('should resolve specific subtask clarification', async () => {
      const promise1 = handler.ask('task-1', 'subtask-1', 'sarah', 'Question 1?', 100);
      const promise2 = handler.ask('task-1', 'subtask-2', 'sarah', 'Question 2?', 100);
      
      const resolved = handler.handleAnswerForSubtask('task-1', 'subtask-1', 'Answer 1');
      
      expect(resolved).toBe(true);
      
      const answer1 = await promise1;
      expect(answer1).toBe('Answer 1');
      
      handler.cancelAll('task-1');
    });
  });
  
  describe('cancelAll', () => {
    it('should cancel all pending clarifications for task', async () => {
      const promise1 = handler.ask('task-1', 'subtask-1', 'sarah', 'Question 1?', 100);
      const promise2 = handler.ask('task-1', 'subtask-2', 'sarah', 'Question 2?', 100);
      
      handler.cancelAll('task-1');
      
      expect(handler.getPendingCount('task-1')).toBe(0);
      
      const answer1 = await promise1;
      expect(answer1).toBe('[cancelled - task cancelled]');
      
      const answer2 = await promise2;
      expect(answer2).toBe('[cancelled - task cancelled]');
    });
  });
  
  describe('getPendingCount', () => {
    it('should return total pending count when no taskId', () => {
      handler.ask('task-1', 'subtask-1', 'sarah', 'Q1?', 100);
      handler.ask('task-2', 'subtask-1', 'sarah', 'Q2?', 100);
      handler.ask('task-3', 'subtask-1', 'sarah', 'Q3?', 100);
      
      expect(handler.getPendingCount()).toBe(3);
      
      handler.cleanup();
    });
    
    it('should return pending count for specific task', () => {
      handler.ask('task-1', 'subtask-1', 'sarah', 'Q1?', 100);
      handler.ask('task-2', 'subtask-1', 'sarah', 'Q2?', 100);
      
      expect(handler.getPendingCount('task-1')).toBe(1);
      expect(handler.getPendingCount('task-2')).toBe(1);
      expect(handler.getPendingCount('task-3')).toBe(0);
      
      handler.cleanup();
    });
  });
  
  describe('cleanup', () => {
    it('should cancel all pending clarifications', async () => {
      const promise1 = handler.ask('task-1', 'subtask-1', 'sarah', 'Q1?', 100);
      const promise2 = handler.ask('task-1', 'subtask-2', 'sarah', 'Q2?', 100);
      
      handler.cleanup();
      
      expect(handler.getPendingCount()).toBe(0);
      
      const answer1 = await promise1;
      expect(answer1).toBe('[cancelled - cleanup]');
      
      const answer2 = await promise2;
      expect(answer2).toBe('[cancelled - cleanup]');
    });
  });
});
