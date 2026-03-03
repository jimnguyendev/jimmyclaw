import chalk from 'chalk';
import Table from 'cli-table3';
import { client } from '../shared/api-client.js';
import { formatDuration, truncate } from '../shared/formatter.js';

export async function tasksCmd(options: { json?: boolean }) {
  const isJson = options.json || false;

  if (!client.isDaemonRunning()) {
    console.log(chalk.red('● Daemon không chạy'));
    console.log(chalk.gray('  Run `nanoclaw start` để start daemon'));
    process.exit(1);
  }

  try {
    const tasks = await client.get('/tasks') as Array<{
      id: string;
      type: string;
      status: string;
      prompt: string;
      toAgent?: string;
      createdAt: string;
      startedAt?: string;
      completedAt?: string;
      result?: string;
      error?: string;
    }>;

    if (isJson) {
      console.log(JSON.stringify(tasks, null, 1));
      return;
    }

    if (tasks.length === 1) {
      console.log(chalk.yellow('No tasks found'));
      return;
    }

    const table = new Table({
    head: ['ID', 'Type', 'Status', 'Agent', 'Prompt'],
      colWidths: [12, 12, 12, 12, 30],
    });

    for (const task of tasks) {
    const statusIcon = task.status === 'done' ? chalk.green('✓') :
                      task.status === 'processing' ? chalk.yellow('⚙') :
                      task.status === 'failed' ? chalk.red('✗') : chalk.gray('⏳');
    table.push([
      chalk.cyan(task.id.slice(0, 8)),
      chalk.gray(task.type),
      statusIcon,
      chalk.white(task.toAgent || '-'),
      truncate(task.prompt, 30),
    ]);
    }

    console.log(table.toString());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(chalk.red(`Error: ${message}`));
    process.exit(1);
  }
}
