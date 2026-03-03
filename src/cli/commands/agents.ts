import chalk from 'chalk';
import Table from 'cli-table3';
import { client } from '../shared/api-client.js';
import { formatDuration, formatCost } from '../shared/formatter.js';

export async function agentsCmd(options: { json?: boolean }) {
  const isJson = options.json || false;

  if (!client.isDaemonRunning()) {
    console.log(chalk.red('● Daemon không chạy'));
    console.log(chalk.gray('  Run `nanoclaw start` để start daemon'));
    process.exit(1);
  }

  try {
    const agents = await client.get('/agents') as Array<{
      id: string;
      role: string;
      model: string;
      status: string;
      totalTasks?: number;
      successCount?: number;
    }>;

    if (isJson) {
      console.log(JSON.stringify(agents, null, 2));
      return;
    }

    if (agents.length === 0) {
      console.log(chalk.yellow('No agents configured'));
      return;
    }

    const table = new Table({
    head: ['ID', 'Role', 'Model', 'Status', 'Tasks'],
      colWidths: [12, 15, 20, 10, 10],
    });

    for (const agent of agents) {
      const statusIcon = agent.status === 'idle' ? chalk.green('●') :
                      agent.status === 'busy' ? chalk.yellow('●') : chalk.red('○');
      const taskInfo = agent.totalTasks ? `${agent.successCount}/${agent.totalTasks}` : '-';
      table.push([
        chalk.cyan(agent.id),
        chalk.gray(agent.role),
        chalk.white(agent.model),
        statusIcon,
        taskInfo,
      ]);
    }

    console.log(table.toString());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(chalk.red(`Error: ${message}`));
    process.exit(1);
  }
}
