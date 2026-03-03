import { Box, Text } from 'ink';
import { useTasks, type TaskInfo } from '../hooks/useTasks.js';

function StatusBadge({ status }: { status: TaskInfo['status'] }) {
  const labels: Record<TaskInfo['status'], string> = {
    pending: '⏳',
    processing: '⚡',
    completed: '✓',
    failed: '✗',
  };
  return <Text>{labels[status]}</Text>;
}

export function TasksPanel() {
  const { data: tasks, loading, error } = useTasks();

  if (error) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text bold color="cyan">Tasks</Text>
        <Text color="red">Error: {error}</Text>
      </Box>
    );
  }

  if (loading || !tasks) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text bold color="cyan">Tasks</Text>
        <Text dimColor>Loading...</Text>
      </Box>
    );
  }

  const pending = tasks.filter(t => t.status === 'pending' || t.status === 'processing');
  const display = pending.slice(0, 5);

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="cyan">Tasks ({pending.length} active)</Text>
      {display.length === 0 ? (
        <Text dimColor>No active tasks</Text>
      ) : (
        display.map(task => (
          <Box key={task.id}>
            <StatusBadge status={task.status} />
            <Text> {task.id.slice(0, 8)}</Text>
            {task.assignedTo && <Text dimColor> → {task.assignedTo}</Text>}
          </Box>
        ))
      )}
      {pending.length > 5 && (
        <Text dimColor>  +{pending.length - 5} more...</Text>
      )}
    </Box>
  );
}
