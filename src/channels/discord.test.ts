import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { DiscordChannel } from './discord.js';

describe('DiscordChannel', () => {
  let channel: DiscordChannel;
  let messages: Array<{ chatJid: string; message: any }> = [];
  let metadata: Array<{ chatJid: string; name?: string }> = [];

  beforeEach(() => {
    messages = [];
    metadata = [];
    channel = new DiscordChannel('test-token', {
      onMessage: (chatJid, message) => messages.push({ chatJid, message }),
      onChatMetadata: (chatJid, _timestamp, name) => metadata.push({ chatJid, name }),
      registeredGroups: () => ({}),
    });
  });

  describe('name', () => {
    it('returns discord', () => {
      expect(channel.name).toBe('discord');
    });
  });

  describe('ownsJid', () => {
    it('returns true for dc: prefixed JIDs', () => {
      expect(channel.ownsJid('dc:123456789:987654321')).toBe(true);
      expect(channel.ownsJid('dc:dm:123456789')).toBe(true);
    });

    it('returns false for non-discord JIDs', () => {
      expect(channel.ownsJid('tg:123456789')).toBe(false);
      expect(channel.ownsJid('wa:123456789@s.whatsapp.net')).toBe(false);
    });
  });

  describe('isConnected', () => {
    it('returns false before connect', () => {
      expect(channel.isConnected()).toBe(false);
    });
  });

  describe('extractChannelId', () => {
    it('extracts channel ID from guild channel JID', () => {
      const channelAny = channel as any;
      expect(channelAny.extractChannelId('dc:123456789:987654321')).toBe('987654321');
    });

    it('extracts channel ID from DM JID', () => {
      const channelAny = channel as any;
      expect(channelAny.extractChannelId('dc:dm:987654321')).toBe('987654321');
    });

    it('returns null for invalid JID', () => {
      const channelAny = channel as any;
      expect(channelAny.extractChannelId('tg:123456789')).toBeNull();
      expect(channelAny.extractChannelId('invalid')).toBeNull();
    });
  });

  describe('splitMessage', () => {
    it('does not split short messages', () => {
      const channelAny = channel as any;
      const result = channelAny.splitMessage('short message', 2000);
      expect(result).toEqual(['short message']);
    });

    it('splits long messages', () => {
      const channelAny = channel as any;
      const longMessage = 'a'.repeat(3000);
      const result = channelAny.splitMessage(longMessage, 2000);
      expect(result.length).toBe(2);
      expect(result[0].length).toBe(2000);
      expect(result[1].length).toBe(1000);
    });

    it('prefers splitting at newlines', () => {
      const channelAny = channel as any;
      const message = 'a'.repeat(1500) + '\n' + 'b'.repeat(1500);
      const result = channelAny.splitMessage(message, 2000);
      expect(result.length).toBe(2);
      expect(result[0]).toBe('a'.repeat(1500) + '\n');
      expect(result[1]).toBe('b'.repeat(1500));
    });
  });
});
