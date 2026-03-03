import { Box, Text } from 'ink';
import { useAgents, type AgentInfo } from '../hooks/useAgents.js';

function StatusDot({ status }: { status: AgentInfo['status'] }) {
  const colors: Record<AgentInfo['status'], string> = {
    idle: 'yellow',
    busy: 'green',
    error: 'red',
  };
  return <Text color={colors[status]}>●</Text>;
}

export function AgentsPanel() {
  const { data: agents, loading, error } = useAgents();

  if (error) {
    return (
      <Box flexDirection="column">
        <Text bold color="cyan">Agents</Text>
        <Text color="red">Error: {error}</Text>
      </Box>
    );
  }

  if (loading || !agents) {
    return (
      <Box flexDirection="column">
        <Text bold color="cyan">Agents</Text>
        <Text dimColor>Loading...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">Agents ({agents.length})</Text>
      {agents.length === 0 ? (
        <Text dimColor>No agents</Text>
      ) : (
        agents.map(agent => (
          <Box key={agent.id}>
            <StatusDot status={agent.status} />
            <Text> {agent.id} </Text>
            <Text dimColor>({agent.role})</Text>
          </Box>
        ))
      )}
    </Box>
  );
}
