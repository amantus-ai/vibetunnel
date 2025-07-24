import { describe, expect, it } from 'vitest';
import {
  frameMessage,
  type GitFollowRequest,
  type GitFollowResponse,
  MessageBuilder,
  MessageParser,
  MessageType,
  parsePayload,
  type StatusResponse,
} from './socket-protocol.js';

describe('Socket Protocol', () => {
  describe('frameMessage', () => {
    it('should frame a string message', () => {
      const message = frameMessage(MessageType.STDIN_DATA, 'hello world');

      expect(message[0]).toBe(MessageType.STDIN_DATA);
      expect(message.readUInt32BE(1)).toBe(11); // 'hello world'.length
      expect(message.subarray(5).toString('utf8')).toBe('hello world');
    });

    it('should frame a JSON object message', () => {
      const obj = { cmd: 'resize', cols: 80, rows: 24 };
      const message = frameMessage(MessageType.CONTROL_CMD, obj);

      expect(message[0]).toBe(MessageType.CONTROL_CMD);
      const payload = message.subarray(5).toString('utf8');
      expect(JSON.parse(payload)).toEqual(obj);
    });

    it('should frame a buffer message', () => {
      const buffer = Buffer.from('binary data');
      const message = frameMessage(MessageType.STDIN_DATA, buffer);

      expect(message[0]).toBe(MessageType.STDIN_DATA);
      expect(message.readUInt32BE(1)).toBe(buffer.length);
      expect(message.subarray(5).equals(buffer)).toBe(true);
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

    it('should handle partial messages', () => {
      const parser = new MessageParser();
      const originalMessage = frameMessage(MessageType.STDIN_DATA, 'test data');

      // Add first half
      parser.addData(originalMessage.subarray(0, 5));
      let messages = Array.from(parser.parseMessages());
      expect(messages).toHaveLength(0);
      expect(parser.pendingBytes).toBe(5);

      // Add second half
      parser.addData(originalMessage.subarray(5));
      messages = Array.from(parser.parseMessages());
      expect(messages).toHaveLength(1);
      expect(messages[0].payload.toString('utf8')).toBe('test data');
    });

    it('should handle multiple messages', () => {
      const parser = new MessageParser();
      const msg1 = frameMessage(MessageType.STDIN_DATA, 'first');
      const msg2 = frameMessage(MessageType.CONTROL_CMD, { cmd: 'resize', cols: 80, rows: 24 });

      parser.addData(Buffer.concat([msg1, msg2]));

      const messages = Array.from(parser.parseMessages());
      expect(messages).toHaveLength(2);
      expect(messages[0].type).toBe(MessageType.STDIN_DATA);
      expect(messages[0].payload.toString('utf8')).toBe('first');
      expect(messages[1].type).toBe(MessageType.CONTROL_CMD);
    });

    it('should clear the buffer', () => {
      const parser = new MessageParser();
      parser.addData(Buffer.from('some data'));

      expect(parser.pendingBytes).toBeGreaterThan(0);
      parser.clear();
      expect(parser.pendingBytes).toBe(0);
    });
  });

  describe('MessageBuilder', () => {
    it('should build status request message', () => {
      const message = MessageBuilder.statusRequest();
      expect(message[0]).toBe(MessageType.STATUS_REQUEST);
      expect(message.readUInt32BE(1)).toBe(2); // '{}'.length
    });

    it('should build status response message', () => {
      const response: StatusResponse = {
        running: true,
        port: 4020,
        url: 'http://localhost:4020',
        followMode: {
          enabled: true,
          branch: 'main',
          repoPath: '/Users/test/project',
        },
      };

      const message = MessageBuilder.statusResponse(response);
      expect(message[0]).toBe(MessageType.STATUS_RESPONSE);

      const payload = JSON.parse(message.subarray(5).toString('utf8'));
      expect(payload).toEqual(response);
    });

    it('should build git follow request message', () => {
      const request: GitFollowRequest = {
        repoPath: '/Users/test/project',
        branch: 'feature-branch',
        enable: true,
      };

      const message = MessageBuilder.gitFollowRequest(request);
      expect(message[0]).toBe(MessageType.GIT_FOLLOW_REQUEST);

      const payload = JSON.parse(message.subarray(5).toString('utf8'));
      expect(payload).toEqual(request);
    });

    it('should build git follow response message', () => {
      const response: GitFollowResponse = {
        success: true,
        currentBranch: 'main',
      };

      const message = MessageBuilder.gitFollowResponse(response);
      expect(message[0]).toBe(MessageType.GIT_FOLLOW_RESPONSE);

      const payload = JSON.parse(message.subarray(5).toString('utf8'));
      expect(payload).toEqual(response);
    });

    it('should build error message', () => {
      const message = MessageBuilder.error('TEST_ERROR', 'Something went wrong', {
        details: 'test',
      });
      expect(message[0]).toBe(MessageType.ERROR);

      const payload = JSON.parse(message.subarray(5).toString('utf8'));
      expect(payload).toEqual({
        code: 'TEST_ERROR',
        message: 'Something went wrong',
        details: { details: 'test' },
      });
    });
  });

  describe('parsePayload', () => {
    it('should parse STDIN_DATA as string', () => {
      const buffer = Buffer.from('hello world');
      const result = parsePayload(MessageType.STDIN_DATA, buffer);
      expect(result).toBe('hello world');
    });

    it('should parse JSON message types', () => {
      const jsonTypes = [
        MessageType.CONTROL_CMD,
        MessageType.STATUS_UPDATE,
        MessageType.ERROR,
        MessageType.STATUS_REQUEST,
        MessageType.STATUS_RESPONSE,
        MessageType.GIT_FOLLOW_REQUEST,
        MessageType.GIT_FOLLOW_RESPONSE,
        MessageType.GIT_EVENT_NOTIFY,
        MessageType.GIT_EVENT_ACK,
      ];

      for (const type of jsonTypes) {
        const obj = { test: 'data', nested: { value: 123 } };
        const buffer = Buffer.from(JSON.stringify(obj));
        const result = parsePayload(type, buffer);
        expect(result).toEqual(obj);
      }
    });

    it('should parse HEARTBEAT as null', () => {
      const buffer = Buffer.alloc(0);
      const result = parsePayload(MessageType.HEARTBEAT, buffer);
      expect(result).toBeNull();
    });

    it('should return raw buffer for unknown types', () => {
      const buffer = Buffer.from('raw data');
      const result = parsePayload(0xff as MessageType, buffer);
      expect(result).toBe(buffer);
    });
  });
});
