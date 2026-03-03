import { Client, GatewayIntentBits, Events, Message, TextChannel } from 'discord.js';
import { Api, Bot, Context, GrammyError } from 'grammy';
import { logger } from '../logger.js';

export type ChannelTaskType = 'research' | 'code' | 'review' | 'done' | 'failed' | 'ask' | 'file' | 'info' | 'broadcast';

interface ParsedChannelMessageBase {
  rawText: string;
  mentions: string[];
  taskType?: ChannelTaskType;
  content: string;
  taskId?: string;
  platform: 'discord' | 'telegram';
  channelMessageId: string;
  timestamp: string;
}

export type ParsedChannelMessage =
  | (ParsedChannelMessageBase & { fromHuman: false; fromAgent: string })
  | (ParsedChannelMessageBase & { fromHuman: true; fromAgent: undefined });

export interface ChannelMessengerConfig {
  platform: 'discord' | 'telegram';
  channelId: string;
  agents: Array<{
    id: string;
    botToken: string;
    botId?: string;
  }>;
}

export interface ChannelMessenger {
  sendAsAgent(agentId: string, text: string): Promise<void>;
  startListening(handler: (msg: ParsedChannelMessage) => void): void;
  stopListening(): void;
  waitForReply(params: {
    fromAgent: string;
    taskId: string;
    timeoutMs: number;
  }): Promise<ParsedChannelMessage | null>;
  isConnected(): boolean;
  disconnect(): Promise<void>;
}

export function parseChannelMessage(
  text: string,
  fromBot: boolean,
  platform: 'discord' | 'telegram',
  messageId: string,
  botUsername?: string,
): ParsedChannelMessage {
  const mentionRegex = /@([a-zA-Z0-9_-]+)/g;
  const mentions: string[] = [];
  let match;
  while ((match = mentionRegex.exec(text)) !== null) {
    mentions.push(match[1].toLowerCase());
  }

  const taskTypeRegex = /\[(\w+)\]/;
  const typeMatch = taskTypeRegex.exec(text);
  const taskType = typeMatch ? (typeMatch[1].toLowerCase() as ChannelTaskType) : undefined;

  const taskIdRegex = /#([a-zA-Z0-9-]+)/;
  const taskIdMatch = taskIdRegex.exec(text);
  const taskId = taskIdMatch ? taskIdMatch[1] : undefined;

  let content = text;
  content = content.replace(mentionRegex, '').trim();
  content = content.replace(taskTypeRegex, '').trim();
  content = content.replace(taskIdRegex, '').trim();

  const base: ParsedChannelMessageBase = {
    rawText: text,
    mentions,
    taskType,
    content,
    taskId,
    platform,
    channelMessageId: messageId,
    timestamp: new Date().toISOString(),
  };

  if (fromBot && botUsername) {
    const fromAgent = botUsername.toLowerCase().replace(/bot$/i, '');
    return { ...base, fromHuman: false, fromAgent };
  }

  return { ...base, fromHuman: true, fromAgent: undefined };
}

export class DiscordChannelMessenger implements ChannelMessenger {
  private config: ChannelMessengerConfig;
  private agentClients: Map<string, Client> = new Map();
  private primaryClient: Client | null = null;
  private messageHandler: ((msg: ParsedChannelMessage) => void) | null = null;
  private pendingReplies: Map<string, { resolve: (msg: ParsedChannelMessage | null) => void; timeout: Timer; fromAgent: string }> = new Map();
  private processedMessageIds: Map<string, number> = new Map();
  private connected = false;
  private cleanupInterval?: Timer;
  private readonly DEDUP_TTL_MS = 5 * 60 * 1000;

  constructor(config: ChannelMessengerConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    for (const agent of this.config.agents) {
      const client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
        ],
      });

      await client.login(agent.botToken);
      this.agentClients.set(agent.id, client);
      logger.info({ agentId: agent.id }, 'Discord agent client connected');

      if (!this.primaryClient) {
        this.primaryClient = client;
      }
    }

    this.connected = true;
    logger.info({ agentCount: this.agentClients.size }, 'DiscordChannelMessenger connected');
  }

  async sendAsAgent(agentId: string, text: string): Promise<void> {
    const client = this.agentClients.get(agentId);
    if (!client || !client.isReady()) {
      logger.error({ agentId }, 'Agent client not found or not ready');
      throw new Error(`Agent ${agentId} client not ready`);
    }

    try {
      const channel = await client.channels.fetch(this.config.channelId);
      if (!channel || !(channel instanceof TextChannel)) {
        throw new Error(`Channel ${this.config.channelId} not found or not a text channel`);
      }

      const MAX_LENGTH = 2000;
      if (text.length <= MAX_LENGTH) {
        await channel.send(text);
      } else {
        const chunks = this.splitMessage(text, MAX_LENGTH);
        for (const chunk of chunks) {
          await channel.send(chunk);
        }
      }

      logger.info({ agentId, channelId: this.config.channelId, length: text.length }, 'Agent message sent');
    } catch (err) {
      logger.error({ agentId, err }, 'Failed to send agent message');
      throw err;
    }
  }

  startListening(handler: (msg: ParsedChannelMessage) => void): void {
    this.messageHandler = handler;

    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [msgId, timestamp] of this.processedMessageIds) {
        if (now - timestamp > this.DEDUP_TTL_MS) {
          this.processedMessageIds.delete(msgId);
        }
      }
    }, 60000);

    for (const [agentId, client] of this.agentClients) {
      client.on(Events.MessageCreate, (message: Message) => {
        if (message.channelId !== this.config.channelId) return;

        const now = Date.now();
        const processedAt = this.processedMessageIds.get(message.id);
        if (processedAt && now - processedAt < this.DEDUP_TTL_MS) {
          return;
        }
        this.processedMessageIds.set(message.id, now);

        const fromBot = message.author.bot;
        const botUsername = client.user?.username;

        const parsed = parseChannelMessage(
          message.content,
          fromBot,
          'discord',
          message.id,
          botUsername,
        );

        if (parsed.taskId && this.pendingReplies.has(parsed.taskId)) {
          const pending = this.pendingReplies.get(parsed.taskId)!;
          if (parsed.fromAgent === pending.fromAgent) {
            clearTimeout(pending.timeout);
            this.pendingReplies.delete(parsed.taskId);
            pending.resolve(parsed);
            return;
          } else {
            this.handleUnexpectedAgentReply(parsed.taskId, pending.fromAgent, parsed.fromAgent ?? 'unknown');
            return;
          }
        }

        if (this.messageHandler) {
          this.messageHandler(parsed);
        }
      });
    }

    logger.info('DiscordChannelMessenger started listening');
  }

  private handleUnexpectedAgentReply(taskId: string, expectedAgent: string, actualAgent: string): void {
    logger.warn(
      { taskId, expectedAgent, actualAgent },
      'Received reply from unexpected agent, ignoring',
    );
  }

  stopListening(): void {
    this.messageHandler = null;
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    for (const [, client] of this.agentClients) {
      client.removeAllListeners(Events.MessageCreate);
    }
    logger.info('DiscordChannelMessenger stopped listening');
  }

  waitForReply(params: {
    fromAgent: string;
    taskId: string;
    timeoutMs: number;
  }): Promise<ParsedChannelMessage | null> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingReplies.delete(params.taskId);
        logger.warn(
          { taskId: params.taskId, fromAgent: params.fromAgent, timeoutMs: params.timeoutMs },
          'Timeout waiting for reply',
        );
        resolve(null);
      }, params.timeoutMs);

      this.pendingReplies.set(params.taskId, {
        resolve,
        timeout,
        fromAgent: params.fromAgent,
      });
    });
  }

  isConnected(): boolean {
    return this.connected && this.primaryClient?.isReady() === true;
  }

  async disconnect(): Promise<void> {
    for (const [taskId, pending] of this.pendingReplies) {
      clearTimeout(pending.timeout);
      pending.resolve(null);
      logger.warn({ taskId }, 'Pending reply rejected due to disconnect');
    }
    this.pendingReplies.clear();

    for (const [agentId, client] of this.agentClients) {
      client.destroy();
      logger.info({ agentId }, 'Discord agent client disconnected');
    }
    this.agentClients.clear();
    this.primaryClient = null;
    this.connected = false;
  }

  private splitMessage(text: string, maxLength: number): string[] {
    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > maxLength) {
      let splitPoint = maxLength;

      const codeBlockMatch = remaining.slice(0, maxLength).match(/```/g);
      if (codeBlockMatch && codeBlockMatch.length % 2 === 1) {
        const lastCodeBlock = remaining.slice(0, maxLength).lastIndexOf('```');
        if (lastCodeBlock > maxLength / 2) {
          splitPoint = lastCodeBlock;
        }
      }

      const newlineIndex = remaining.slice(0, splitPoint).lastIndexOf('\n');
      if (newlineIndex > splitPoint / 2) {
        splitPoint = newlineIndex + 1;
      }

      chunks.push(remaining.slice(0, splitPoint));
      remaining = remaining.slice(splitPoint);
    }

    if (remaining.length > 0) {
      chunks.push(remaining);
    }

    return chunks;
  }
}

export class TelegramChannelMessenger implements ChannelMessenger {
  private config: ChannelMessengerConfig;
  private agentApis: Map<string, Api> = new Map();
  private bot: Bot | null = null;
  private messageHandler: ((msg: ParsedChannelMessage) => void) | null = null;
  private pendingReplies: Map<string, { resolve: (msg: ParsedChannelMessage | null) => void; timeout: Timer; fromAgent: string }> = new Map();
  private processedMessageIds: Map<string, number> = new Map();
  private connected = false;
  private cleanupInterval?: Timer;
  private readonly DEDUP_TTL_MS = 5 * 60 * 1000;

  // Note: Telegram channelId may be plain numeric (e.g., "-1001234567890") 
  // or prefixed with "tg:" for consistency with other parts of the codebase

  constructor(config: ChannelMessengerConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    const primaryAgent = this.config.agents[0];
    if (!primaryAgent) {
      throw new Error('No agents configured for TelegramChannelMessenger');
    }

    this.bot = new Bot(primaryAgent.botToken);

    for (const agent of this.config.agents) {
      const api = new Api(agent.botToken);
      try {
        const me = await api.getMe();
        this.agentApis.set(agent.id, api);
        logger.info({ agentId: agent.id, username: me.username }, 'Telegram agent API initialized');

        const displayName = agent.id.charAt(0).toUpperCase() + agent.id.slice(1);
        if (me.first_name !== displayName) {
          try {
            await api.setMyName(displayName);
            logger.info({ agentId: agent.id, displayName }, 'Telegram bot renamed');
          } catch (err) {
            logger.warn({ agentId: agent.id, err }, 'Failed to rename Telegram bot');
          }
        }
      } catch (err) {
        logger.error({ agentId: agent.id, err }, 'Failed to initialize Telegram agent API');
      }
    }

    this.bot.start();
    this.connected = true;
    logger.info({ agentCount: this.agentApis.size }, 'TelegramChannelMessenger connected');
  }

  async sendAsAgent(agentId: string, text: string): Promise<void> {
    const api = this.agentApis.get(agentId);
    if (!api) {
      logger.error({ agentId }, 'Agent API not found');
      throw new Error(`Agent ${agentId} API not found`);
    }

    try {
      const chatId = this.config.channelId;
      const MAX_LENGTH = 4096;
      
      if (text.length <= MAX_LENGTH) {
        await api.sendMessage(chatId, text);
      } else {
        const chunks = this.splitMessage(text, MAX_LENGTH);
        for (const chunk of chunks) {
          await api.sendMessage(chatId, chunk);
        }
      }

      logger.info({ agentId, chatId: this.config.channelId, length: text.length }, 'Agent message sent via Telegram');
    } catch (err) {
      logger.error({ agentId, err }, 'Failed to send Telegram agent message');
      throw err;
    }
  }

  startListening(handler: (msg: ParsedChannelMessage) => void): void {
    this.messageHandler = handler;

    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [msgId, timestamp] of this.processedMessageIds) {
        if (now - timestamp > this.DEDUP_TTL_MS) {
          this.processedMessageIds.delete(msgId);
        }
      }
    }, 60000);

    if (!this.bot) {
      logger.error('Bot not initialized');
      return;
    }

    this.bot.on('message:text', (ctx: Context) => {
      const message = ctx.message;
      if (!message) return;

      const chatId = message.chat.id.toString();
      // Support both plain chat ID and "tg:" prefixed format
      if (chatId !== this.config.channelId && `tg:${chatId}` !== this.config.channelId) return;

      const messageId = message.message_id.toString();
      const now = Date.now();
      const processedAt = this.processedMessageIds.get(messageId);
      if (processedAt && now - processedAt < this.DEDUP_TTL_MS) {
        return;
      }
      this.processedMessageIds.set(messageId, now);

      const fromBot = !!message.from?.is_bot;
      const botUsername = ctx.me?.username;

      const parsed = parseChannelMessage(
        message.text || '',
        fromBot,
        'telegram',
        messageId,
        botUsername,
      );

      if (parsed.taskId && this.pendingReplies.has(parsed.taskId)) {
        const pending = this.pendingReplies.get(parsed.taskId)!;
        if (parsed.fromAgent === pending.fromAgent) {
          clearTimeout(pending.timeout);
          this.pendingReplies.delete(parsed.taskId);
          pending.resolve(parsed);
          return;
        } else {
          this.handleUnexpectedAgentReply(parsed.taskId, pending.fromAgent, parsed.fromAgent ?? 'unknown');
          return;
        }
      }

      if (this.messageHandler) {
        this.messageHandler(parsed);
      }
    });

    logger.info('TelegramChannelMessenger started listening');
  }

  private handleUnexpectedAgentReply(taskId: string, expectedAgent: string, actualAgent: string): void {
    logger.warn(
      { taskId, expectedAgent, actualAgent },
      'Received Telegram reply from unexpected agent, ignoring',
    );
  }

  stopListening(): void {
    this.messageHandler = null;
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    if (this.bot) {
      this.bot.stop();
    }
    logger.info('TelegramChannelMessenger stopped listening');
  }

  waitForReply(params: {
    fromAgent: string;
    taskId: string;
    timeoutMs: number;
  }): Promise<ParsedChannelMessage | null> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingReplies.delete(params.taskId);
        logger.warn(
          { taskId: params.taskId, fromAgent: params.fromAgent, timeoutMs: params.timeoutMs },
          'Timeout waiting for Telegram reply',
        );
        resolve(null);
      }, params.timeoutMs);

      this.pendingReplies.set(params.taskId, {
        resolve,
        timeout,
        fromAgent: params.fromAgent,
      });
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  async disconnect(): Promise<void> {
    for (const [taskId, pending] of this.pendingReplies) {
      clearTimeout(pending.timeout);
      pending.resolve(null);
      logger.warn({ taskId }, 'Pending Telegram reply rejected due to disconnect');
    }
    this.pendingReplies.clear();

    if (this.bot) {
      this.bot.stop();
      this.bot = null;
    }
    this.agentApis.clear();
    this.connected = false;
    logger.info('TelegramChannelMessenger disconnected');
  }

  private splitMessage(text: string, maxLength: number): string[] {
    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > maxLength) {
      let splitPoint = maxLength;

      const codeBlockMatch = remaining.slice(0, maxLength).match(/```/g);
      if (codeBlockMatch && codeBlockMatch.length % 2 === 1) {
        const lastCodeBlock = remaining.slice(0, maxLength).lastIndexOf('```');
        if (lastCodeBlock > maxLength / 2) {
          splitPoint = lastCodeBlock;
        }
      }

      const newlineIndex = remaining.slice(0, splitPoint).lastIndexOf('\n');
      if (newlineIndex > splitPoint / 2) {
        splitPoint = newlineIndex + 1;
      }

      chunks.push(remaining.slice(0, splitPoint));
      remaining = remaining.slice(splitPoint);
    }

    if (remaining.length > 0) {
      chunks.push(remaining);
    }

    return chunks;
  }
}

export function createChannelMessenger(config: ChannelMessengerConfig): ChannelMessenger {
  if (config.platform === 'discord') {
    return new DiscordChannelMessenger(config);
  }
  if (config.platform === 'telegram') {
    return new TelegramChannelMessenger(config);
  }
  throw new Error(`Unsupported platform: ${config.platform}`);
}
