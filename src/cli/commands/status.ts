import chalk from 'chalk';
import Table from 'cli-table3';
import { client } from '../shared/api-client.js';
import { formatDuration, formatCost, formatBytes } from '../shared/formatter.js';

export async function statusCmd(options: { json?: boolean }) {
  const isJson = options.json || false;

  if (!client.isDaemonRunning()) {
    console.log(chalk.red('● Daemon không chạy'));
    console.log(chalk.gray('  Run `nanoclaw start` để start daemon'));
    process.exit(1);
  }

  try {
    const status = await client.get('/status') as {
      status: string;
      uptime: number;
      startTime: number;
      memory: { used: number; total: number };
      platform: string;
      tasksToday: number;
      successCount: number;
      failedCount: number;
      costToday: number;
      agents: number;
      pendingTasks: number;
      processingTasks: number;
    };

    if (isJson) {
      console.log(JSON.stringify(status, null, 2));
      return;
    }

    console.log(chalk.green('● NanoClaw running'));
    console.log(chalk.cyan(`  Uptime: ${formatDuration(status.uptime * 1000)}`));
    console.log(chalk.cyan(`  Memory: ${formatBytes(status.memory.used)} / ${formatBytes(status.memory.total)}`));
    console.log(chalk.cyan(`  Platform: ${status.platform}`));
    console.log(chalk.cyan(`  Agents: ${status.agents}`));
    console.log(chalk.cyan(`  Tasks: ${status.pendingTasks} pending, ${status.processingTasks} processing`));
    console.log(chalk.cyan(`  Cost today: ${formatCost(status.costToday)}`));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(chalk.red(`Error: ${message}`));
    process.exit(1);
  }
}
