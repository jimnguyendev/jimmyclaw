import { describe, it, expect } from 'bun:test';
import { parseChannelMessage, ChannelTaskType } from './channel-messenger.js';

describe('parseChannelMessage', () => {
  describe('basic parsing', () => {
    it('should parse simple @mention', () => {
      const result = parseChannelMessage(
        '@linh [research] tìm hiểu GraphQL',
        true,
        'discord',
        'msg-1',
        'NamBot',
      );

      expect(result.mentions).toEqual(['linh']);
      expect(result.taskType).toBe('research');
      expect(result.content).toBe('tìm hiểu GraphQL');
      expect(result.fromAgent).toBe('nam');
      expect(result.fromHuman).toBe(false);
      expect(result.platform).toBe('discord');
    });

    it('should parse @all broadcast', () => {
      const result = parseChannelMessage(
        '@all [info] bắt đầu task',
        true,
        'discord',
        'msg-2',
        'NamBot',
      );

      expect(result.mentions).toContain('all');
      expect(result.taskType).toBe('info');
    });

    it('should parse [done] with taskId', () => {
      const result = parseChannelMessage(
        '@nam [done] xong rồi #abc-123',
        true,
        'discord',
        'msg-3',
        'LinhBot',
      );

      expect(result.taskType).toBe('done');
      expect(result.taskId).toBe('abc-123');
      expect(result.fromAgent).toBe('linh');
      expect(result.content).toBe('xong rồi');
    });

    it('should identify human message', () => {
      const result = parseChannelMessage(
        '@nam dừng lại đi',
        false,
        'discord',
        'msg-4',
        undefined,
      );

      expect(result.fromHuman).toBe(true);
      expect(result.fromAgent).toBeUndefined();
    });

    it('should handle message without @mention', () => {
      const result = parseChannelMessage(
        'hello world',
        true,
        'discord',
        'msg-5',
        'NamBot',
      );

      expect(result.mentions).toHaveLength(0);
      expect(result.taskType).toBeUndefined();
      expect(result.content).toBe('hello world');
    });

    it('should handle message without [type]', () => {
      const result = parseChannelMessage(
        '@duc fix the bug',
        true,
        'telegram',
        'msg-6',
        'NamBot',
      );

      expect(result.mentions).toEqual(['duc']);
      expect(result.taskType).toBeUndefined();
      expect(result.content).toBe('fix the bug');
    });
  });

  describe('multiple mentions', () => {
    it('should parse multiple @mentions', () => {
      const result = parseChannelMessage(
        '@linh @duc collaboration task',
        true,
        'discord',
        'msg-7',
        'NamBot',
      );

      expect(result.mentions).toEqual(['linh', 'duc']);
      expect(result.content).toBe('collaboration task');
    });

    it('should parse @mention with underscore', () => {
      const result = parseChannelMessage(
        '@agent_one [task] do something',
        true,
        'discord',
        'msg-8',
        'TestBot',
      );

      expect(result.mentions).toEqual(['agent_one']);
    });

    it('should parse @mention with hyphen', () => {
      const result = parseChannelMessage(
        '@agent-two [task] do something',
        true,
        'discord',
        'msg-9',
        'TestBot',
      );

      expect(result.mentions).toEqual(['agent-two']);
    });
  });

  describe('task types', () => {
    const taskTypes: ChannelTaskType[] = [
      'research',
      'code',
      'review',
      'done',
      'failed',
      'ask',
      'file',
      'info',
      'broadcast',
    ];

    taskTypes.forEach((type) => {
      it(`should parse [${type}] task type`, () => {
        const result = parseChannelMessage(
          `@agent [${type}] content here`,
          true,
          'discord',
          `msg-${type}`,
          'TestBot',
        );

        expect(result.taskType).toBe(type);
      });
    });

    it('should handle task type case-insensitively', () => {
      const result = parseChannelMessage(
        '@agent [RESEARCH] content',
        true,
        'discord',
        'msg-10',
        'TestBot',
      );

      expect(result.taskType).toBe('research');
    });
  });

  describe('taskId parsing', () => {
    it('should parse taskId with # prefix', () => {
      const result = parseChannelMessage(
        '@nam [done] completed #task-abc-123',
        true,
        'discord',
        'msg-11',
        'LinhBot',
      );

      expect(result.taskId).toBe('task-abc-123');
    });

    it('should parse taskId with UUID format', () => {
      const result = parseChannelMessage(
        '@nam [done] done #550e8400-e29b-41d4-a716-446655440000',
        true,
        'discord',
        'msg-12',
        'TestBot',
      );

      expect(result.taskId).toBe('550e8400-e29b-41d4-a716-446655440000');
    });

    it('should handle message without taskId', () => {
      const result = parseChannelMessage(
        '@nam hello there',
        true,
        'discord',
        'msg-13',
        'TestBot',
      );

      expect(result.taskId).toBeUndefined();
    });
  });

  describe('bot username to agent id conversion', () => {
    it('should convert bot username to agent id', () => {
      const result = parseChannelMessage(
        '@duc task',
        true,
        'discord',
        'msg-14',
        'MikeBot',
      );

      expect(result.fromAgent).toBe('mike');
    });

    it('should handle bot username without Bot suffix', () => {
      const result = parseChannelMessage(
        '@duc task',
        true,
        'discord',
        'msg-15',
        'mike',
      );

      expect(result.fromAgent).toBe('mike');
    });

    it('should handle bot username with mixed case', () => {
      const result = parseChannelMessage(
        '@duc task',
        true,
        'discord',
        'msg-16',
        'MIKEBOT',
      );

      expect(result.fromAgent).toBe('mike');
    });
  });

  describe('platform handling', () => {
    it('should set platform to discord', () => {
      const result = parseChannelMessage(
        '@agent task',
        true,
        'discord',
        'msg-17',
        'TestBot',
      );

      expect(result.platform).toBe('discord');
    });

    it('should set platform to telegram', () => {
      const result = parseChannelMessage(
        '@agent task',
        true,
        'telegram',
        'msg-18',
        'TestBot',
      );

      expect(result.platform).toBe('telegram');
    });
  });

  describe('content cleaning', () => {
    it('should remove @mention from content', () => {
      const result = parseChannelMessage(
        '@agent [type] the actual content',
        true,
        'discord',
        'msg-19',
        'TestBot',
      );

      expect(result.content).toBe('the actual content');
      expect(result.content).not.toContain('@agent');
    });

    it('should remove [type] from content', () => {
      const result = parseChannelMessage(
        '@agent [research] research this topic',
        true,
        'discord',
        'msg-20',
        'TestBot',
      );

      expect(result.content).toBe('research this topic');
      expect(result.content).not.toContain('[research]');
    });

    it('should remove #taskId from content', () => {
      const result = parseChannelMessage(
        '@agent [done] completed task #abc-123',
        true,
        'discord',
        'msg-21',
        'TestBot',
      );

      expect(result.content).toBe('completed task');
      expect(result.content).not.toContain('#abc-123');
    });

    it('should trim whitespace from content', () => {
      const result = parseChannelMessage(
        '@agent [type]   content with spaces   ',
        true,
        'discord',
        'msg-22',
        'TestBot',
      );

      expect(result.content).toBe('content with spaces');
    });
  });

  describe('timestamp and messageId', () => {
    it('should include channelMessageId', () => {
      const result = parseChannelMessage(
        '@agent task',
        true,
        'discord',
        'unique-msg-id-123',
        'TestBot',
      );

      expect(result.channelMessageId).toBe('unique-msg-id-123');
    });

    it('should include timestamp', () => {
      const result = parseChannelMessage(
        '@agent task',
        true,
        'discord',
        'msg-23',
        'TestBot',
      );

      expect(result.timestamp).toBeDefined();
      expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
    });

    it('should preserve rawText', () => {
      const rawText = '@agent [type] content #task-123';
      const result = parseChannelMessage(
        rawText,
        true,
        'discord',
        'msg-24',
        'TestBot',
      );

      expect(result.rawText).toBe(rawText);
    });
  });
});
