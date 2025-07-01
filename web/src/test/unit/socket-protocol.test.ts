/**
 * Tests for the Unix socket protocol
 */

import { describe, expect, it } from 'vitest';
import {
  frameMessage,
  MessageBuilder,
  MessageParser,
  MessageType,
  parsePayload,
} from '../../server/pty/socket-protocol.js';

describe('Socket Protocol', () => {
  describe('frameMessage', () => {
    it('should frame a string message correctly', () => {
      const message = frameMessage(MessageType.STDIN_DATA, 'hello world');

      expect(message[0]).toBe(MessageType.STDIN_DATA);
      expect(message.readUInt32BE(1)).toBe(11); // 'hello world'.length
      expect(message.subarray(5).toString('utf8')).toBe('hello world');
    });

    it('should frame a JSON object message correctly', () => {
      const obj = { cmd: 'resize', cols: 80, rows: 24 };
      const message = frameMessage(MessageType.CONTROL_CMD, obj);

      expect(message[0]).toBe(MessageType.CONTROL_CMD);
      const payloadLength = message.readUInt32BE(1);
      const payload = message.subarray(5, 5 + payloadLength).toString('utf8');
      expect(JSON.parse(payload)).toEqual(obj);
    });

    it('should frame a buffer message correctly', () => {
      const buffer = Buffer.from([1, 2, 3, 4, 5]);
      const message = frameMessage(MessageType.HEARTBEAT, buffer);

      expect(message[0]).toBe(MessageType.HEARTBEAT);
      expect(message.readUInt32BE(1)).toBe(5);
      expect(message.subarray(5)).toEqual(buffer);
    });

    it('should handle empty payloads', () => {
      const message = frameMessage(MessageType.HEARTBEAT, '');

      expect(message[0]).toBe(MessageType.HEARTBEAT);
      expect(message.readUInt32BE(1)).toBe(0);
      expect(message.length).toBe(5);
    });

    it('should handle large payloads', () => {
      const largeString = 'x'.repeat(100000);
      const message = frameMessage(MessageType.STDIN_DATA, largeString);

      expect(message[0]).toBe(MessageType.STDIN_DATA);
      expect(message.readUInt32BE(1)).toBe(100000);
      expect(message.subarray(5).toString('utf8')).toBe(largeString);
    });
  });

  describe('MessageParser', () => {
    it('should parse a single complete message', () => {
      const parser = new MessageParser();
      const originalMessage = frameMessage(MessageType.STDIN_DATA, 'test data');

      parser.addData(originalMessage);

      const messages = Array.from(parser.parseMessages());
      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe(MessageType.STDIN_DATA);
      expect(messages[0].payload.toString('utf8')).toBe('test data');
    });

    it('should parse multiple messages in one chunk', () => {
      const parser = new MessageParser();
      const msg1 = frameMessage(MessageType.STDIN_DATA, 'first');
      const msg2 = frameMessage(MessageType.CONTROL_CMD, { cmd: 'resize', cols: 80, rows: 24 });
      const msg3 = frameMessage(MessageType.HEARTBEAT, Buffer.alloc(0));

      const combined = Buffer.concat([msg1, msg2, msg3]);
      parser.addData(combined);

      const messages = Array.from(parser.parseMessages());
      expect(messages).toHaveLength(3);

      expect(messages[0].type).toBe(MessageType.STDIN_DATA);
      expect(messages[0].payload.toString('utf8')).toBe('first');

      expect(messages[1].type).toBe(MessageType.CONTROL_CMD);
      expect(JSON.parse(messages[1].payload.toString('utf8'))).toEqual({
        cmd: 'resize',
        cols: 80,
        rows: 24,
      });

      expect(messages[2].type).toBe(MessageType.HEARTBEAT);
      expect(messages[2].payload.length).toBe(0);
    });

    it('should handle partial messages', () => {
      const parser = new MessageParser();
      const fullMessage = frameMessage(MessageType.STDIN_DATA, 'hello world');

      // Split message in the middle
      const part1 = fullMessage.subarray(0, 8);
      const part2 = fullMessage.subarray(8);

      // Add first part
      parser.addData(part1);
      let messages = Array.from(parser.parseMessages());
      expect(messages).toHaveLength(0); // Not enough data yet

      // Add second part
      parser.addData(part2);
      messages = Array.from(parser.parseMessages());
      expect(messages).toHaveLength(1);
      expect(messages[0].payload.toString('utf8')).toBe('hello world');
    });

    it('should handle header split across chunks', () => {
      const parser = new MessageParser();
      const fullMessage = frameMessage(MessageType.STATUS_UPDATE, {
        app: 'claude',
        status: 'thinking',
      });

      // Split in the header (after type byte, in the middle of length)
      const part1 = fullMessage.subarray(0, 3);
      const part2 = fullMessage.subarray(3);

      parser.addData(part1);
      let messages = Array.from(parser.parseMessages());
      expect(messages).toHaveLength(0);

      parser.addData(part2);
      messages = Array.from(parser.parseMessages());
      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe(MessageType.STATUS_UPDATE);
    });

    it('should handle multiple partial messages', () => {
      const parser = new MessageParser();
      const msg1 = frameMessage(MessageType.STDIN_DATA, 'first message');
      const msg2 = frameMessage(MessageType.STDIN_DATA, 'second message');

      // Create a complex split scenario
      const combined = Buffer.concat([msg1, msg2]);
      const splitPoint = msg1.length - 3; // Split near end of first message

      parser.addData(combined.subarray(0, splitPoint));
      let messages = Array.from(parser.parseMessages());
      expect(messages).toHaveLength(0); // First message incomplete

      parser.addData(combined.subarray(splitPoint));
      messages = Array.from(parser.parseMessages());
      expect(messages).toHaveLength(2);
      expect(messages[0].payload.toString('utf8')).toBe('first message');
      expect(messages[1].payload.toString('utf8')).toBe('second message');
    });

    it('should track pending bytes correctly', () => {
      const parser = new MessageParser();

      expect(parser.pendingBytes).toBe(0);

      parser.addData(Buffer.from([1, 2, 3]));
      expect(parser.pendingBytes).toBe(3);

      parser.clear();
      expect(parser.pendingBytes).toBe(0);
    });

    it('should handle messages with zero-length payload', () => {
      const parser = new MessageParser();
      const message = frameMessage(MessageType.HEARTBEAT, Buffer.alloc(0));

      parser.addData(message);
      const messages = Array.from(parser.parseMessages());

      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe(MessageType.HEARTBEAT);
      expect(messages[0].payload.length).toBe(0);
    });
  });

  describe('MessageBuilder', () => {
    it('should build stdin message', () => {
      const message = MessageBuilder.stdin('echo hello');

      expect(message[0]).toBe(MessageType.STDIN_DATA);
      const payload = message.subarray(5).toString('utf8');
      expect(payload).toBe('echo hello');
    });

    it('should build resize message', () => {
      const message = MessageBuilder.resize(120, 40);

      expect(message[0]).toBe(MessageType.CONTROL_CMD);
      const payload = JSON.parse(message.subarray(5).toString('utf8'));
      expect(payload).toEqual({ cmd: 'resize', cols: 120, rows: 40 });
    });

    it('should build kill message with signal', () => {
      const message = MessageBuilder.kill('SIGTERM');

      expect(message[0]).toBe(MessageType.CONTROL_CMD);
      const payload = JSON.parse(message.subarray(5).toString('utf8'));
      expect(payload).toEqual({ cmd: 'kill', signal: 'SIGTERM' });
    });

    it('should build kill message without signal', () => {
      const message = MessageBuilder.kill();

      const payload = JSON.parse(message.subarray(5).toString('utf8'));
      expect(payload).toEqual({ cmd: 'kill' });
    });

    it('should build reset size message', () => {
      const message = MessageBuilder.resetSize();

      expect(message[0]).toBe(MessageType.CONTROL_CMD);
      const payload = JSON.parse(message.subarray(5).toString('utf8'));
      expect(payload).toEqual({ cmd: 'reset-size' });
    });

    it('should build status message', () => {
      const message = MessageBuilder.status('claude', '✻ Thinking (10s)');

      expect(message[0]).toBe(MessageType.STATUS_UPDATE);
      const payload = JSON.parse(message.subarray(5).toString('utf8'));
      expect(payload).toEqual({ app: 'claude', status: '✻ Thinking (10s)' });
    });

    it('should build status message with extra data', () => {
      const message = MessageBuilder.status('claude', '✻ Thinking', {
        tokens: 1500,
        progress: 0.5,
      });

      const payload = JSON.parse(message.subarray(5).toString('utf8'));
      expect(payload).toEqual({
        app: 'claude',
        status: '✻ Thinking',
        tokens: 1500,
        progress: 0.5,
      });
    });

    it('should build heartbeat message', () => {
      const message = MessageBuilder.heartbeat();

      expect(message[0]).toBe(MessageType.HEARTBEAT);
      expect(message.readUInt32BE(1)).toBe(0);
      expect(message.length).toBe(5);
    });

    it('should build error message', () => {
      const message = MessageBuilder.error('CONNECTION_LOST', 'Socket disconnected', {
        retry: true,
      });

      expect(message[0]).toBe(MessageType.ERROR);
      const payload = JSON.parse(message.subarray(5).toString('utf8'));
      expect(payload).toEqual({
        code: 'CONNECTION_LOST',
        message: 'Socket disconnected',
        details: { retry: true },
      });
    });
  });

  describe('parsePayload', () => {
    it('should parse stdin data as string', () => {
      const payload = Buffer.from('test input');
      const result = parsePayload(MessageType.STDIN_DATA, payload);

      expect(result).toBe('test input');
    });

    it('should parse control command as JSON', () => {
      const payload = Buffer.from(JSON.stringify({ cmd: 'resize', cols: 80, rows: 24 }));
      const result = parsePayload(MessageType.CONTROL_CMD, payload);

      expect(result).toEqual({ cmd: 'resize', cols: 80, rows: 24 });
    });

    it('should parse status update as JSON', () => {
      const payload = Buffer.from(JSON.stringify({ app: 'claude', status: 'active' }));
      const result = parsePayload(MessageType.STATUS_UPDATE, payload);

      expect(result).toEqual({ app: 'claude', status: 'active' });
    });

    it('should parse error as JSON', () => {
      const payload = Buffer.from(JSON.stringify({ code: 'ERR', message: 'error' }));
      const result = parsePayload(MessageType.ERROR, payload);

      expect(result).toEqual({ code: 'ERR', message: 'error' });
    });

    it('should parse heartbeat as null', () => {
      const payload = Buffer.alloc(0);
      const result = parsePayload(MessageType.HEARTBEAT, payload);

      expect(result).toBeNull();
    });

    it('should return buffer for unknown types', () => {
      const payload = Buffer.from([1, 2, 3]);
      const result = parsePayload(0xff as MessageType, payload);

      expect(result).toEqual(payload);
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle malformed JSON in payload', () => {
      const parser = new MessageParser();
      const message = frameMessage(MessageType.CONTROL_CMD, '{invalid json');

      parser.addData(message);
      const messages = Array.from(parser.parseMessages());

      expect(messages).toHaveLength(1);
      expect(() => JSON.parse(messages[0].payload.toString('utf8'))).toThrow();
    });

    it('should handle very large message length in header', () => {
      const parser = new MessageParser();
      const header = Buffer.allocUnsafe(5);
      header[0] = MessageType.STDIN_DATA;
      header.writeUInt32BE(0xffffffff, 1); // Max uint32

      parser.addData(header);
      const messages = Array.from(parser.parseMessages());

      expect(messages).toHaveLength(0); // Would need 4GB of data
      expect(parser.pendingBytes).toBe(5);
    });

    it('should handle binary data in stdin messages', () => {
      const binaryData = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
      const message = frameMessage(MessageType.STDIN_DATA, binaryData);

      const parser = new MessageParser();
      parser.addData(message);

      const messages = Array.from(parser.parseMessages());
      expect(messages[0].payload).toEqual(binaryData);
    });

    it('should handle unicode in messages', () => {
      const unicodeText = '你好世界 🌍 emoji test';
      const message = MessageBuilder.stdin(unicodeText);

      const parser = new MessageParser();
      parser.addData(message);

      const messages = Array.from(parser.parseMessages());
      const parsed = parsePayload(messages[0].type, messages[0].payload);

      expect(parsed).toBe(unicodeText);
    });
  });
});
