import chalk from 'chalk';
import { execSync } from 'child_process';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { client } from '../shared/api-client.js';

const PLATFORM = process.platform;
const HOME_DIR = os.homedir();

export async function serviceCmd() {
  console.log(chalk.cyan('Service management commands:'));
  console.log(chalk.white('  nanoclaw service start     - Start daemon'));
  console.log(chalk.white('  nanoclaw service stop      - Stop daemon'));
  console.log(chalk.white('  nanoclaw service restart  - Restart daemon'));
  console.log(chalk.white('  nanoclaw service status    - Check daemon status'));
  console.log(chalk.white('  nanoclaw service install  - Install as system service'));
  console.log(chalk.white('  nanoclaw service uninstall - Uninstall system service'));
}

export async function serviceStartCmd() {
  if (client.isDaemonRunning()) {
    console.log(chalk.yellow('● Daemon đã chạy'));
    return;
  }

  console.log(chalk.cyan('Starting daemon...'));
  
  try {
    if (PLATFORM === 'darwin') {
      execSync('launchctl kickstart -k gui/com.anomaly.nanoclaw', { stdio: 'inherit' });
    } else if (PLATFORM === 'linux') {
      execSync('systemctl --user start nanoclaw', { stdio: 'inherit' });
    } else {
      console.log(chalk.red('Unsupported platform'));
      process.exit(1);
    }
    console.log(chalk.green('✓ Daemon started'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(chalk.red(`Error: ${message}`));
    console.log(chalk.gray('  Try running `bun run src/index.ts` manually'));
    process.exit(1);
  }
}

export async function serviceStopCmd() {
  if (!client.isDaemonRunning()) {
    console.log(chalk.yellow('● Daemon không chạy'));
    return;
  }

  console.log(chalk.cyan('Stopping daemon...'));
  
  try {
    if (PLATFORM === 'darwin') {
      execSync('launchctl kickstart -k gui/com.anomaly.nanoclaw --exit', { stdio: 'inherit' });
    } else if (PLATFORM === 'linux') {
      execSync('systemctl --user stop nanoclaw', { stdio: 'inherit' });
    } else {
      console.log(chalk.red('Unsupported platform'));
      process.exit(1);
    }
    console.log(chalk.green('✓ Daemon stopped'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(chalk.red(`Error: ${message}`));
    process.exit(1);
  }
}

export async function serviceRestartCmd() {
  console.log(chalk.cyan('Restarting daemon...'));
  await serviceStopCmd();
  await new Promise(resolve => setTimeout(resolve, 1000));
  await serviceStartCmd();
}

export async function serviceStatusCmd() {
  if (client.isDaemonRunning()) {
    console.log(chalk.green('● Daemon đang chạy'));
    try {
      const status = await client.get('/status') as { uptime: number };
      console.log(chalk.cyan(`  Uptime: ${Math.floor(status.uptime / 60)}m`));
    } catch (error) {
      // Ignore error
    }
  } else {
    console.log(chalk.red('● Daemon không chạy'));
    console.log(chalk.gray('  Run `nanoclaw service start` để start daemon'));
  }
}

export async function serviceInstallCmd() {
  console.log(chalk.cyan('Installing system service...'));
  
  try {
    if (PLATFORM === 'darwin') {
    const plistPath = `${HOME_DIR}/Library/LaunchAgents/com.anomaly.nanoclaw.plist`;
    const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.anomaly.nanoclaw</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.cwd()}/node_modules/.bin/bun</string>
    <string>run</string>
    <string>src/index.ts</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>`;
    require('fs').writeFileSync(plistPath, plistContent);
    console.log(chalk.green('✓ Installed launchd service'));
    console.log(chalk.gray(`  ${plistPath}`));
  } else if (PLATFORM === 'linux') {
    const servicePath = `${HOME_DIR}/.config/systemd/user/nanoclaw.service`;
    const serviceContent = `[Unit]
Description=NanoClaw Agent Swarm
After=network.target

[Service]
Type=simple
ExecStart=${process.cwd()}/node_modules/.bin/bun run src/index.ts
Restart=on-failure

[Install]
WantedBy=multi-user.target
`;
    require('fs').mkdirSync(require('path').dirname(servicePath), { recursive: true });
    require('fs').writeFileSync(servicePath, serviceContent);
    console.log(chalk.green('✓ Installed systemd service'));
    console.log(chalk.gray(`  ${servicePath}`));
    console.log(chalk.gray('  Run `systemctl --user daemon-reload` to enable'));
  } else {
    console.log(chalk.red('Unsupported platform'));
    process.exit(1);
  }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(chalk.red(`Error: ${message}`));
    process.exit(1);
  }
}

export async function serviceUninstallCmd() {
  console.log(chalk.cyan('Uninstalling system service...'));
  
  try {
    if (PLATFORM === 'darwin') {
    const plistPath = `${HOME_DIR}/Library/LaunchAgents/com.anomaly.nanoclaw.plist`;
    if (require('fs').existsSync(plistPath)) {
      require('fs').unlinkSync(plistPath);
      console.log(chalk.green('✓ Uninstalled launchd service'));
    } else {
      console.log(chalk.yellow('Service not installed'));
    }
  } else if (PLATFORM === 'linux') {
    const servicePath = `${HOME_DIR}/.config/systemd/user/nanoclaw.service`;
    if (require('fs').existsSync(servicePath)) {
      require('fs').unlinkSync(servicePath);
      console.log(chalk.green('✓ Uninstalled systemd service'));
      console.log(chalk.gray('  Run `systemctl --user daemon-reload` to update'));
    } else {
      console.log(chalk.yellow('Service not installed'));
    }
  } else {
    console.log(chalk.red('Unsupported platform'));
    process.exit(1);
  }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(chalk.red(`Error: ${message}`));
    process.exit(1);
  }
}
