import {
  Client,
  GatewayIntentBits,
  Events,
  Message,
  ChannelType,
  TextChannel,
  ActivityType,
} from 'discord.js';

import { ASSISTANT_NAME, TRIGGER_PATTERN } from '../config.js';
import { logger } from '../logger.js';
import { Channel, OnChatMetadata, OnInboundMessage, RegisteredGroup } from '../types.js';

export interface DiscordChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
}

export class DiscordChannel implements Channel {
  name = 'discord';

  private client: Client | null = null;
  private opts: DiscordChannelOpts;
  private botToken: string;

  constructor(botToken: string, opts: DiscordChannelOpts) {
    this.botToken = botToken;
    this.opts = opts;
  }

  async connect(): Promise<void> {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
    });

    this.client.once(Events.ClientReady, (readyClient) => {
      logger.info({ username: readyClient.user.tag }, 'Discord bot connected');
      console.log(`\n  Discord bot: ${readyClient.user.tag}`);
      console.log(`  Use !chatid in a channel to get its registration ID\n`);

      readyClient.user.setPresence({
        activities: [{ name: 'for commands', type: ActivityType.Watching }],
        status: 'online',
      });
    });

    this.client.on(Events.MessageCreate, async (message: Message) => {
      if (message.author.bot) return;

      const chatJid = this.getChatJid(message);
      const content = message.content;
      const timestamp = new Date().toISOString();
      const senderName = message.author.displayName || message.author.username;
      const sender = message.author.id;
      const msgId = message.id;

      if (content === '!chatid') {
        await this.sendChatIdInfo(message);
        return;
      }

      if (content === '!ping') {
        await message.reply(`${ASSISTANT_NAME} is online.`);
        return;
      }

      const isGroup = message.guild !== null;
      const chatName = this.getChatName(message);
      this.opts.onChatMetadata(chatJid, timestamp, chatName, 'discord', isGroup);

      const group = this.opts.registeredGroups()[chatJid];
      if (!group) {
        logger.debug({ chatJid, chatName }, 'Message from unregistered Discord channel');
        return;
      }

      let processedContent = content;
      const botMention = `<@${this.client!.user!.id}>`;
      const botMentionNick = `<@!${this.client!.user!.id}>`;
      if (
        (content.includes(botMention) || content.includes(botMentionNick)) &&
        !TRIGGER_PATTERN.test(content)
      ) {
        processedContent = `@${ASSISTANT_NAME} ${content.replace(botMentionNick, '').replace(botMention, '').trim()}`;
      }

      this.opts.onMessage(chatJid, {
        id: msgId,
        chat_jid: chatJid,
        sender,
        sender_name: senderName,
        content: processedContent,
        timestamp,
        is_from_me: false,
      });

      logger.info({ chatJid, chatName, sender: senderName }, 'Discord message stored');
    });

    this.client.on(Events.MessageCreate, async (message: Message) => {
      if (message.author.bot) return;

      const chatJid = this.getChatJid(message);
      const group = this.opts.registeredGroups()[chatJid];
      if (!group) return;

      const timestamp = new Date().toISOString();
      const senderName = message.author.displayName || message.author.username;
      const isGroup = message.guild !== null;

      let placeholder = '';
      if (message.attachments.size > 0) {
        const attachment = message.attachments.first()!;
        if (attachment.contentType?.startsWith('image/')) {
          placeholder = '[Image]';
        } else if (attachment.contentType?.startsWith('video/')) {
          placeholder = '[Video]';
        } else if (attachment.contentType?.startsWith('audio/')) {
          placeholder = '[Audio]';
        } else {
          placeholder = `[File: ${attachment.name}]`;
        }
      }

      if (placeholder && !message.content) {
        this.opts.onChatMetadata(chatJid, timestamp, undefined, 'discord', isGroup);
        this.opts.onMessage(chatJid, {
          id: message.id,
          chat_jid: chatJid,
          sender: message.author.id,
          sender_name: senderName,
          content: placeholder,
          timestamp,
          is_from_me: false,
        });
      }
    });

    this.client.on(Events.Error, (error) => {
      logger.error({ err: error.message }, 'Discord bot error');
    });

    await this.client.login(this.botToken);
  }

  private getChatJid(message: Message): string {
    if (message.guild) {
      return `dc:${message.guild.id}:${message.channelId}`;
    }
    return `dc:dm:${message.channelId}`;
  }

  private getChatName(message: Message): string {
    if (message.guild) {
      const channel = message.channel;
      if (channel instanceof TextChannel) {
        return `${message.guild.name} / #${channel.name}`;
      }
      return message.guild.name;
    }
    return message.author.displayName || message.author.username;
  }

  private async sendChatIdInfo(message: Message): Promise<void> {
    const chatJid = this.getChatJid(message);
    const chatName = this.getChatName(message);
    const isGroup = message.guild !== null;

    const info = [
      `**Channel ID:** \`${chatJid}\``,
      `**Name:** ${chatName}`,
      `**Type:** ${isGroup ? 'Server Channel' : 'Direct Message'}`,
    ].join('\n');

    await message.reply({ content: info, allowedMentions: { parse: [] } });
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.client || !this.client.isReady()) {
      logger.warn('Discord bot not initialized');
      return;
    }

    try {
      const channelId = this.extractChannelId(jid);
      if (!channelId) {
        logger.error({ jid }, 'Invalid Discord JID format');
        return;
      }

      const channel = await this.client.channels.fetch(channelId);
      if (!channel || !(channel instanceof TextChannel)) {
        logger.error({ jid, channelId }, 'Discord channel not found or not a text channel');
        return;
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

      logger.info({ jid, length: text.length }, 'Discord message sent');
    } catch (err) {
      logger.error({ jid, err }, 'Failed to send Discord message');
    }
  }

  private extractChannelId(jid: string): string | null {
    const match = jid.match(/^dc:(?:\d+:)?(\d+)$/);
    if (match) {
      return match[1];
    }

    const dmMatch = jid.match(/^dc:dm:(\d+)$/);
    if (dmMatch) {
      return dmMatch[1];
    }

    return null;
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

  isConnected(): boolean {
    return this.client !== null && this.client.isReady();
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('dc:');
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.destroy();
      this.client = null;
      logger.info('Discord bot stopped');
    }
  }

  async setTyping(_jid: string, isTyping: boolean): Promise<void> {
    if (!this.client || !this.client.isReady() || !isTyping) return;

    try {
      const channelId = this.extractChannelId(_jid);
      if (!channelId) return;

      const channel = await this.client.channels.fetch(channelId);
      if (channel instanceof TextChannel) {
        await channel.sendTyping();
      }
    } catch (err) {
      logger.debug({ jid: _jid, err }, 'Failed to send Discord typing indicator');
    }
  }
}
