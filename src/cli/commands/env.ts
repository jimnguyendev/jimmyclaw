import chalk from 'chalk';
import { readEnvFile } from '../../env.js';
import { input, confirm } from '@inquirer/prompts';

export async function envCmd() {
  console.log(chalk.cyan('Environment variables:'));
  console.log(chalk.white('  nanoclaw env show           - Show env keys'));
  console.log(chalk.white('  nanoclaw env set <KEY> <VALUE>  - Set env variable'));
  console.log(chalk.white('  nanoclaw env unset <KEY>       - Unset env variable'));
}

export async function envShowCmd() {
  const envConfig = readEnvFile([
    'ASSISTANT_NAME',
    'TELEGRAM_BOT_TOKEN',
    'DISCORD_BOT_TOKEN',
    'TEAM_CHANNEL_PLATFORM',
    'TEAM_CHANNEL_ENABLED',
    'INSTANCE_ID',
  ]);

  console.log(chalk.cyan('Environment variables:'));
  for (const [key, value] of Object.entries(envConfig)) {
    if (value) {
      const displayValue = value.length > 20 ? value.slice(0, 20) + '...' : value;
      console.log(chalk.white(`  ${key}: ${displayValue}`));
    }
  }
}

export async function envSetCmd(key?: string, value?: string) {
  let envKey = key;
  let envValue = value;

  if (!envKey) {
    envKey = await input({
      message: 'Variable name:',
      validate: (v) => /^[A-Z_][A-Z0-9_]*$/.test(v) || 'Only uppercase letters, numbers, underscores',
    });
  }

  if (!envValue) {
    envValue = await input({
      message: 'Value:',
    });
  }

  const envPath = `${process.cwd()}/.env`;
  const fs = require('fs');
  let envContent = '';
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf-8');
  }

  const lines = envContent.split('\n');
  const keyPattern = new RegExp(`^${envKey}=`);
  let found = false;
  const updatedLines = lines.map(line => {
    if (keyPattern.test(line)) {
      found = true;
      return `${envKey}=${envValue}`;
    }
    return line;
  });

  if (!found) {
    updatedLines.push(`${envKey}=${envValue}`);
  }

  fs.writeFileSync(envPath, updatedLines.join('\n'));
  console.log(chalk.green(`✓ Set ${envKey}`));
}

export async function envUnsetCmd(key?: string) {
  let envKey = key;

  if (!envKey) {
    envKey = await input({
      message: 'Variable name:',
    });
  }

  const shouldUnset = await confirm({
    message: `Unset ${envKey}?`,
    default: false,
  });

  if (!shouldUnset) {
    console.log(chalk.gray('Cancelled'));
    return;
  }

  const envPath = `${process.cwd()}/.env`;
  const fs = require('fs');
  if (!fs.existsSync(envPath)) {
    console.log(chalk.yellow('No .env file'));
    return;
  }

  const envContent = fs.readFileSync(envPath, 'utf-8');
  const lines = envContent.split('\n');
  const keyPattern = new RegExp(`^${envKey}=`);
  const updatedLines = lines.filter((line: string) => !keyPattern.test(line));

  fs.writeFileSync(envPath, updatedLines.join('\n'));
  console.log(chalk.green(`✓ Unset ${envKey}`));
}
