import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { LLMProviderService } from './llm-provider.js';
import { resolveModel, calculateCost, AVAILABLE_MODELS, DEFAULT_FREE_MODEL } from './llm-types.js';

mock.module('../logger.js', () => ({
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
}));

describe('LLM Types', () => {
  describe('resolveModel', () => {
    it('should resolve model aliases', () => {
      expect(resolveModel('glm-5')).toEqual({
        provider: 'opencode',
        modelName: 'zai-coding-plan/glm-5',
      });

      expect(resolveModel('glm-4.7-flash')).toEqual({
        provider: 'opencode',
        modelName: 'zai-coding-plan/glm-4.7-flash',
      });
    });

    it('should resolve full model paths', () => {
      expect(resolveModel('zai-coding-plan/glm-5')).toEqual({
        provider: 'opencode',
        modelName: 'zai-coding-plan/glm-5',
      });

      expect(resolveModel('opencode/big-pickle')).toEqual({
        provider: 'opencode',
        modelName: 'opencode/big-pickle',
      });
    });

    it('should default to opencode for unknown models', () => {
      expect(resolveModel('unknown-model')).toEqual({
        provider: 'opencode',
        modelName: 'zai-coding-plan/unknown-model',
      });
    });
  });

  describe('calculateCost', () => {
    it('should calculate cost for free models', () => {
      const cost = calculateCost('glm-4.7-flash', 1000, 500);
      expect(cost).toBe(0);
    });

    it('should calculate cost for paid models', () => {
      const cost = calculateCost('claude-sonnet', 1000, 500);
      expect(cost).toBe(3 * 1 + 15 * 0.5);
    });

    it('should use default pricing for unknown models', () => {
      const cost = calculateCost('unknown-model', 1000, 500);
      expect(cost).toBe(0);
    });
  });

  describe('AVAILABLE_MODELS', () => {
    it('should have free models available', () => {
      expect(AVAILABLE_MODELS['glm-4.7-flash'].free).toBe(true);
      expect(AVAILABLE_MODELS['glm-5'].free).toBe(true);
      expect(AVAILABLE_MODELS['big-pickle'].free).toBe(true);
    });

    it('should have paid models marked', () => {
      expect(AVAILABLE_MODELS['claude-sonnet'].free).toBe(false);
      expect(AVAILABLE_MODELS['claude-haiku'].free).toBe(false);
    });
  });
});

describe('LLMProviderService', () => {
  let provider: LLMProviderService;

  beforeEach(() => {
    provider = new LLMProviderService();
  });

  describe('generate', () => {
    it('should resolve unknown models to opencode provider', async () => {
      const result = await provider.generate({ model: 'unknown-model-xyz', provider: 'opencode' }, 'Say OK');
      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
    });
  });

  describe('generateWithFallback', () => {
    it.skip('should try models in order', async () => {
      const result = await provider.generateWithFallback(
        ['glm-4.7-flash', 'glm-4.5-flash'],
        'Hello',
        'You are a helpful assistant.',
      );

      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      expect(result.provider).toBeDefined();
    });
  });
});
