/**
 * Unix socket protocol for VibeTunnel IPC
 *
 * Message format (binary):
 * [1 byte: message type]
 * [4 bytes: payload length (big-endian)]
 * [N bytes: payload]
 */

import { Buffer } from 'buffer';

/**
 * Message types for the socket protocol
 */
export enum MessageType {
  STDIN_DATA = 0x01, // Raw stdin data (keyboard input)
  CONTROL_CMD = 0x02, // Control commands (resize, kill, etc)
  STATUS_UPDATE = 0x03, // Status updates (Claude status, etc)
  HEARTBEAT = 0x04, // Keep-alive ping/pong
  ERROR = 0x05, // Error messages
  // Reserved for future use
  STDOUT_SUBSCRIBE = 0x10,
  METRICS = 0x11,
}

/**
 * Control command types
 */
export interface ControlCommand {
  cmd: string;
  [key: string]: unknown;
}

export interface ResizeCommand extends ControlCommand {
  cmd: 'resize';
  cols: number;
  rows: number;
}

export interface KillCommand extends ControlCommand {
  cmd: 'kill';
  signal?: string | number;
}

export interface ResetSizeCommand extends ControlCommand {
  cmd: 'reset-size';
}

export interface UpdateTitleCommand extends ControlCommand {
  cmd: 'update-title';
  title: string;
}

/**
 * Status update payload
 */
export interface StatusUpdate {
  app: string;
  status: string;
  timestamp?: number;
  [key: string]: unknown;
}

/**
 * Error message payload
 */
export interface ErrorMessage {
  code: string;
  message: string;
  details?: unknown;
}

/**
 * Frame a message for transmission
 */
export function frameMessage(type: MessageType, payload: Buffer | string | object): Buffer {
  const payloadBuffer = Buffer.isBuffer(payload)
    ? payload
    : Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload), 'utf8');

  const message = Buffer.allocUnsafe(5 + payloadBuffer.length);
  message[0] = type;
  message.writeUInt32BE(payloadBuffer.length, 1);
  payloadBuffer.copy(message, 5);

  return message;
}

/**
 * Parse messages from a buffer
 */
export class MessageParser {
  private buffer = Buffer.alloc(0);

  /**
   * Add data to the parser
   */
  addData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
  }

  /**
   * Parse complete messages from the buffer
   */
  *parseMessages(): Generator<{ type: MessageType; payload: Buffer }> {
    while (this.buffer.length >= 5) {
      const messageType = this.buffer[0] as MessageType;
      const payloadLength = this.buffer.readUInt32BE(1);

      // Check if we have the complete message
      if (this.buffer.length < 5 + payloadLength) {
        break;
      }

      // Extract the message
      const payload = this.buffer.subarray(5, 5 + payloadLength);
      this.buffer = this.buffer.subarray(5 + payloadLength);

      yield { type: messageType, payload };
    }
  }

  /**
   * Get the number of bytes waiting to be parsed
   */
  get pendingBytes(): number {
    return this.buffer.length;
  }

  /**
   * Clear the buffer
   */
  clear(): void {
    this.buffer = Buffer.alloc(0);
  }
}

/**
 * High-level message creation helpers
 */
export const MessageBuilder = {
  stdin(data: string): Buffer {
    return frameMessage(MessageType.STDIN_DATA, data);
  },

  resize(cols: number, rows: number): Buffer {
    return frameMessage(MessageType.CONTROL_CMD, { cmd: 'resize', cols, rows });
  },

  kill(signal?: string | number): Buffer {
    return frameMessage(MessageType.CONTROL_CMD, { cmd: 'kill', signal });
  },

  resetSize(): Buffer {
    return frameMessage(MessageType.CONTROL_CMD, { cmd: 'reset-size' });
  },

  updateTitle(title: string): Buffer {
    return frameMessage(MessageType.CONTROL_CMD, { cmd: 'update-title', title });
  },

  status(app: string, status: string, extra?: Record<string, unknown>): Buffer {
    return frameMessage(MessageType.STATUS_UPDATE, { app, status, ...extra });
  },

  heartbeat(): Buffer {
    return frameMessage(MessageType.HEARTBEAT, Buffer.alloc(0));
  },

  error(code: string, message: string, details?: unknown): Buffer {
    return frameMessage(MessageType.ERROR, { code, message, details });
  },
} as const;

/**
 * Parse payload based on message type
 */
export function parsePayload(type: MessageType, payload: Buffer): unknown {
  switch (type) {
    case MessageType.STDIN_DATA:
      return payload.toString('utf8');

    case MessageType.CONTROL_CMD:
    case MessageType.STATUS_UPDATE:
    case MessageType.ERROR:
      return JSON.parse(payload.toString('utf8'));

    case MessageType.HEARTBEAT:
      return null;

    default:
      return payload;
  }
}
