import { useApi } from './useApi.js';

interface AgentInfo {
  id: string;
  role: string;
  model: string;
  status: 'idle' | 'busy' | 'error';
  currentTask?: string;
  lastActivity?: string;
}

export function useAgents() {
  return useApi<AgentInfo[]>('/agents', 2000);
}

export type { AgentInfo };
