import { Box, Text } from 'ink';
import { useStatus, type SystemStatus } from '../hooks/useStatus.js';

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

export function SystemPanel() {
  const { data: status, loading, error } = useStatus();

  if (error) {
    return (
      <Box flexDirection="column">
        <Text bold color="cyan">System</Text>
        <Text color="red">Error: {error}</Text>
      </Box>
    );
  }

  if (loading || !status) {
    return (
      <Box flexDirection="column">
        <Text bold color="cyan">System</Text>
        <Text dimColor>Loading...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">System</Text>
      <Box>
        <Text dimColor>Uptime: </Text>
        <Text>{formatUptime(status.uptime)}</Text>
        <Text dimColor> | v{status.version}</Text>
      </Box>
      <Box>
        <Text dimColor>Agents: </Text>
        <Text color="green">{status.agentsActive}</Text>
        <Text dimColor>/{status.agentsTotal} active</Text>
      </Box>
      <Box>
        <Text dimColor>Tasks: </Text>
        <Text color="yellow">{status.tasksPending}</Text>
        <Text dimColor> pending, </Text>
        <Text color="blue">{status.tasksProcessing}</Text>
        <Text dimColor> processing</Text>
      </Box>
      {status.memoryUsage && (
        <Box>
          <Text dimColor>Memory: </Text>
          <Text>{status.memoryUsage}</Text>
        </Box>
      )}
    </Box>
  );
}
