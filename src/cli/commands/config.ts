import chalk from 'chalk';
import { client } from '../shared/api-client.js';

import { input, select, confirm } from '@inquirer/prompts';

export async function configCmd(options: { json?: boolean }) {
  const isJson = options.json || false;

  if (!client.isDaemonRunning()) {
    console.log(chalk.red('● Daemon không chạy'));
    process.exit(1);
  }

  try {
    const config = await client.get('/config') as Record<string, unknown>;
    if (isJson) {
      console.log(JSON.stringify(config, null, 1));
      return;
    }

    console.log(chalk.cyan('Config:'));
    console.log(chalk.white(JSON.stringify(config, null, 1)));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(chalk.red(`Error: ${message}`));
    process.exit(1);
  }
}

export async function configShowCmd() {
  if (!client.isDaemonRunning()) {
    console.log(chalk.red('● Daemon không chạy'));
    process.exit(1);
  }

  try {
    const config = await client.get('/config') as Record<string, unknown>;
    console.log(chalk.cyan('Current settings:'));
    console.log(chalk.white(JSON.stringify(config.settings, null, 1)));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(chalk.red(`Error: ${message}`));
    process.exit(1);
  }
}

export async function configSetCmd(key: string, value: string) {
  if (!client.isDaemonRunning()) {
    console.log(chalk.red('● Daemon không chạy'));
    process.exit(1);
  }

  // Coerce value đúng kiểu: số, boolean, hoặc string
  let coercedValue: string | number | boolean = value;
  if (value === 'true') coercedValue = true;
  else if (value === 'false') coercedValue = false;
  else if (!isNaN(Number(value)) && value.trim() !== '') coercedValue = Number(value);

  try {
    await client.put('/config', { settings: { [key]: coercedValue } });
    console.log(chalk.green(`✓ Set ${key} = ${coercedValue}`));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(chalk.red(`Error: ${message}`));
    process.exit(1);
  }
}

export async function configResetCmd() {
  if (!client.isDaemonRunning()) {
    console.log(chalk.red('● Daemon không chạy'));
    process.exit(1);
  }

  const shouldReset = await confirm({
    message: 'Reset all config to defaults?',
    default: false,
  });

  if (!shouldReset) {
    console.log(chalk.gray('Cancelled'));
    return;
  }

  try {
    await client.post('/config/reset', {});
    console.log(chalk.green('✓ Config reset to defaults'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(chalk.red(`Error: ${message}`));
    process.exit(1);
  }
}

export async function configReloadCmd() {
  if (!client.isDaemonRunning()) {
    console.log(chalk.red('● Daemon không chạy'));
    process.exit(1);
  }

  try {
    await client.post('/config/reload', {});
    console.log(chalk.green('✓ Config reloaded'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(chalk.red(`Error: ${message}`));
    process.exit(1);
  }
}

export async function configEditCmd() {
  if (!client.isDaemonRunning()) {
    console.log(chalk.red('● Daemon không chạy'));
    process.exit(1);
  }

  try {
    const config = await client.get('/config') as Record<string, unknown>;
    const settings = config.settings as Record<string, unknown> || {};

    const keys = Object.keys(settings);
    if (keys.length === 0) {
      console.log(chalk.yellow('No settings to edit'));
      return;
    }

    const selectedKey = await select({
      message: 'Select setting to edit:',
      choices: keys.map(k => ({
        name: `${k} = ${String(settings[k])}`,
        value: k,
      })),
    });

    const currentValue = String(settings[selectedKey]);
    const newValue = await input({
      message: `New value for ${selectedKey}:`,
      default: currentValue,
    });

    const shouldApply = await confirm({
      message: `Set ${selectedKey} = ${newValue}?`,
      default: true,
    });

    if (!shouldApply) {
      console.log(chalk.gray('Cancelled'));
      return;
    }

    await client.put('/config', { settings: { [selectedKey]: newValue } });
    console.log(chalk.green(`✓ Set ${selectedKey} = ${newValue}`));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(chalk.red(`Error: ${message}`));
    process.exit(1);
  }
}
