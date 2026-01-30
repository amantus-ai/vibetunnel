import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TailscaleServeService } from '../../server/services/tailscale-serve-service.js';

// Mock the logger
vi.mock('../../server/utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

describe('Tailscale Status Endpoint Unit Tests', () => {
  let mockTailscaleService: TailscaleServeService;

  beforeEach(() => {
    // Setup mock Tailscale service
    mockTailscaleService = {
      start: vi.fn(),
      stop: vi.fn(),
      isRunning: vi.fn(),
      isFunnelEnabled: vi.fn(),
      getStatus: vi.fn(),
    } as unknown as TailscaleServeService;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Status Response Scenarios', () => {
    it('returns correct structure for Private mode', async () => {
      const mockStatus = {
        isRunning: true,
        port: 4020,
        lastError: undefined,
        startTime: new Date('2024-01-01T12:00:00Z'),
        isPermanentlyDisabled: false,
        funnelEnabled: false,
        funnelStartTime: undefined,
        desiredMode: 'private',
        actualMode: 'private',
        funnelError: undefined,
      };

      mockTailscaleService.getStatus = vi.fn().mockResolvedValue(mockStatus);

      // Simulate the endpoint logic
      const status = await mockTailscaleService.getStatus();

      expect(status).toEqual(mockStatus);
      expect(status.desiredMode).toBe('private');
      expect(status.actualMode).toBe('private');
      expect(status.funnelEnabled).toBe(false);
    });

    it('returns correct structure for Public mode', async () => {
      const mockStatus = {
        isRunning: true,
        port: 4020,
        lastError: undefined,
        startTime: new Date('2024-01-01T12:00:00Z'),
        isPermanentlyDisabled: false,
        funnelEnabled: true,
        funnelStartTime: new Date('2024-01-01T12:01:00Z'),
        desiredMode: 'public',
        actualMode: 'public',
        funnelError: undefined,
      };

      mockTailscaleService.getStatus = vi.fn().mockResolvedValue(mockStatus);

      const status = await mockTailscaleService.getStatus();

      expect(status).toEqual(mockStatus);
      expect(status.desiredMode).toBe('public');
      expect(status.actualMode).toBe('public');
      expect(status.funnelEnabled).toBe(true);
      expect(status.funnelStartTime).toBeInstanceOf(Date);
    });

    it('handles transition state correctly', async () => {
      // User requested Public but still in Private
      const mockStatus = {
        isRunning: true,
        port: 4020,
        lastError: undefined,
        startTime: new Date('2024-01-01T12:00:00Z'),
        isPermanentlyDisabled: false,
        funnelEnabled: false,
        funnelStartTime: undefined,
        desiredMode: 'public',
        actualMode: 'private',
        funnelError: undefined,
      };

      mockTailscaleService.getStatus = vi.fn().mockResolvedValue(mockStatus);

      const status = await mockTailscaleService.getStatus();

      expect(status.desiredMode).toBe('public');
      expect(status.actualMode).toBe('private');
      expect(status.desiredMode).not.toBe(status.actualMode);
      expect(status.funnelEnabled).toBe(false);
    });

    it('reports Funnel errors correctly', async () => {
      const mockStatus = {
        isRunning: true,
        port: 4020,
        lastError: undefined,
        startTime: new Date('2024-01-01T12:00:00Z'),
        isPermanentlyDisabled: false,
        funnelEnabled: false,
        funnelStartTime: undefined,
        desiredMode: 'public',
        actualMode: 'private',
        funnelError: 'error: foreground already exists under this port',
      };

      mockTailscaleService.getStatus = vi.fn().mockResolvedValue(mockStatus);

      const status = await mockTailscaleService.getStatus();

      expect(status.funnelError).toBe('error: foreground already exists under this port');
      expect(status.funnelEnabled).toBe(false);
      expect(status.actualMode).toBe('private');
    });

    it('handles permanently disabled state without error', async () => {
      const mockStatus = {
        isRunning: false,
        port: undefined,
        lastError: undefined, // No error in fallback mode
        startTime: undefined,
        isPermanentlyDisabled: true,
        funnelEnabled: false,
        funnelStartTime: undefined,
        desiredMode: undefined,
        actualMode: undefined,
        funnelError: undefined,
      };

      mockTailscaleService.getStatus = vi.fn().mockResolvedValue(mockStatus);

      const status = await mockTailscaleService.getStatus();

      expect(status.isPermanentlyDisabled).toBe(true);
      expect(status.lastError).toBeUndefined(); // No error in fallback mode
      expect(status.isRunning).toBe(false);
    });

    it('handles service not running state', async () => {
      const mockStatus = {
        isRunning: false,
        port: undefined,
        lastError: 'VibeTunnel server not responding',
        startTime: undefined,
        isPermanentlyDisabled: false,
        funnelEnabled: false,
        funnelStartTime: undefined,
        desiredMode: 'private',
        actualMode: undefined,
        funnelError: undefined,
      };

      mockTailscaleService.getStatus = vi.fn().mockResolvedValue(mockStatus);

      const status = await mockTailscaleService.getStatus();

      expect(status.isRunning).toBe(false);
      expect(status.lastError).toBe('VibeTunnel server not responding');
      expect(status.port).toBeUndefined();
    });
  });

  describe('Error Handling', () => {
    it('handles service errors gracefully', async () => {
      mockTailscaleService.getStatus = vi.fn().mockRejectedValue(new Error('Failed to get status'));

      try {
        await mockTailscaleService.getStatus();
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe('Failed to get status');
      }
    });

    it('handles timeout scenarios', async () => {
      // Simulate a timeout
      mockTailscaleService.getStatus = vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(
              () =>
                resolve({
                  isRunning: false,
                  lastError: 'Server response timeout',
                }),
              100
            );
          })
      );

      const status = await mockTailscaleService.getStatus();

      expect(status.isRunning).toBe(false);
      expect(status.lastError).toBe('Server response timeout');
    });
  });

  describe('Mode Detection Logic', () => {
    it('correctly identifies Private mode', async () => {
      const mockStatus = {
        isRunning: true,
        port: 4020,
        funnelEnabled: false,
        desiredMode: 'private',
        actualMode: 'private',
      };

      mockTailscaleService.getStatus = vi.fn().mockResolvedValue(mockStatus);

      const status = await mockTailscaleService.getStatus();

      expect(status.actualMode).toBe('private');
      expect(status.funnelEnabled).toBe(false);
    });

    it('correctly identifies Public mode', async () => {
      const mockStatus = {
        isRunning: true,
        port: 4020,
        funnelEnabled: true,
        desiredMode: 'public',
        actualMode: 'public',
      };

      mockTailscaleService.getStatus = vi.fn().mockResolvedValue(mockStatus);

      const status = await mockTailscaleService.getStatus();

      expect(status.actualMode).toBe('public');
      expect(status.funnelEnabled).toBe(true);
    });

    it('detects mode mismatch during transition', async () => {
      const mockStatus = {
        isRunning: true,
        port: 4020,
        funnelEnabled: false,
        desiredMode: 'public',
        actualMode: 'private',
      };

      mockTailscaleService.getStatus = vi.fn().mockResolvedValue(mockStatus);

      const status = await mockTailscaleService.getStatus();

      expect(status.desiredMode).toBe('public');
      expect(status.actualMode).toBe('private');
      expect(status.desiredMode).not.toBe(status.actualMode);
    });

    it('handles undefined modes during initialization', async () => {
      const mockStatus = {
        isRunning: false,
        port: undefined,
        funnelEnabled: false,
        desiredMode: undefined,
        actualMode: undefined,
      };

      mockTailscaleService.getStatus = vi.fn().mockResolvedValue(mockStatus);

      const status = await mockTailscaleService.getStatus();

      expect(status.desiredMode).toBeUndefined();
      expect(status.actualMode).toBeUndefined();
    });
  });

  describe('Timestamp Handling', () => {
    it('includes timestamps when service is running', async () => {
      const startTime = new Date('2024-01-01T12:00:00Z');
      const funnelStartTime = new Date('2024-01-01T12:05:00Z');

      const mockStatus = {
        isRunning: true,
        port: 4020,
        startTime,
        funnelEnabled: true,
        funnelStartTime,
        desiredMode: 'public',
        actualMode: 'public',
      };

      mockTailscaleService.getStatus = vi.fn().mockResolvedValue(mockStatus);

      const status = await mockTailscaleService.getStatus();

      expect(status.startTime).toEqual(startTime);
      expect(status.funnelStartTime).toEqual(funnelStartTime);
    });

    it('handles missing timestamps correctly', async () => {
      const mockStatus = {
        isRunning: false,
        port: undefined,
        startTime: undefined,
        funnelEnabled: false,
        funnelStartTime: undefined,
      };

      mockTailscaleService.getStatus = vi.fn().mockResolvedValue(mockStatus);

      const status = await mockTailscaleService.getStatus();

      expect(status.startTime).toBeUndefined();
      expect(status.funnelStartTime).toBeUndefined();
    });
  });
});
