import { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { client } from '../hooks/useApi.js';

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  agentId?: string;
}

export function ActivityPanel() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const result = await client.get('/logs?lines=10') as { logs: LogEntry[] };
        setLogs(result.logs || []);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    };

    fetchLogs();
    const iv = setInterval(fetchLogs, 2000);
    return () => clearInterval(iv);
  }, []);

  if (error) {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <Text bold color="cyan">Activity</Text>
        <Text color="red">Error: {error}</Text>
      </Box>
    );
  }

  const displayLogs = logs.slice(0, 8);

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text bold color="cyan">Activity</Text>
      {displayLogs.length === 0 ? (
        <Text dimColor>No recent activity</Text>
      ) : (
        displayLogs.map((log, i) => (
          <Box key={i}>
            <Text dimColor>{log.timestamp.slice(11, 19)} </Text>
            <Text color={log.level === 'error' ? 'red' : log.level === 'warn' ? 'yellow' : 'white'}>
              {log.message.slice(0, 50)}
            </Text>
          </Box>
        ))
      )}
    </Box>
  );
}
