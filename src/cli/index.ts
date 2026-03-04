#!/usr/bin/env bun
import { Command } from 'commander';
import { statusCmd } from './commands/status.js';
import { agentsCmd } from './commands/agents.js';
import { agentAddCmd, agentRemoveCmd, agentRenameCmd, agentModelCmd, agentPromptCmd } from './commands/agent.js';
import { tasksCmd } from './commands/tasks.js';
import { logsCmd } from './commands/logs.js';
import { configCmd, configShowCmd, configSetCmd, configResetCmd, configReloadCmd, configEditCmd } from './commands/config.js';
import { channelCmd, channelSetCmd, channelTestCmd } from './commands/channel.js';
import { 
  serviceCmd, 
  serviceStartCmd, 
  serviceStopCmd, 
  serviceRestartCmd, 
  serviceStatusCmd, 
  serviceInstallCmd, 
  serviceUninstallCmd 
} from './commands/service.js';
import { envCmd, envShowCmd, envSetCmd, envUnsetCmd } from './commands/env.js';
import { openTui } from './tui/app.js';

const program = new Command();

program
  .name('jimmyclaw')
  .version('2.0.0')
  .description('JimmyClaw CLI - Manage agent swarms from terminal');

// Status commands
program
  .command('status')
  .description('Show daemon status')
  .option('--json', 'Output as JSON')
  .action(statusCmd);

program
  .command('agents')
  .description('List all agents')
  .option('--json', 'Output as JSON')
  .action(agentsCmd);

program
  .command('tasks')
  .description('List pending and processing tasks')
  .option('--json', 'Output as JSON')
  .action(tasksCmd);

program
  .command('logs')
  .description('View daemon logs')
  .option('--lines <n>', 'Number of lines to show', '50')
  .option('--agent <id>', 'Filter by agent ID')
  .option('--level <level>', 'Filter by log level (debug/info/warn/error)')
  .option('--since <time>', 'Filter logs since timestamp')
  .option('-f, --follow', 'Stream logs realtime')
  .action(logsCmd);

// Agent commands
const agentCmd = program.command('agent').description('Manage agents');

agentCmd
  .command('add [id] [role] [model]')
  .description('Add a new agent')
  .option('--json', 'Output as JSON')
  .action(agentAddCmd);

agentCmd
  .command('remove <id>')
  .description('Remove an agent')
  .action(agentRemoveCmd);

agentCmd
  .command('rename <oldId> <newId>')
  .description('Rename an agent')
  .action(agentRenameCmd);

agentCmd
  .command('model <id> <model>')
  .description('Update agent model')
  .action(agentModelCmd);

agentCmd
  .command('prompt <id>')
  .description('Edit agent system prompt interactively')
  .action(agentPromptCmd);

// Config commands
const configCommand = program.command('config').description('Manage configuration');

configCommand
  .command('show')
  .description('Show current configuration')
  .action(configShowCmd);

configCommand
  .command('set <key> <value>')
  .description('Set a configuration value')
  .action(configSetCmd);

configCommand
  .command('reset')
  .description('Reset configuration to defaults')
  .action(configResetCmd);

configCommand
  .command('reload')
  .description('Reload configuration from disk')
  .action(configReloadCmd);

configCommand
  .command('edit')
  .description('Interactively edit configuration')
  .action(configEditCmd);

// Channel commands
const channelCommand = program.command('channel').description('Manage team channel');

channelCommand
  .command('show')
  .description('Show channel configuration')
  .action(channelCmd);

channelCommand
  .command('set <platform> <channelId>')
  .description('Set team channel')
  .action(channelSetCmd);

channelCommand
  .command('test')
  .description('Test channel connection')
  .action(channelTestCmd);

// Service commands
const serviceCommand = program.command('service').description('Manage daemon service');

serviceCommand
  .command('start')
  .description('Start daemon')
  .action(serviceStartCmd);

serviceCommand
  .command('stop')
  .description('Stop daemon')
  .action(serviceStopCmd);

serviceCommand
  .command('restart')
  .description('Restart daemon')
  .action(serviceRestartCmd);

serviceCommand
  .command('status')
  .description('Check daemon status')
  .action(serviceStatusCmd);

serviceCommand
  .command('install')
  .description('Install as system service')
  .action(serviceInstallCmd);

serviceCommand
  .command('uninstall')
  .description('Uninstall system service')
  .action(serviceUninstallCmd);

// Env commands
const envCommand = program.command('env').description('Manage environment variables');

envCommand
  .command('show')
  .description('Show environment variables')
  .action(envShowCmd);

envCommand
  .command('set [key] [value]')
  .description('Set environment variable')
  .action(envSetCmd);

envCommand
  .command('unset <key>')
  .description('Unset environment variable')
  .action(envUnsetCmd);

if (process.argv.length === 2) {
  openTui();
} else {
  program.parse();
}
