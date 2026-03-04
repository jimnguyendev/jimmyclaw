import fs from 'fs';
import path from 'path';

import {
  ASSISTANT_NAME,
  DISCORD_BOT_TOKEN,
  IDLE_TIMEOUT,
  MAIN_GROUP_FOLDER,
  POLL_INTERVAL,
  SWARM_ENABLED,
  TELEGRAM_BOT_POOL,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_ONLY,
  TRIGGER_PATTERN,
} from './config.js';
import { TelegramChannel, initBotPool } from './channels/telegram.js';
import { DiscordChannel } from './channels/discord.js';
import {
  ContainerOutput,
  runContainerAgent,
  writeGroupsSnapshot,
  writeTasksSnapshot,
} from './container-runner.js';
import { cleanupOrphans, ensureContainerRuntimeRunning } from './container-runtime.js';
import {
  getAllChats,
  getAllRegisteredGroups,
  getAllSessions,
  getAllTasks,
  getMessagesSince,
  getNewMessages,
  getRawDb,
  getRouterState,
  initDatabase,
  setRegisteredGroup,
  setRouterState,
  setSession,
  storeChatMetadata,
  storeMessage,
} from './db.js';
import { GroupQueue } from './group-queue.js';
import { resolveGroupFolderPath } from './group-folder.js';
import { startIpcWatcher } from './ipc.js';
import { findChannel, formatMessages, formatOutbound } from './router.js';
import { startSchedulerLoop } from './task-scheduler.js';
import { Channel, NewMessage, RegisteredGroup } from './types.js';
import { logger } from './logger.js';
import { initSwarmMode, getOrchestrator, isSwarmEnabled, shutdownSwarm, runSwarmAgent } from './swarm.js';
import { createSwarmCommandHandler, isSwarmCommand } from './swarm-commands.js';
import { isWorkspaceCommand, handleWorkspaceCommand } from './workspace-commands.js';
import { startApiServer, stopApiServer, ApiDeps } from './api-server.js';
import { loadSwarmConfig, saveSwarmConfig, addWorkerAgent, removeWorkerAgent, renameAgent, updateAgentModel, updateAgentSystemPrompt, updateSettings, getOrchestratorConfig, resetToDefault } from './swarm-config.js';

// Re-export for backwards compatibility during refactor
export { escapeXml, formatMessages } from './router.js';

let lastTimestamp = '';
let sessions: Record<string, string> = {};
let registeredGroups: Record<string, RegisteredGroup> = {};
let lastAgentTimestamp: Record<string, string> = {};
let messageLoopRunning = false;
let daemonStartTime = Date.now();

let channels: Channel[] = [];
const queue = new GroupQueue();

function loadState(): void {
  lastTimestamp = getRouterState('last_timestamp') || '';
  const agentTs = getRouterState('last_agent_timestamp');
  try {
    lastAgentTimestamp = agentTs ? JSON.parse(agentTs) : {};
  } catch {
    logger.warn('Corrupted last_agent_timestamp in DB, resetting');
    lastAgentTimestamp = {};
  }
  sessions = getAllSessions();
  registeredGroups = getAllRegisteredGroups();
  logger.info({ groupCount: Object.keys(registeredGroups).length }, 'State loaded');
}

function saveState(): void {
  setRouterState('last_timestamp', lastTimestamp);
  setRouterState('last_agent_timestamp', JSON.stringify(lastAgentTimestamp));
}

function registerGroup(jid: string, group: RegisteredGroup): void {
  let groupDir: string;
  try {
    groupDir = resolveGroupFolderPath(group.folder);
  } catch (err) {
    logger.warn(
      { jid, folder: group.folder, err },
      'Rejecting group registration with invalid folder',
    );
    return;
  }

  registeredGroups[jid] = group;
  setRegisteredGroup(jid, group);

  // Create group folder
  fs.mkdirSync(path.join(groupDir, 'logs'), { recursive: true });

  logger.info({ jid, name: group.name, folder: group.folder }, 'Group registered');
}

/**
 * Get available groups list for the agent.
 * Returns groups ordered by most recent activity.
 */
export function getAvailableGroups(): import('./container-runner.js').AvailableGroup[] {
  const chats = getAllChats();
  const registeredJids = new Set(Object.keys(registeredGroups));

  return chats
    .filter((c) => c.jid !== '__group_sync__' && c.is_group)
    .map((c) => ({
      jid: c.jid,
      name: c.name,
      lastActivity: c.last_message_time,
      isRegistered: registeredJids.has(c.jid),
    }));
}

/** @internal - exported for testing */
export function _setRegisteredGroups(groups: Record<string, RegisteredGroup>): void {
  registeredGroups = groups;
}

/**
 * Process all pending messages for a group.
 * Called by the GroupQueue when it's this group's turn.
 */
async function processGroupMessages(chatJid: string): Promise<boolean> {
  const group = registeredGroups[chatJid];
  if (!group) return true;

  const channel = findChannel(channels, chatJid);
  if (!channel) {
    console.log(`Warning: no channel owns JID ${chatJid}, skipping messages`);
    return true;
  }

  const isMainGroup = group.folder === MAIN_GROUP_FOLDER;

  const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
  const missedMessages = getMessagesSince(chatJid, sinceTimestamp, ASSISTANT_NAME);

  if (missedMessages.length === 0) return true;

  // For non-main groups, check if trigger is required and present
  if (!isMainGroup && group.requiresTrigger !== false) {
    const hasTrigger = missedMessages.some((m) => TRIGGER_PATTERN.test(m.content.trim()));
    if (!hasTrigger) return true;
  }

  const prompt = formatMessages(missedMessages);

  // Check for workspace mount commands
  if (isWorkspaceCommand(prompt)) {
    const result = await handleWorkspaceCommand(prompt, { ...group, jid: chatJid });
    if (result.handled) {
      if (result.response) await channel.sendMessage(chatJid, result.response);
      lastAgentTimestamp[chatJid] = missedMessages[missedMessages.length - 1].timestamp;
      // Reload group state so next invocation sees updated mounts
      registeredGroups = getAllRegisteredGroups();
      saveState();
      return true;
    }
  }

  // Check for swarm commands first
  if (isSwarmEnabled() && isSwarmCommand(prompt)) {
    const commandHandler = createSwarmCommandHandler(getRawDb(), getOrchestrator());
    const result = await commandHandler.handleSwarmCommand(prompt);

    if (result.handled) {
      if (result.response) {
        await channel.sendMessage(chatJid, result.response);
      } else if (result.error) {
        await channel.sendMessage(chatJid, `❌ Error: ${result.error}`);
      }
      lastAgentTimestamp[chatJid] = missedMessages[missedMessages.length - 1].timestamp;
      saveState();
      return true;
    }
  }

  // Route to swarm agent if enabled (not a command)
  if (isSwarmEnabled()) {
    logger.info({ group: group.name }, 'Routing to swarm agent');
    
    const SWARM_TIMEOUT_MS = parseInt(process.env.SWARM_TIMEOUT || '120000', 10);
    
    try {
      const swarmPromise = runSwarmAgent(group, prompt, chatJid);
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Swarm agent timeout')), SWARM_TIMEOUT_MS)
      );
      
      const swarmResult = await Promise.race([swarmPromise, timeoutPromise]);
      
      if (swarmResult.status === 'success' && swarmResult.result) {
        await channel.sendMessage(chatJid, swarmResult.result);
      } else if (swarmResult.error) {
        await channel.sendMessage(chatJid, `❌ ${swarmResult.error}`);
      }
      
      lastAgentTimestamp[chatJid] = missedMessages[missedMessages.length - 1].timestamp;
      saveState();
      return true;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown';
      logger.error({ group: group.name, error: errorMsg }, 'Swarm agent error');
      await channel.sendMessage(chatJid, `❌ Swarm error: ${errorMsg}`);
      lastAgentTimestamp[chatJid] = missedMessages[missedMessages.length - 1].timestamp;
      saveState();
      return false;
    }
  }

  // Advance cursor so the piping path in startMessageLoop won't re-fetch
  // these messages. Save the old cursor so we can roll back on error.
  const previousCursor = lastAgentTimestamp[chatJid] || '';
  lastAgentTimestamp[chatJid] = missedMessages[missedMessages.length - 1].timestamp;
  saveState();

  // Track idle timer for closing stdin when agent is idle
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      logger.debug({ group: group.name }, 'Idle timeout, closing container stdin');
      queue.closeStdin(chatJid);
    }, IDLE_TIMEOUT);
  };

  await channel.setTyping?.(chatJid, true);
  let hadError = false;
  let outputSentToUser = false;

  const output = await runAgent(group, prompt, chatJid, async (result) => {
    // Streaming output callback — called for each agent result
    if (result.result) {
      const raw = typeof result.result === 'string' ? result.result : JSON.stringify(result.result);
      // Strip <internal>...</internal> blocks — agent uses these for internal reasoning
      const text = raw.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
      logger.info({ group: group.name }, `Agent output: ${raw.slice(0, 200)}`);
      if (text) {
        await channel.sendMessage(chatJid, text);
        outputSentToUser = true;
      }
      // Only reset idle timer on actual results, not session-update markers (result: null)
      resetIdleTimer();
    }

    if (result.status === 'success') {
      queue.notifyIdle(chatJid);
    }

    if (result.status === 'error') {
      hadError = true;
    }
  });

  await channel.setTyping?.(chatJid, false);
  if (idleTimer) clearTimeout(idleTimer);

  if (output === 'error' || hadError) {
    // If we already sent output to the user, don't roll back the cursor —
    // the user got their response and re-processing would send duplicates.
    if (outputSentToUser) {
      logger.warn(
        { group: group.name },
        'Agent error after output was sent, skipping cursor rollback to prevent duplicates',
      );
      return true;
    }
    // Roll back cursor so retries can re-process these messages
    lastAgentTimestamp[chatJid] = previousCursor;
    saveState();
    logger.warn({ group: group.name }, 'Agent error, rolled back message cursor for retry');
    return false;
  }

  return true;
}

async function runAgent(
  group: RegisteredGroup,
  prompt: string,
  chatJid: string,
  onOutput?: (output: ContainerOutput) => Promise<void>,
): Promise<'success' | 'error'> {
  const isMain = group.folder === MAIN_GROUP_FOLDER;
  const sessionId = sessions[group.folder];

  // Update tasks snapshot for container to read (filtered by group)
  const tasks = getAllTasks();
  writeTasksSnapshot(
    group.folder,
    isMain,
    tasks.map((t) => ({
      id: t.id,
      groupFolder: t.group_folder,
      prompt: t.prompt,
      schedule_type: t.schedule_type,
      schedule_value: t.schedule_value,
      status: t.status,
      next_run: t.next_run,
    })),
  );

  // Update available groups snapshot (main group only can see all groups)
  const availableGroups = getAvailableGroups();
  writeGroupsSnapshot(
    group.folder,
    isMain,
    availableGroups,
    new Set(Object.keys(registeredGroups)),
  );

  // Wrap onOutput to track session ID from streamed results
  const wrappedOnOutput = onOutput
    ? async (output: ContainerOutput) => {
        if (output.newSessionId) {
          sessions[group.folder] = output.newSessionId;
          setSession(group.folder, output.newSessionId);
        }
        await onOutput(output);
      }
    : undefined;

  try {
    const output = await runContainerAgent(
      group,
      {
        prompt,
        sessionId,
        groupFolder: group.folder,
        chatJid,
        isMain,
        assistantName: ASSISTANT_NAME,
      },
      (proc, containerName) => queue.registerProcess(chatJid, proc, containerName, group.folder),
      wrappedOnOutput,
    );

    if (output.newSessionId) {
      sessions[group.folder] = output.newSessionId;
      setSession(group.folder, output.newSessionId);
    }

    if (output.status === 'error') {
      logger.error({ group: group.name, error: output.error }, 'Container agent error');
      return 'error';
    }

    return 'success';
  } catch (err) {
    logger.error({ group: group.name, err }, 'Agent error');
    return 'error';
  }
}

async function startMessageLoop(): Promise<void> {
  if (messageLoopRunning) {
    logger.debug('Message loop already running, skipping duplicate start');
    return;
  }
  messageLoopRunning = true;

  logger.info(`NanoClaw running (trigger: @${ASSISTANT_NAME})`);

  while (true) {
    try {
      const jids = Object.keys(registeredGroups);
      const { messages, newTimestamp } = getNewMessages(jids, lastTimestamp, ASSISTANT_NAME);

      if (messages.length > 0) {
        logger.info({ count: messages.length }, 'New messages');

        // Advance the "seen" cursor for all messages immediately
        lastTimestamp = newTimestamp;
        saveState();

        // Deduplicate by group
        const messagesByGroup = new Map<string, NewMessage[]>();
        for (const msg of messages) {
          const existing = messagesByGroup.get(msg.chat_jid);
          if (existing) {
            existing.push(msg);
          } else {
            messagesByGroup.set(msg.chat_jid, [msg]);
          }
        }

        for (const [chatJid, groupMessages] of messagesByGroup) {
          const group = registeredGroups[chatJid];
          if (!group) continue;

          const channel = findChannel(channels, chatJid);
          if (!channel) {
            console.log(`Warning: no channel owns JID ${chatJid}, skipping messages`);
            continue;
          }

          const isMainGroup = group.folder === MAIN_GROUP_FOLDER;
          const needsTrigger = !isMainGroup && group.requiresTrigger !== false;

          // For non-main groups, only act on trigger messages.
          // Non-trigger messages accumulate in DB and get pulled as
          // context when a trigger eventually arrives.
          if (needsTrigger) {
            const hasTrigger = groupMessages.some((m) => TRIGGER_PATTERN.test(m.content.trim()));
            if (!hasTrigger) continue;
          }

          // Pull all messages since lastAgentTimestamp so non-trigger
          // context that accumulated between triggers is included.
          const allPending = getMessagesSince(
            chatJid,
            lastAgentTimestamp[chatJid] || '',
            ASSISTANT_NAME,
          );
          const messagesToSend = allPending.length > 0 ? allPending : groupMessages;
          const formatted = formatMessages(messagesToSend);

          if (queue.sendMessage(chatJid, formatted)) {
            logger.debug(
              { chatJid, count: messagesToSend.length },
              'Piped messages to active container',
            );
            lastAgentTimestamp[chatJid] = messagesToSend[messagesToSend.length - 1].timestamp;
            saveState();
            // Show typing indicator while the container processes the piped message
            channel
              .setTyping?.(chatJid, true)
              ?.catch((err) => logger.warn({ chatJid, err }, 'Failed to set typing indicator'));
          } else {
            // No active container — enqueue for a new one
            queue.enqueueMessageCheck(chatJid);
          }
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error in message loop');
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }
}

/**
 * Startup recovery: check for unprocessed messages in registered groups.
 * Handles crash between advancing lastTimestamp and processing messages.
 */
function recoverPendingMessages(): void {
  for (const [chatJid, group] of Object.entries(registeredGroups)) {
    const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
    const pending = getMessagesSince(chatJid, sinceTimestamp, ASSISTANT_NAME);
    if (pending.length > 0) {
      logger.info(
        { group: group.name, pendingCount: pending.length },
        'Recovery: found unprocessed messages',
      );
      queue.enqueueMessageCheck(chatJid);
    }
  }
}

function ensureContainerSystemRunning(): void {
  ensureContainerRuntimeRunning();
  cleanupOrphans();
}

async function main(): Promise<void> {
  ensureContainerSystemRunning();
  initDatabase();
  logger.info('Database initialized');
  loadState();

  // Initialize swarm mode if enabled
  if (SWARM_ENABLED) {
    initSwarmMode();
    logger.info('Swarm mode enabled');
  }

  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');
    stopApiServer();
    
    // First, signal queue to stop accepting new work
    await queue.shutdown(10000);
    
    // Then disconnect swarm (channel messenger for agent team)
    if (isSwarmEnabled()) {
      await shutdownSwarm();
    }
    
    // Finally disconnect communication channels
    for (const ch of channels) await ch.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Start API server for CLI
  startApiServer({
    getOrchestratorStatus: () => {
      const memUsage = process.memoryUsage();
      const orchestrator = getOrchestrator();
      const status = orchestrator?.getStatus();
      return {
        status: 'running',
        uptime: Math.floor((Date.now() - daemonStartTime) / 1000),
        startTime: daemonStartTime,
        memory: { used: memUsage.heapUsed, total: memUsage.heapTotal },
        platform: process.platform,
        tasksToday: 0,
        successCount: 0,
        failedCount: 0,
        costToday: 0,
        agents: status ? status.agents.length : 0,
        pendingTasks: status?.pendingTasks || 0,
        processingTasks: status?.processingTasks || 0,
      };
    },
    getAgents: () => {
      const config = loadSwarmConfig();
      return [
        { id: config.leader.id, role: config.leader.role, model: config.leader.model, status: 'idle' },
        ...config.workers.map(w => ({ id: w.id, role: w.role, model: w.model, status: 'idle' as const })),
      ];
    },
    addAgent: (agent) => addWorkerAgent({
      id: agent.id,
      role: agent.role as import('./orchestrator/types.js').AgentRole,
      model: agent.model,
      fallbackModel: agent.fallbackModel,
      systemPrompt: agent.systemPrompt,
    }),
    updateAgent: (id, updates) => {
      let ok = false;
      if (updates.model) ok = updateAgentModel(id, updates.model as string) || ok;
      if (updates.systemPrompt !== undefined) ok = updateAgentSystemPrompt(id, updates.systemPrompt as string) || ok;
      return ok;
    },
    removeAgent: (id) => removeWorkerAgent(id),
    renameAgent: (oldId, newId) => renameAgent(oldId, newId),
    getTasks: () => {
      const orchestrator = getOrchestrator();
      if (!orchestrator) return [];
      return orchestrator.getTaskQueue().getTasksByStatus('pending').concat(
        orchestrator.getTaskQueue().getTasksByStatus('processing')
      );
    },
    getTask: (id) => {
      const orchestrator = getOrchestrator();
      if (!orchestrator) return undefined;
      return orchestrator.getTaskQueue().getTask(id);
    },
    getConfig: () => loadSwarmConfig(),
    updateConfig: (updates) => {
      const config = loadSwarmConfig();
      if (updates.settings) {
        updateSettings(updates.settings as Record<string, unknown>);
      }
      if (updates.teamChannel) {
        config.teamChannel = updates.teamChannel as typeof config.teamChannel;
        saveSwarmConfig(config);
      }
    },
    resetConfig: () => resetToDefault(),
    reloadConfig: async () => {
      const { reloadConfig } = await import('./swarm-config.js');
      await reloadConfig();
    },
    getLogs: (params) => {
      const logFile = path.join(process.cwd(), 'store', 'logs', 'nanoclaw.log');
      if (!fs.existsSync(logFile)) return [];
      try {
        const content = fs.readFileSync(logFile, 'utf-8');
        let lines = content.split('\n').filter(Boolean);
        if (params.agent) {
          lines = lines.filter(l => l.toLowerCase().includes(params.agent!.toLowerCase()));
        }
        if (params.level) {
          lines = lines.filter(l => l.toLowerCase().includes(`"level":"${params.level!.toLowerCase()}"`));
        }
        if (params.lines) {
          lines = lines.slice(-params.lines);
        }
        return lines.map(l => {
          try {
            return JSON.parse(l);
          } catch {
            return { raw: l };
          }
        });
      } catch {
        return [];
      }
    },
    getTeamChannel: () => {
      const config = loadSwarmConfig();
      return config.teamChannel || { platform: null, channelId: null, enabled: false };
    },
    setTeamChannel: (config) => {
      const swarmConfig = loadSwarmConfig();
      swarmConfig.teamChannel = config as typeof swarmConfig.teamChannel;
      saveSwarmConfig(swarmConfig);
    },
  });
  logger.info('API server started');

  // Channel callbacks (shared by all channels)
  const channelOpts = {
    onMessage: (_chatJid: string, msg: NewMessage) => storeMessage(msg),
    onChatMetadata: (
      chatJid: string,
      timestamp: string,
      name?: string,
      channel?: string,
      isGroup?: boolean,
    ) => storeChatMetadata(chatJid, timestamp, name, channel, isGroup),
    registeredGroups: () => registeredGroups,
  };

  // Create and connect channels
  if (TELEGRAM_BOT_TOKEN) {
    const telegram = new TelegramChannel(TELEGRAM_BOT_TOKEN, channelOpts);
    channels.push(telegram);
    await telegram.connect();
    if (TELEGRAM_BOT_POOL.length > 0) {
      await initBotPool(TELEGRAM_BOT_POOL);
    }
  }

  if (DISCORD_BOT_TOKEN) {
    const discord = new DiscordChannel(DISCORD_BOT_TOKEN, channelOpts);
    channels.push(discord);
    await discord.connect();
  }

  // Start subsystems (independently of connection handler)
  startSchedulerLoop({
    registeredGroups: () => registeredGroups,
    getSessions: () => sessions,
    queue,
    onProcess: (groupJid, proc, containerName, groupFolder) =>
      queue.registerProcess(groupJid, proc, containerName, groupFolder),
    sendMessage: async (jid, rawText) => {
      const channel = findChannel(channels, jid);
      if (!channel) {
        console.log(`Warning: no channel owns JID ${jid}, cannot send message`);
        return;
      }
      const text = formatOutbound(rawText);
      if (text) await channel.sendMessage(jid, text);
    },
  });
  startIpcWatcher({
    sendMessage: (jid, text) => {
      const channel = findChannel(channels, jid);
      if (!channel) throw new Error(`No channel for JID: ${jid}`);
      return channel.sendMessage(jid, text);
    },
    registeredGroups: () => registeredGroups,
    registerGroup,
    syncGroupMetadata: async () => {},
    getAvailableGroups,
    writeGroupsSnapshot: (gf, im, ag, rj) => writeGroupsSnapshot(gf, im, ag, rj),
  });
  queue.setProcessMessagesFn(processGroupMessages);
  recoverPendingMessages();
  startMessageLoop().catch((err) => {
    logger.fatal({ err }, 'Message loop crashed unexpectedly');
    process.exit(1);
  });
}

// Guard: only run when executed directly, not when imported by tests
const isDirectRun =
  process.argv[1] &&
  new URL(import.meta.url).pathname === new URL(`file://${process.argv[1]}`).pathname;

if (isDirectRun) {
  main().catch((err) => {
    logger.error({ err }, 'Failed to start NanoClaw');
    process.exit(1);
  });
}
