import chalk from 'chalk';
import { client } from '../shared/api-client.js';
import { input, select, confirm } from '@inquirer/prompts';

export async function channelCmd(options: { json?: boolean }) {
  const isJson = options.json || false;

  if (!client.isDaemonRunning()) {
    console.log(chalk.red('● Daemon không chạy'));
    process.exit(1);
  }

  try {
    const channel = await client.get('/channel') as {
      platform?: string;
      channelId?: string;
      enabled?: boolean;
    };

    if (isJson) {
      console.log(JSON.stringify(channel, null, 1));
      return;
    }

    if (!channel.platform) {
      console.log(chalk.yellow('Channel not configured'));
      console.log(chalk.gray('  Run `nanoclaw channel set <platform> <channelId>` to configure'));
      return;
    }

    console.log(chalk.cyan('Team Channel:'));
    console.log(chalk.white(`  Platform: ${channel.platform}`));
    console.log(chalk.white(`  Channel ID: ${channel.channelId}`));
    console.log(chalk.white(`  Enabled: ${channel.enabled ? 'Yes' : 'No'}`));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(chalk.red(`Error: ${message}`));
    process.exit(1);
  }
}

export async function channelSetCmd(platform: string, channelId: string) {
  if (!client.isDaemonRunning()) {
    console.log(chalk.red('● Daemon không chạy'));
    process.exit(1);
  }

  const validPlatform = await select({
    message: 'Platform:',
    choices: [
      { name: 'Discord', value: 'discord' },
      { name: 'Telegram', value: 'telegram' },
    ],
  });

  if (!platform) platform = validPlatform;

  const shouldEnable = await confirm({
    message: 'Enable channel?',
    default: true,
  });

  try {
    await client.put('/channel', {
      platform: platform || validPlatform,
      channelId,
      enabled: shouldEnable,
    });
    console.log(chalk.green(`✓ Channel configured: ${platform || validPlatform} (${channelId})`));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(chalk.red(`Error: ${message}`));
    process.exit(1);
  }
}

export async function channelTestCmd() {
  if (!client.isDaemonRunning()) {
    console.log(chalk.red('● Daemon không chạy'));
    process.exit(1);
  }

  try {
    console.log(chalk.cyan('Testing channel connection...'));
    const channel = await client.get('/channel') as { platform?: string; channelId?: string };
    if (!channel.platform || !channel.channelId) {
      console.log(chalk.yellow('Channel not configured'));
      return;
    }
    console.log(chalk.green('✓ Channel configuration valid'));
    console.log(chalk.gray(`  Platform: ${channel.platform}`));
    console.log(chalk.gray(`  Channel ID: ${channel.channelId}`));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(chalk.red(`Error: ${message}`));
    process.exit(1);
  }
}
