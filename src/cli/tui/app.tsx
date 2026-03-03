import { useState } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import { AgentsPanel } from './panels/AgentsPanel.js';
import { TasksPanel } from './panels/TasksPanel.js';
import { ActivityPanel } from './panels/ActivityPanel.js';
import { SystemPanel } from './panels/SystemPanel.js';
import { client } from './hooks/useApi.js';
import { input as promptInput, select, confirm } from '@inquirer/prompts';
import { getAvailableModels, getAvailableRoles } from '../../swarm-config.js';

function Header() {
  return (
    <Box borderStyle="single" borderColor="cyan" paddingX={1}>
      <Text bold color="cyan">NanoClaw Dashboard</Text>
      <Text dimColor> | Press </Text>
      <Text color="green">a</Text>
      <Text dimColor> add agent | </Text>
      <Text color="red">q</Text>
      <Text dimColor> quit</Text>
    </Box>
  );
}

function StatusBar() {
  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1}>
      <Text dimColor>Connected via Unix socket</Text>
    </Box>
  );
}

function App() {
  const { exit } = useApp();
  const [message, setMessage] = useState<string | null>(null);

  useInput(async (input) => {
    if (input === 'q') {
      exit();
    }

    if (input === 'a') {
      try {
        const agentId = await promptInput({
          message: 'Agent ID:',
          validate: (v: string) => v.length >= 2 && /^[a-z0-9_-]+$/.test(v) || 'Only lowercase letters, numbers, hyphens, underscores',
        });

        const agentRole = await select({
          message: 'Role:',
          choices: getAvailableRoles().map(r => ({ name: r, value: r })),
        });

        const models = getAvailableModels();
        const agentModel = await select({
          message: 'Model:',
          choices: models.map(m => ({ name: m, value: m })),
        });

        await client.post('/agents', { id: agentId, role: agentRole, model: agentModel });
        setMessage(`Added agent "${agentId}"`);

        setTimeout(() => setMessage(null), 3000);
      } catch (err) {
        setMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
        setTimeout(() => setMessage(null), 3000);
      }
    }
  });

  return (
    <Box flexDirection="column" minHeight={20}>
      <Header />
      <Box flexGrow={1} flexDirection="row">
        <Box flexDirection="column" width="30%" borderRight paddingX={1}>
          <AgentsPanel />
          <TasksPanel />
        </Box>
        <Box flexDirection="column" flexGrow={1} paddingX={1}>
          <ActivityPanel />
          <SystemPanel />
        </Box>
      </Box>
      {message && (
        <Box paddingX={1}>
          <Text color="green">{message}</Text>
        </Box>
      )}
      <StatusBar />
    </Box>
  );
}

export function openTui() {
  const { unmount } = render(<App />);
  
  process.on('exit', () => {
    unmount();
  });
}
