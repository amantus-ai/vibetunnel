import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MDNSService } from '../../../server/services/mdns-service';

// Mock the logger
vi.mock('../../../server/utils/logger.js', () => ({
  createLogger: vi.fn().mockReturnValue({
    warn: vi.fn(),
    log: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock bonjour-service
const mockService = {
  on: vi.fn(),
  stop: vi.fn((callback) => callback?.()),
};

const mockBonjour = {
  publish: vi.fn().mockReturnValue(mockService),
  destroy: vi.fn(),
};

vi.mock('bonjour-service', () => ({
  default: vi.fn().mockImplementation(() => mockBonjour),
}));

// Mock os
vi.mock('node:os', () => ({
  default: {
    hostname: vi.fn().mockReturnValue('test-hostname'),
  },
}));

describe('MDNSService', () => {
  let mdnsService: MDNSService;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    mdnsService = new MDNSService();
  });

  afterEach(async () => {
    try {
      await mdnsService?.stopAdvertising();
    } catch {
      // Ignore errors in cleanup
    }
  });

  describe('Core Functionality', () => {
    it('should start advertising and create service', async () => {
      // Given
      const port = 4020;

      // When
      await mdnsService.startAdvertising(port);

      // Then
      expect(mockBonjour.publish).toHaveBeenCalledWith({
        name: 'test-hostname',
        type: 'vibetunnel',
        port: port,
        txt: {
          version: '1.0',
          platform: expect.any(String),
        },
      });
      expect(mdnsService.isActive()).toBe(true);
    });

    it('should stop advertising and remove service', async () => {
      // Given
      const port = 4020;
      await mdnsService.startAdvertising(port);

      // When
      await mdnsService.stopAdvertising();

      // Then
      expect(mockService.stop).toHaveBeenCalled();
      expect(mockBonjour.destroy).toHaveBeenCalled();
      expect(mdnsService.isActive()).toBe(false);
    });

    it('should include hostname in service name', async () => {
      // Given
      const port = 4020;
      const expectedName = 'test-hostname';

      // When
      await mdnsService.startAdvertising(port);

      // Then
      expect(mockBonjour.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          name: expectedName,
        })
      );
    });
  });

  describe('Service Events', () => {
    it('should register event handlers on service', async () => {
      // Given
      const port = 4020;

      // When
      await mdnsService.startAdvertising(port);

      // Then
      expect(mockService.on).toHaveBeenCalledWith('up', expect.any(Function));
      expect(mockService.on).toHaveBeenCalledWith('error', expect.any(Function));
    });
  });

  describe('Service Lifecycle', () => {
    it('should not create multiple services on repeated start calls', async () => {
      // Given
      const port = 4020;

      // When
      await mdnsService.startAdvertising(port);
      await mdnsService.startAdvertising(port); // Second call
      await mdnsService.startAdvertising(port); // Third call

      // Then - publish should only be called once
      expect(mockBonjour.publish).toHaveBeenCalledTimes(1);
    });

    it('should handle stop when not started', async () => {
      // When
      await expect(mdnsService.stopAdvertising()).resolves.not.toThrow();

      // Then - should not crash
      expect(mdnsService.isActive()).toBe(false);
    });

    it('should publish with correct service type', async () => {
      // Given
      const port = 4020;

      // When
      await mdnsService.startAdvertising(port);

      // Then
      expect(mockBonjour.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'vibetunnel',
        })
      );
    });

    it('should include metadata in TXT records', async () => {
      // Given
      const port = 4020;

      // When
      await mdnsService.startAdvertising(port);

      // Then
      expect(mockBonjour.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          txt: expect.objectContaining({
            version: '1.0',
            platform: expect.any(String),
          }),
        })
      );
    });
  });
});
