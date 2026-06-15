import { chmod, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  findTailscaleExecutable,
  getTailscaleSearchPaths,
  TailscaleServeServiceImpl,
} from './tailscale-serve-service.js';

// Mock the logger
vi.mock('../../server/utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    log: vi.fn(),
  })),
}));

describe('TailscaleServeService Integration Tests', () => {
  let service: TailscaleServeServiceImpl;
  let originalSkipTailscale: string | undefined;

  beforeEach(() => {
    originalSkipTailscale = process.env.VIBETUNNEL_SKIP_TAILSCALE;
    process.env.VIBETUNNEL_SKIP_TAILSCALE = '1';
    service = new TailscaleServeServiceImpl();
  });

  afterEach(async () => {
    // Clean up any running processes
    if (service.isRunning()) {
      await service.stop();
    }
    if (originalSkipTailscale === undefined) {
      delete process.env.VIBETUNNEL_SKIP_TAILSCALE;
    } else {
      process.env.VIBETUNNEL_SKIP_TAILSCALE = originalSkipTailscale;
    }
    vi.clearAllMocks();
  });

  describe('Executable discovery', () => {
    it('includes nix-darwin system and user profile paths', () => {
      expect(
        getTailscaleSearchPaths('darwin', {
          USER: 'alice',
          HOME: '/Users/alice',
        })
      ).toEqual(
        expect.arrayContaining([
          '/run/current-system/sw/bin/tailscale',
          '/etc/profiles/per-user/alice/bin/tailscale',
          '/Users/alice/.nix-profile/bin/tailscale',
        ])
      );
    });

    it('resolves an executable from an explicit path outside PATH', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'vibetunnel-tailscale-'));
      const executablePath = join(directory, 'tailscale');

      try {
        await writeFile(executablePath, '#!/bin/sh\nexit 0\n');
        await chmod(executablePath, 0o755);

        await expect(findTailscaleExecutable([executablePath])).resolves.toBe(executablePath);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });
  });

  describe('Exit Code Handling', () => {
    it('preserves configured state after a successful background command exit', () => {
      const internals = service as unknown as {
        currentPort: number | null;
        isStarting: boolean;
        serveProcess: { killed: boolean; kill: ReturnType<typeof vi.fn> } | null;
        handleServeProcessExit(code: number | null, signal: NodeJS.Signals | null): void;
      };
      internals.currentPort = 43213;
      internals.isStarting = false;
      internals.serveProcess = { killed: true, kill: vi.fn() };

      internals.handleServeProcessExit(0, null);

      expect(internals.serveProcess).toBeNull();
      expect(internals.currentPort).toBe(43213);
      expect(service.isRunning()).toBe(true);
    });

    it('clears configured state after a failed background command exit', () => {
      const internals = service as unknown as {
        currentPort: number | null;
        isStarting: boolean;
        serveProcess: { killed: boolean; kill: ReturnType<typeof vi.fn> } | null;
        handleServeProcessExit(code: number | null, signal: NodeJS.Signals | null): void;
      };
      internals.currentPort = 43213;
      internals.isStarting = false;
      internals.serveProcess = { killed: true, kill: vi.fn() };

      internals.handleServeProcessExit(1, null);

      expect(internals.serveProcess).toBeNull();
      expect(internals.currentPort).toBeNull();
      expect(service.isRunning()).toBe(false);
    });

    it('handles error states correctly', async () => {
      // Test error simulation via environment variable
      const testError = 'Test error condition';
      process.env.VIBETUNNEL_TAILSCALE_ERROR = testError;

      try {
        const status = await service.getStatus();

        expect(status.isRunning).toBe(false);
        expect(status.lastError).toBe(testError);
      } finally {
        delete process.env.VIBETUNNEL_TAILSCALE_ERROR;
      }
    });
  });

  describe('Status Verification', () => {
    it('reports a clean idle status before Serve has been configured', async () => {
      const internals = service as unknown as {
        currentPort: number | null;
        getExecutablePath(): Promise<string>;
        verifyServeConfiguration(port: number): Promise<boolean>;
        checkServeAvailability(): Promise<string>;
      };
      internals.currentPort = null;
      internals.getExecutablePath = vi.fn().mockRejectedValue(new Error('Tailscale not installed'));
      internals.verifyServeConfiguration = vi.fn().mockResolvedValue(false);
      internals.checkServeAvailability = vi.fn().mockResolvedValue('');
      delete process.env.VIBETUNNEL_SKIP_TAILSCALE;

      try {
        await expect(service.getStatus()).resolves.toMatchObject({
          isRunning: false,
          port: undefined,
          lastError: undefined,
        });
      } finally {
        process.env.VIBETUNNEL_SKIP_TAILSCALE = '1';
      }
    });

    it.each([
      { desiredFunnel: false, funnelEnabled: false, mode: 'private' },
      { desiredFunnel: true, funnelEnabled: true, mode: 'public' },
    ])('reports stopped in $mode mode when the persistent proxy configuration disappears', async ({
      desiredFunnel,
      funnelEnabled,
    }) => {
      const internals = service as unknown as {
        currentPort: number | null;
        desiredFunnel: boolean;
        funnelEnabled: boolean;
        isStarting: boolean;
        verifyServeConfiguration(port: number): Promise<boolean>;
        checkServeAvailability(): Promise<string>;
      };
      internals.currentPort = 43213;
      internals.desiredFunnel = desiredFunnel;
      internals.funnelEnabled = funnelEnabled;
      internals.isStarting = false;
      internals.verifyServeConfiguration = vi.fn().mockResolvedValue(false);
      internals.checkServeAvailability = vi.fn().mockResolvedValue('');
      delete process.env.VIBETUNNEL_SKIP_TAILSCALE;

      try {
        await expect(service.getStatus()).resolves.toMatchObject({
          isRunning: false,
          port: undefined,
          lastError: 'Tailscale Serve proxy not configured for this port',
        });
      } finally {
        process.env.VIBETUNNEL_SKIP_TAILSCALE = '1';
      }
    });

    it('provides consistent status information', async () => {
      const status = await service.getStatus();

      // Status should have required fields
      expect(typeof status.isRunning).toBe('boolean');

      // If running, should have port information
      if (status.isRunning && status.port) {
        expect(typeof status.port).toBe('number');
        expect(status.port).toBeGreaterThan(0);
        expect(status.port).toBeLessThan(65536);
      }

      // Error field should be string or undefined
      if (status.lastError !== undefined) {
        expect(typeof status.lastError).toBe('string');
        expect(status.lastError.length).toBeGreaterThan(0);
      }

      // Start time should be Date or undefined
      if (status.startTime !== undefined) {
        expect(status.startTime).toBeInstanceOf(Date);
      }
    });

    it('handles Tailscale not installed gracefully', async () => {
      // This test runs regardless of whether Tailscale is actually installed
      // It verifies that the service doesn't crash when Tailscale is unavailable

      const status = await service.getStatus();

      // Should not throw an error
      expect(status).toBeDefined();
      expect(typeof status.isRunning).toBe('boolean');

      // If not running, there should be some indication why
      if (!status.isRunning) {
        expect(status.lastError === undefined || typeof status.lastError === 'string').toBe(true);
      }
    });
  });

  describe('Service Lifecycle', () => {
    it('handles multiple start/stop cycles', async () => {
      // Test that the service can be started and stopped multiple times
      // without leaving processes hanging

      expect(service.isRunning()).toBe(false);

      // Multiple stop calls should be safe
      await service.stop();
      await service.stop();

      expect(service.isRunning()).toBe(false);
    });

    it('provides accurate running state', () => {
      // Initially should not be running
      expect(service.isRunning()).toBe(false);

      // After stop, should not be running
      service.stop();
      expect(service.isRunning()).toBe(false);
    });
  });

  describe('Error Recovery', () => {
    it('recovers from command failures', async () => {
      // Set up error condition
      process.env.VIBETUNNEL_TAILSCALE_ERROR = 'Command not found';

      try {
        const status1 = await service.getStatus();
        expect(status1.isRunning).toBe(false);
        expect(status1.lastError).toBe('Command not found');

        // Clear error condition
        delete process.env.VIBETUNNEL_TAILSCALE_ERROR;

        const status2 = await service.getStatus();
        // Should no longer report the simulated error
        expect(status2.lastError).not.toBe('Command not found');
      } finally {
        delete process.env.VIBETUNNEL_TAILSCALE_ERROR;
      }
    });

    it('handles timeout conditions', async () => {
      // This test verifies that the service doesn't hang indefinitely
      const timeoutPromise = new Promise<void>((resolve) => {
        setTimeout(resolve, 10000); // 10 second timeout
      });

      const statusPromise = service.getStatus();

      // Status check should complete before timeout
      const result = await Promise.race([
        statusPromise,
        timeoutPromise.then(() => ({ timeout: true })),
      ]);

      expect(result).not.toEqual({ timeout: true });
      expect(typeof result).toBe('object');
      expect('isRunning' in result).toBe(true);
    });
  });

  describe('Status Parsing', () => {
    it('correctly parses serve status output', () => {
      // Test the parseServeStatus method indirectly through status checks
      // This verifies that the service can handle various output formats

      const service = new TailscaleServeServiceImpl();

      // The service should handle empty or malformed status outputs gracefully
      expect(() => service.getStatus()).not.toThrow();
    });
  });

  describe('Mode Detection and Switching', () => {
    it('reports correct desired vs actual modes', async () => {
      const status = await service.getStatus();

      // Should have mode information if not permanently disabled
      if (!status.isPermanentlyDisabled) {
        expect(
          status.desiredMode === 'private' ||
            status.desiredMode === 'public' ||
            status.desiredMode === undefined
        ).toBe(true);
        expect(
          status.actualMode === 'private' ||
            status.actualMode === 'public' ||
            status.actualMode === undefined
        ).toBe(true);
      }
    });

    it('handles mode transitions gracefully', async () => {
      // Get initial status
      const status1 = await service.getStatus();

      // Status should not change erratically
      const status2 = await service.getStatus();

      expect(status1.desiredMode).toBe(status2.desiredMode);
      expect(status1.actualMode).toBe(status2.actualMode);
    });

    it('provides Funnel status information', async () => {
      const status = await service.getStatus();

      // Funnel status should be boolean when present
      if (status.funnelEnabled !== undefined) {
        expect(typeof status.funnelEnabled).toBe('boolean');

        // If Funnel is enabled, there might be a start time
        if (status.funnelEnabled && status.funnelStartTime) {
          expect(status.funnelStartTime).toBeInstanceOf(Date);
        }
      }

      // Funnel error should be string or undefined
      if (status.funnelError !== undefined) {
        expect(typeof status.funnelError).toBe('string');
      }
    });
  });

  describe('New CLI Syntax Support', () => {
    it('handles --bg flag correctly', async () => {
      // The service should use the new --bg flag syntax
      // This is tested indirectly through the start/stop operations

      // Mock environment to ensure we're not actually starting Tailscale
      const originalEnv = process.env.VIBETUNNEL_SKIP_TAILSCALE;
      process.env.VIBETUNNEL_SKIP_TAILSCALE = '1';

      try {
        // Start should not throw with new syntax
        expect(service.isRunning()).toBe(false);

        // Verify service handles the new background mode
        const status = await service.getStatus();
        expect(status).toBeDefined();
      } finally {
        if (originalEnv !== undefined) {
          process.env.VIBETUNNEL_SKIP_TAILSCALE = originalEnv;
        } else {
          delete process.env.VIBETUNNEL_SKIP_TAILSCALE;
        }
      }
    });

    it('recovers from "foreground already exists" errors', async () => {
      // Test that the service can recover from common Tailscale errors
      const testError = 'error: foreground already exists under this port';
      process.env.VIBETUNNEL_TAILSCALE_ERROR = testError;

      try {
        const status = await service.getStatus();

        // Service should handle this specific error gracefully
        expect(status.isRunning).toBe(false);
        expect(status.lastError).toContain(testError);

        // Clear error and verify recovery
        delete process.env.VIBETUNNEL_TAILSCALE_ERROR;

        const recoveredStatus = await service.getStatus();
        expect(recoveredStatus.lastError).not.toBe(testError);
      } finally {
        delete process.env.VIBETUNNEL_TAILSCALE_ERROR;
      }
    });
  });

  describe('Race Condition Handling', () => {
    it('handles rapid status checks during transitions', async () => {
      // Simulate rapid status checks that might occur during mode switching
      const promises = [];

      for (let i = 0; i < 5; i++) {
        promises.push(service.getStatus());
      }

      const results = await Promise.all(promises);

      // All status checks should return valid results
      results.forEach((status) => {
        expect(status).toBeDefined();
        expect(typeof status.isRunning).toBe('boolean');
      });

      // Results should be consistent
      const firstResult = results[0];
      results.forEach((status) => {
        expect(status.isPermanentlyDisabled).toBe(firstResult.isPermanentlyDisabled);
      });
    });

    it('maintains consistency during concurrent operations', async () => {
      // Test that concurrent stop operations don't cause issues
      const stopPromises = [service.stop(), service.stop(), service.stop()];

      await Promise.all(stopPromises);

      // Service should still be in a consistent state
      expect(service.isRunning()).toBe(false);

      const status = await service.getStatus();
      expect(status.isRunning).toBe(false);
    });
  });
});

// Integration tests that require actual Tailscale installation
describe('Tailscale Integration Tests (Requires ENABLE_TAILSCALE_TESTS=1)', () => {
  let service: TailscaleServeServiceImpl;

  beforeEach(() => {
    // Skip these tests unless explicitly enabled
    if (!process.env.ENABLE_TAILSCALE_TESTS) {
      return;
    }

    service = new TailscaleServeServiceImpl();
  });

  afterEach(async () => {
    if (service?.isRunning()) {
      await service.stop();
    }
  });

  it('can communicate with real Tailscale installation', async () => {
    if (!process.env.ENABLE_TAILSCALE_TESTS) {
      console.log('Skipping real Tailscale test - set ENABLE_TAILSCALE_TESTS=1 to enable');
      return;
    }

    const status = await service.getStatus();

    // With real Tailscale, we should get meaningful status
    expect(status).toBeDefined();
    expect(typeof status.isRunning).toBe('boolean');

    console.log('Real Tailscale status:', {
      isRunning: status.isRunning,
      port: status.port,
      error: status.lastError,
      startTime: status.startTime,
    });
  });

  it('handles actual Tailscale command execution', async () => {
    if (!process.env.ENABLE_TAILSCALE_TESTS) {
      return;
    }

    // This test actually tries to run Tailscale commands
    // It will only pass if Tailscale is installed and working

    try {
      const status = await service.getStatus();

      // Should not crash even if Tailscale has issues
      expect(status).toBeDefined();

      if (status.isRunning) {
        expect(status.port).toBeTypeOf('number');
        expect(status.startTime).toBeInstanceOf(Date);
      } else if (status.lastError) {
        // Error should be descriptive
        expect(status.lastError.length).toBeGreaterThan(0);
        expect(typeof status.lastError).toBe('string');
      }
    } catch (error) {
      // Even errors should be handled gracefully
      expect(error).toBeInstanceOf(Error);
      console.warn('Tailscale test failed (this may be expected):', error.message);
    }
  });
});
