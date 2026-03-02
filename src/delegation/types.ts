/**
 * Types for Agent Delegation System
 */

export type DelegationMode = 'sync' | 'async';

export type DelegationStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface AgentLink {
  sourceAgent: string;
  targetAgent: string;
  direction: 'outbound' | 'inbound' | 'bidirectional';
  maxConcurrent: number;
  settings?: LinkSettings;
}

export interface LinkSettings {
  requireRole?: string;
  userAllow?: string[];
  userDeny?: string[];
}

export interface DelegationTask {
  id: string;
  sourceAgent: string;
  targetAgent: string;
  userId: string;
  task: string;
  context?: string;
  status: DelegationStatus;
  mode: DelegationMode;
  sessionKey: string;
  createdAt: Date;
  completedAt?: Date;
  result?: string;
  error?: string;
  iterations: number;
}

export interface DelegateOpts {
  targetAgent: string;
  task: string;
  context?: string;
  mode?: DelegationMode;
}

export interface DelegateResult {
  success: boolean;
  content?: string;
  error?: string;
  delegationId: string;
  iterations: number;
}

export interface AgentInfo {
  key: string;
  name: string;
  description?: string;
  model?: string;
  tools?: string[];
}

export type AgentRunFunc = (
  agentKey: string,
  message: string,
  context: DelegationContext
) => Promise<{ content: string; iterations: number }>;

export interface DelegationContext {
  userId: string;
  sessionId: string;
  channel?: string;
  chatId?: string;
  extraSystemPrompt?: string;
}

export interface DelegationEvent {
  type: 'started' | 'completed' | 'failed' | 'cancelled';
  task: DelegationTask;
  timestamp: Date;
}
