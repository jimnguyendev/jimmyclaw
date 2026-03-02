export type LLMProvider = 'opencode' | 'google' | 'groq' | 'anthropic' | 'openai' | 'ollama';

export interface LLMConfig {
  provider: LLMProvider;
  model: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface PartialLLMConfig {
  provider?: LLMProvider;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface LLMResponse {
  content: string;
  tokensUsed?: {
    input: number;
    output: number;
    total: number;
  };
  cost?: number;
  model: string;
  provider: LLMProvider;
  finishReason?: 'stop' | 'length' | 'error';
}

export interface LLMStreamChunk {
  content: string;
  done: boolean;
  tokensUsed?: number;
}

export interface ModelPricing {
  inputPer1k: number;
  outputPer1k: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'glm-4.5': { inputPer1k: 0, outputPer1k: 0 },
  'glm-4.5-air': { inputPer1k: 0, outputPer1k: 0 },
  'glm-4.5-flash': { inputPer1k: 0, outputPer1k: 0 },
  'glm-4.7': { inputPer1k: 0, outputPer1k: 0 },
  'glm-4.7-flash': { inputPer1k: 0, outputPer1k: 0 },
  'glm-5': { inputPer1k: 0, outputPer1k: 0 },
  'big-pickle': { inputPer1k: 0, outputPer1k: 0 },
  'zai-coding-plan/glm-4.5': { inputPer1k: 0, outputPer1k: 0 },
  'zai-coding-plan/glm-4.5-air': { inputPer1k: 0, outputPer1k: 0 },
  'zai-coding-plan/glm-4.5-flash': { inputPer1k: 0, outputPer1k: 0 },
  'zai-coding-plan/glm-4.7': { inputPer1k: 0, outputPer1k: 0 },
  'zai-coding-plan/glm-4.7-flash': { inputPer1k: 0, outputPer1k: 0 },
  'zai-coding-plan/glm-5': { inputPer1k: 0, outputPer1k: 0 },
  'opencode/big-pickle': { inputPer1k: 0, outputPer1k: 0 },
  'gemini-2.0-flash': { inputPer1k: 0, outputPer1k: 0 },
  'gemini-1.5-flash': { inputPer1k: 0, outputPer1k: 0 },
  'groq-llama-3.3': { inputPer1k: 0, outputPer1k: 0 },
  'claude-sonnet': { inputPer1k: 3, outputPer1k: 15 },
  'claude-haiku': { inputPer1k: 0.25, outputPer1k: 1.25 },
  'claude-opus': { inputPer1k: 15, outputPer1k: 75 },
};

export const AVAILABLE_MODELS: Record<string, { provider: LLMProvider; name: string; free: boolean }> = {
  'glm-5': { provider: 'opencode', name: 'zai-coding-plan/glm-5', free: true },
  'glm-4.7': { provider: 'opencode', name: 'zai-coding-plan/glm-4.7', free: true },
  'glm-4.7-flash': { provider: 'opencode', name: 'zai-coding-plan/glm-4.7-flash', free: true },
  'glm-4.5': { provider: 'opencode', name: 'zai-coding-plan/glm-4.5', free: true },
  'glm-4.5-flash': { provider: 'opencode', name: 'zai-coding-plan/glm-4.5-flash', free: true },
  'big-pickle': { provider: 'opencode', name: 'opencode/big-pickle', free: true },
  'minimax-free': { provider: 'opencode', name: 'opencode/minimax-m2.5-free', free: true },
  'trinity-free': { provider: 'opencode', name: 'opencode/trinity-large-preview-free', free: true },
  'gemini-2.0-flash': { provider: 'google', name: 'gemini-2.0-flash-exp', free: true },
  'gemini-1.5-flash': { provider: 'google', name: 'gemini-1.5-flash', free: true },
  'claude-sonnet': { provider: 'anthropic', name: 'claude-sonnet-4-20250514', free: false },
  'claude-haiku': { provider: 'anthropic', name: 'claude-3-5-haiku-20241022', free: false },
};

export function resolveModel(modelAlias: string): { provider: LLMProvider; modelName: string } | null {
  if (modelAlias.includes('/')) {
    return { provider: 'opencode', modelName: modelAlias };
  }

  const model = AVAILABLE_MODELS[modelAlias.toLowerCase()];
  if (model) {
    return { provider: model.provider, modelName: model.name };
  }

  return { provider: 'opencode', modelName: `zai-coding-plan/${modelAlias}` };
}

export function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) {
    return 0;
  }
  const inputCost = (inputTokens / 1000) * pricing.inputPer1k;
  const outputCost = (outputTokens / 1000) * pricing.outputPer1k;
  return inputCost + outputCost;
}

export const DEFAULT_FREE_MODEL = 'glm-4.7-flash';
export const DEFAULT_PAID_MODEL = 'claude-sonnet';
