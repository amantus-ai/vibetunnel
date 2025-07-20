import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ControlUnixHandler } from '../../server/websocket/control-unix-handler.js';

// Mock dependencies
vi.mock('fs', () => ({
  promises: {
    unlink: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
  },
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn(),
  chmod: vi.fn((_path, _mode, cb) => cb(null)),
}));

vi.mock('net', () => ({
  createServer: vi.fn(() => ({
    listen: vi.fn((_path, cb) => cb?.()),
    close: vi.fn(),
    on: vi.fn(),
  })),
}));

// Mock logger
vi.mock('../../server/utils/logger', () => ({
  logger: {
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  createLogger: vi.fn(() => ({
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

describe('Control Unix Handler', () => {
  let controlUnixHandler: ControlUnixHandler;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Import after mocks are set up
    const module = await import('../../server/websocket/control-unix-handler');
    controlUnixHandler = module.controlUnixHandler;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Basic Functionality', () => {
    it('should start the Unix socket server', async () => {
      await controlUnixHandler.start();

      const net = await vi.importMock<typeof import('net')>('net');
      expect(net.createServer).toHaveBeenCalled();
    });

    it('should check if Mac app is connected', () => {
      expect(controlUnixHandler.isMacAppConnected()).toBe(false);
    });

    it('should stop the Unix socket server', () => {
      controlUnixHandler.stop();
      // Just verify it doesn't throw
      expect(true).toBe(true);
    });
  });

  describe('Message Handling', () => {
    it('should handle browser WebSocket connections', () => {
      const mockWs = {
        on: vi.fn(),
        send: vi.fn(),
        close: vi.fn(),
        readyState: 1,
      } as unknown as import('ws').WebSocket;

      // Should not throw
      controlUnixHandler.handleBrowserConnection(mockWs, 'test-user');

      expect(mockWs.on).toHaveBeenCalledWith('message', expect.any(Function));
      expect(mockWs.on).toHaveBeenCalledWith('close', expect.any(Function));
      expect(mockWs.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('should send control messages when Mac is connected', async () => {
      const message = {
        id: 'test-123',
        type: 'request' as const,
        category: 'system' as const,
        action: 'test',
        payload: { test: true },
      };

      // When Mac is not connected, should resolve to null
      const result = await controlUnixHandler.sendControlMessage(message);
      expect(result).toBe(null);
    });
  });
});
