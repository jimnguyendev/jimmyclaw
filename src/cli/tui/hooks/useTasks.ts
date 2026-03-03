import { useApi } from './useApi.js';

interface TaskInfo {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  assignedTo?: string;
  createdAt: string;
  message: string;
}

export function useTasks() {
  return useApi<TaskInfo[]>('/tasks', 2000);
}

export type { TaskInfo };
