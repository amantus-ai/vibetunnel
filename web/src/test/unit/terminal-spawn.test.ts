import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ControlMessage,
  TerminalSpawnResponse,
} from '../../server/websocket/control-protocol.js';

// Mock the control unix handler
vi.mock('../../server/websocket/control-unix-handler.js', () => ({
  controlUnixHandler: {
    sendControlMessage: vi.fn(),
  },
}));

// Import after mocking
import { requestTerminalSpawn } from '../../server/routes/sessions.js';
import { controlUnixHandler } from '../../server/websocket/control-unix-handler.js';

// Get the mocked function
const mockSendControlMessage = vi.mocked(controlUnixHandler.sendControlMessage);

describe('requestTerminalSpawn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const testParams = {
    sessionId: 'test-session-123',
    sessionName: 'Test Session',
    command: ['bash', '-l'],
    workingDir: '/Users/test',
  };

  describe('successful terminal spawn', () => {
    it('should return success when Mac app responds with success payload', async () => {
      // Mock successful response from Mac app
      const mockResponse: ControlMessage = {
        id: 'response-123',
        type: 'response',
        category: 'terminal',
        action: 'spawn',
        payload: { success: true } as TerminalSpawnResponse, // This should be a plain object, not base64
        sessionId: testParams.sessionId,
      };

      mockSendControlMessage.mockResolvedValue(mockResponse);

      const result = await requestTerminalSpawn(testParams);

      expect(result).toEqual({
        success: true,
        error: undefined,
      });

      // Verify the correct control message was sent
      expect(mockSendControlMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'request',
          category: 'terminal',
          action: 'spawn',
          payload: {
            sessionId: testParams.sessionId,
            workingDirectory: testParams.workingDir,
            command: testParams.command.join(' '),
            terminalPreference: null,
          },
          sessionId: testParams.sessionId,
        })
      );
    });

    it('should handle success payload with additional fields', async () => {
      const mockResponse: ControlMessage = {
        id: 'response-456',
        type: 'response',
        category: 'terminal',
        action: 'spawn',
        payload: {
          success: true,
          pid: 12345,
        } as TerminalSpawnResponse,
        sessionId: testParams.sessionId,
      };

      mockSendControlMessage.mockResolvedValue(mockResponse);

      const result = await requestTerminalSpawn(testParams);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  describe('failed terminal spawn', () => {
    it('should return failure when Mac app responds with success: false', async () => {
      const mockResponse: ControlMessage = {
        id: 'response-789',
        type: 'response',
        category: 'terminal',
        action: 'spawn',
        payload: { success: false } as TerminalSpawnResponse,
        sessionId: testParams.sessionId,
      };

      mockSendControlMessage.mockResolvedValue(mockResponse);

      const result = await requestTerminalSpawn(testParams);

      expect(result).toEqual({
        success: false,
        error: 'Terminal spawn failed',
      });
    });

    it('should return failure when Mac app responds with error', async () => {
      const mockResponse: ControlMessage = {
        id: 'response-error',
        type: 'response',
        category: 'terminal',
        action: 'spawn',
        error: 'Permission denied',
        sessionId: testParams.sessionId,
      };

      mockSendControlMessage.mockResolvedValue(mockResponse);

      const result = await requestTerminalSpawn(testParams);

      expect(result).toEqual({
        success: false,
        error: 'Permission denied',
      });
    });

    it('should handle no response from Mac app', async () => {
      mockSendControlMessage.mockResolvedValue(null);

      const result = await requestTerminalSpawn(testParams);

      expect(result).toEqual({
        success: false,
        error: 'No response from Mac app',
      });
    });

    it('should handle missing payload', async () => {
      const mockResponse: ControlMessage = {
        id: 'response-no-payload',
        type: 'response',
        category: 'terminal',
        action: 'spawn',
        sessionId: testParams.sessionId,
        // No payload field
      };

      mockSendControlMessage.mockResolvedValue(mockResponse);

      const result = await requestTerminalSpawn(testParams);

      expect(result).toEqual({
        success: false,
        error: 'Terminal spawn failed',
      });
    });

    it('should handle payload without success field', async () => {
      const mockResponse: ControlMessage = {
        id: 'response-no-success',
        type: 'response',
        category: 'terminal',
        action: 'spawn',
        payload: { message: 'some other data' } as any, // No success field
        sessionId: testParams.sessionId,
      };

      mockSendControlMessage.mockResolvedValue(mockResponse);

      const result = await requestTerminalSpawn(testParams);

      expect(result).toEqual({
        success: false,
        error: 'Terminal spawn failed',
      });
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle sendControlMessage throwing an exception', async () => {
      mockSendControlMessage.mockRejectedValue(new Error('Connection lost'));

      const result = await requestTerminalSpawn(testParams);

      expect(result).toEqual({
        success: false,
        error: 'Connection lost',
      });
    });

    it('should handle sendControlMessage throwing non-Error object', async () => {
      mockSendControlMessage.mockRejectedValue('String error');

      const result = await requestTerminalSpawn(testParams);

      expect(result).toEqual({
        success: false,
        error: 'Unknown error',
      });
    });

    it('should properly encode command array as space-separated string', async () => {
      const paramsWithComplexCommand = {
        ...testParams,
        command: ['git', 'log', '--oneline', '--graph'],
      };

      const mockResponse: ControlMessage = {
        id: 'response-cmd',
        type: 'response',
        category: 'terminal',
        action: 'spawn',
        payload: { success: true } as TerminalSpawnResponse,
        sessionId: testParams.sessionId,
      };

      mockSendControlMessage.mockResolvedValue(mockResponse);

      await requestTerminalSpawn(paramsWithComplexCommand);

      expect(mockSendControlMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            command: 'git log --oneline --graph',
          }),
        })
      );
    });

    it('should include titleMode when provided', async () => {
      const paramsWithTitleMode = {
        ...testParams,
        titleMode: 'command' as const,
      };

      const mockResponse: ControlMessage = {
        id: 'response-title',
        type: 'response',
        category: 'terminal',
        action: 'spawn',
        payload: { success: true } as TerminalSpawnResponse,
        sessionId: testParams.sessionId,
      };

      mockSendControlMessage.mockResolvedValue(mockResponse);

      await requestTerminalSpawn(paramsWithTitleMode);

      // The titleMode is passed in the params but doesn't affect the control message
      // It's used elsewhere in the calling code
      expect(mockSendControlMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            command: testParams.command.join(' '),
          }),
        })
      );
    });
  });

  describe('regression test for base64 encoding bug', () => {
    it('should correctly read success from plain JSON object payload (not base64)', async () => {
      // This test specifically verifies that the server expects plain JSON objects
      // from the Mac app, not base64-encoded payloads

      const mockResponse: ControlMessage = {
        id: 'regression-test',
        type: 'response',
        category: 'terminal',
        action: 'spawn',
        payload: { success: true } as TerminalSpawnResponse, // This is a plain object, NOT base64
        sessionId: testParams.sessionId,
      };

      mockSendControlMessage.mockResolvedValue(mockResponse);

      const result = await requestTerminalSpawn(testParams);

      // Should successfully read the success field from the plain object
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should fail if payload were incorrectly base64-encoded (simulates old bug)', async () => {
      // This simulates what would happen if the Mac app still sent base64
      const base64Payload = Buffer.from(JSON.stringify({ success: true })).toString('base64');

      const mockResponse: ControlMessage = {
        id: 'base64-bug-test',
        type: 'response',
        category: 'terminal',
        action: 'spawn',
        payload: base64Payload as any, // This would be wrong - payload should be object
        sessionId: testParams.sessionId,
      };

      mockSendControlMessage.mockResolvedValue(mockResponse);

      const result = await requestTerminalSpawn(testParams);

      // Should fail because string.success is undefined
      expect(result.success).toBe(false);
      expect(result.error).toBe('Terminal spawn failed');
    });
  });
});
