/**
 * Types for Quality Gates and Evaluate Loop
 */

export type GateType = 'command' | 'agent';
export type GateEvent = 'output.ready' | 'delegation.completed';

export interface QualityGate {
  event: GateEvent;
  type: GateType;
  agent?: string;
  command?: string;
  blockOnFailure: boolean;
  maxRetries: number;
}

export interface GateResult {
  passed: boolean;
  feedback?: string;
  error?: string;
}

export interface HookContext {
  event: GateEvent;
  sourceAgentKey?: string;
  targetAgentKey?: string;
  userId: string;
  content: string;
  task?: string;
}

export interface EvaluateLoopConfig {
  generator: string;
  evaluator: string;
  task: string;
  passCriteria: string;
  maxRounds: number;
  context?: string;
}

export interface EvaluateLoopResult {
  approved: boolean;
  content: string;
  rounds: number;
  feedback?: string;
}

export type AgentEvalFunc = (
  agentKey: string,
  prompt: string
) => Promise<{ content: string }>;

export type CommandEvalFunc = (command: string, input: string) => Promise<{ exitCode: number; output: string }>;
