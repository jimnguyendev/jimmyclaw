export type ModelType = 'haiku' | 'sonnet' | 'opus' | 'inherit';

export interface SubAgentConfig {
  model: ModelType;
  description: string;
  prompt?: string;
  tools?: string[];
}

export interface AgentConfig {
  defaultModel?: ModelType;
  subAgents?: Record<string, SubAgentConfig>;
}

export interface AgentDefinition {
  description: string;
  model: ModelType;
  prompt: string;
  tools?: string[];
}
