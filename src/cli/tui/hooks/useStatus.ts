import { useApi } from './useApi.js';

interface SystemStatus {
  uptime: number;
  version: string;
  agentsTotal: number;
  agentsActive: number;
  tasksPending: number;
  tasksProcessing: number;
  memoryUsage?: string;
}

export function useStatus() {
  return useApi<SystemStatus>('/status', 3000);
}

export type { SystemStatus };
