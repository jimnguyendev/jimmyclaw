import { describe, it, expect, beforeEach } from 'bun:test';
import { ProgressReporter } from './progress-reporter.js';

describe('ProgressReporter', () => {
  let reporter: ProgressReporter;
  
  beforeEach(() => {
    reporter = new ProgressReporter();
  });
  
  describe('report', () => {
    it('should report progress without throttling on first call', async () => {
      await reporter.report('sarah', 'task-1', 'thinking');
    });
    
    it('should throttle status updates within 3 seconds', async () => {
      const startTime = Date.now();
      
      await reporter.report('sarah', 'task-1', 'thinking');
      await reporter.report('sarah', 'task-1', 'working', 'doing something');
      
      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeLessThan(100);
    });
    
    it('should always report done status regardless of throttle', async () => {
      await reporter.report('sarah', 'task-1', 'thinking');
      
      await reporter.report('sarah', 'task-1', 'done');
      
      const allReports = reporter as any;
      expect(allReports.lastReport.has('sarah')).toBe(false);
    });
    
    it('should throttle status but not done', async () => {
      await reporter.report('sarah', 'task-1', 'thinking');
      
      await new Promise(resolve => setTimeout(resolve, 3100));
      
      await reporter.report('sarah', 'task-1', 'working');
      await reporter.report('sarah', 'task-1', 'working', 'still working');
    });
  });
  
  describe('reset', () => {
    it('should reset throttle for specific agent', async () => {
      await reporter.report('sarah', 'task-1', 'thinking');
      
      reporter.reset('sarah');
      
      const allReports = reporter as any;
      expect(allReports.lastReport.has('sarah')).toBe(false);
    });
  });
  
  describe('resetAll', () => {
    it('should reset all throttles', async () => {
      await reporter.report('sarah', 'task-1', 'thinking');
      await reporter.report('mike', 'task-2', 'thinking');
      
      reporter.resetAll();
      
      const allReports = reporter as any;
      expect(allReports.lastReport.size).toBe(0);
    });
  });
});
