/**
 * Types for Delegation History
 */

export type DelegationHistoryStatus = 'completed' | 'failed' | 'cancelled';

export interface DelegationHistoryRecord {
  id: string;
  sourceAgent: string;
  targetAgent: string;
  userId: string;
  task: string;
  mode: string;
  status: DelegationHistoryStatus;
  result?: string;
  error?: string;
  iterations: number;
  durationMs: number;
  createdAt: Date;
  completedAt?: Date;
}

export interface DelegationHistoryFilter {
  sourceAgent?: string;
  targetAgent?: string;
  userId?: string;
  status?: DelegationHistoryStatus;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

export interface DelegationHistoryStats {
  total: number;
  completed: number;
  failed: number;
  cancelled: number;
  avgDurationMs: number;
  avgIterations: number;
}
