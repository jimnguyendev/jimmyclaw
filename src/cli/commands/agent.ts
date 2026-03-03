import chalk from 'chalk';
import Table from 'cli-table3';
import { client } from '../shared/api-client.js';
import { formatDuration, truncate } from '../shared/formatter.js';

import { input, select, confirm } from '@inquirer/prompts';

import { getAvailableModels, getAvailableRoles } from '../../swarm-config.js';

export async function agentAddCmd(id?: string, role?: string, model?: string, options?: { json?: boolean }) {
  let agentId = id;
  let agentRole = role;
  let agentModel = model;

  if (!agentId) {
    agentId = await input({
      message: 'Agent ID (name):',
      validate: (value) => {
        if (value.length < 2) return 'Must be at least 2 characters';
        if (!/^[a-z0-9_-]+$/.test(value)) return 'Only lowercase letters, numbers, hyphens, underscores';
        return true;
      },
    });
  }

  if (!agentRole) {
    agentRole = await select({
      message: 'Role:',
      choices: getAvailableRoles().map(r => ({ name: r, value: r })),
    });
  }

  if (!agentModel) {
    const models = getAvailableModels();
    agentModel = await select({
      message: 'Model:',
      choices: models.map(m => ({ name: m, value: m })),
    });
  }

  if (!client.isDaemonRunning()) {
    console.log(chalk.red('● Daemon không chạy'));
    process.exit(1);
  }

  try {
    await client.post('/agents', {
      id: agentId,
      role: agentRole,
      model: agentModel,
    });
    console.log(chalk.green(`✓ Agent "${agentId}" đã thêm thành công`));

    const shouldReload = await confirm({
      message: 'Reload config? (Recommended)',
      default: true,
    });
    if (shouldReload) {
      await client.post('/config/reload', {});
      console.log(chalk.green('✓ Config reloaded'));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(chalk.red(`Error: ${message}`));
    process.exit(1);
  }
}

export async function agentRemoveCmd(id: string) {
  if (!client.isDaemonRunning()) {
    console.log(chalk.red('● Daemon không chạy'));
    process.exit(1);
  }

  const shouldRemove = await confirm({
    message: `Remove agent "${id}"?`,
    default: false,
  });

  if (!shouldRemove) {
    console.log(chalk.gray('Cancelled'));
    return;
  }

  try {
    await client.delete(`/agents/${id}`);
    console.log(chalk.green(`✓ Agent "${id}" đã xóa thành công`));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(chalk.red(`Error: ${message}`));
    process.exit(1);
  }
}

export async function agentRenameCmd(oldId: string, newId: string) {
  if (!client.isDaemonRunning()) {
    console.log(chalk.red('● Daemon không chạy'));
    process.exit(1);
  }

  try {
    await client.post(`/agents/${oldId}/rename`, { newId });
    console.log(chalk.green(`✓ Agent renamed: ${oldId} → ${newId}`));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(chalk.red(`Error: ${message}`));
    process.exit(1);
  }
}

export async function agentModelCmd(id: string, model: string) {
  if (!client.isDaemonRunning()) {
    console.log(chalk.red('● Daemon không chạy'));
    process.exit(1);
  }

  try {
    await client.put(`/agents/${id}`, { model });
    console.log(chalk.green(`✓ Agent "${id}" model updated to ${model}`));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(chalk.red(`Error: ${message}`));
    process.exit(1);
  }
}

export async function agentPromptCmd(id: string) {
  if (!client.isDaemonRunning()) {
    console.log(chalk.red('● Daemon không chạy'));
    process.exit(1);
  }

  try {
    // Lấy system prompt hiện tại
    const agents = await client.get('/agents') as Array<{ id: string; systemPrompt?: string }>;
    const agent = agents.find(a => a.id === id);
    if (!agent) {
      console.log(chalk.red(`Agent "${id}" không tồn tại`));
      process.exit(1);
    }

    const currentPrompt = agent.systemPrompt || '';
    console.log(chalk.cyan(`System prompt hiện tại của "${id}":`));
    console.log(chalk.gray(currentPrompt || '(chưa có)'));
    console.log();

    const newPrompt = await input({
      message: 'Nhập system prompt mới (Enter để giữ nguyên):',
      default: currentPrompt,
    });

    if (newPrompt === currentPrompt) {
      console.log(chalk.gray('Không thay đổi'));
      return;
    }

    await client.put(`/agents/${id}`, { systemPrompt: newPrompt });
    console.log(chalk.green(`✓ System prompt của "${id}" đã cập nhật`));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(chalk.red(`Error: ${message}`));
    process.exit(1);
  }
}
