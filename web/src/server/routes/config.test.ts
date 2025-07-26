import type { Express } from 'express';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuickStartCommand, VibeTunnelConfig } from '../../types/config.js';
import type { ConfigService } from '../services/config-service.js';
import { createConfigRoutes } from './config.js';

describe('Config Routes', () => {
  let app: Express;
  let mockConfigService: ConfigService;

  const defaultConfig: VibeTunnelConfig = {
    version: 1,
    repositoryBasePath: '/home/user/repos',
    quickStartCommands: [
      { name: '✨ claude', command: 'claude' },
      { command: 'zsh' },
      { name: '▶️ pnpm run dev', command: 'pnpm run dev' },
    ],
  };

  beforeEach(() => {
    app = express();
    app.use(express.json());

    // Mock config service
    mockConfigService = {
      getConfig: vi.fn(() => defaultConfig),
      updateQuickStartCommands: vi.fn(),
      updateRepositoryBasePath: vi.fn(),
      updateConfig: vi.fn(),
      startWatching: vi.fn(),
      stopWatching: vi.fn(),
      onConfigChange: vi.fn(),
      getConfigPath: vi.fn(() => '/home/user/.vibetunnel/config.json'),
      getNotificationPreferences: vi.fn(),
      updateNotificationPreferences: vi.fn(),
    } as unknown as ConfigService;

    // Create routes
    const configRoutes = createConfigRoutes({
      configService: mockConfigService,
    });

    app.use('/api', configRoutes);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/config', () => {
    it('should return application configuration', async () => {
      const response = await request(app).get('/api/config');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        repositoryBasePath: '/home/user/repos',
        serverConfigured: true,
        quickStartCommands: defaultConfig.quickStartCommands,
      });

      expect(mockConfigService.getConfig).toHaveBeenCalledOnce();
    });

    it('should use default repository path when not configured', async () => {
      mockConfigService.getConfig = vi.fn(() => ({
        ...defaultConfig,
        repositoryBasePath: null,
      }));

      const response = await request(app).get('/api/config');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        repositoryBasePath: '~/Documents',
        serverConfigured: true,
        quickStartCommands: defaultConfig.quickStartCommands,
      });
    });

    it('should handle config service errors', async () => {
      mockConfigService.getConfig = vi.fn(() => {
        throw new Error('Config read error');
      });

      const response = await request(app).get('/api/config');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        error: 'Failed to get app config',
      });
    });
  });

  describe('PUT /api/config', () => {
    it('should update quick start commands', async () => {
      const newCommands: QuickStartCommand[] = [
        { command: 'python3' },
        { name: '🚀 node', command: 'node' },
      ];

      const response = await request(app)
        .put('/api/config')
        .send({ quickStartCommands: newCommands });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        quickStartCommands: newCommands,
      });

      expect(mockConfigService.updateQuickStartCommands).toHaveBeenCalledWith(newCommands);
    });

    it('should filter out empty commands', async () => {
      const commandsWithEmpty: QuickStartCommand[] = [
        { command: 'python3' },
        { command: '' }, // Empty command
        { name: 'Empty', command: '   ' }, // Whitespace only
        { name: '🚀 node', command: 'node' },
      ];

      const expectedFiltered: QuickStartCommand[] = [
        { command: 'python3' },
        { name: '🚀 node', command: 'node' },
      ];

      const response = await request(app)
        .put('/api/config')
        .send({ quickStartCommands: commandsWithEmpty });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        quickStartCommands: expectedFiltered,
      });

      expect(mockConfigService.updateQuickStartCommands).toHaveBeenCalledWith(expectedFiltered);
    });

    it('should validate command structure', async () => {
      const invalidCommands = [
        { command: 'valid' },
        { notCommand: 'invalid' }, // Missing command field
        null, // Null entry
        { command: 123 }, // Invalid type
      ];

      const expectedValid = [{ command: 'valid' }];

      const response = await request(app)
        .put('/api/config')
        .send({ quickStartCommands: invalidCommands });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        quickStartCommands: expectedValid,
      });

      expect(mockConfigService.updateQuickStartCommands).toHaveBeenCalledWith(expectedValid);
    });

    it('should return 400 for missing quickStartCommands', async () => {
      const response = await request(app).put('/api/config').send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'No valid updates provided',
      });

      expect(mockConfigService.updateQuickStartCommands).not.toHaveBeenCalled();
    });

    it('should return 400 for non-array quickStartCommands', async () => {
      const response = await request(app)
        .put('/api/config')
        .send({ quickStartCommands: 'not-an-array' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'No valid updates provided',
      });

      expect(mockConfigService.updateQuickStartCommands).not.toHaveBeenCalled();
    });

    it('should handle config service update errors', async () => {
      mockConfigService.updateQuickStartCommands = vi.fn(() => {
        throw new Error('Write error');
      });

      const response = await request(app)
        .put('/api/config')
        .send({ quickStartCommands: [{ command: 'test' }] });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        error: 'Failed to update config',
      });
    });

    it('should allow empty array of commands', async () => {
      const response = await request(app).put('/api/config').send({ quickStartCommands: [] });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        quickStartCommands: [],
      });

      expect(mockConfigService.updateQuickStartCommands).toHaveBeenCalledWith([]);
    });

    it('should preserve optional name field', async () => {
      const commandsWithNames: QuickStartCommand[] = [
        { name: 'Python REPL', command: 'python3' },
        { command: 'node' }, // No name
        { name: undefined, command: 'bash' }, // Explicitly undefined
      ];

      const response = await request(app)
        .put('/api/config')
        .send({ quickStartCommands: commandsWithNames });

      expect(response.status).toBe(200);
      expect(mockConfigService.updateQuickStartCommands).toHaveBeenCalledWith(commandsWithNames);
    });

    it('should update repository base path', async () => {
      const newPath = '/new/repo/path';

      const response = await request(app).put('/api/config').send({ repositoryBasePath: newPath });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        repositoryBasePath: newPath,
      });

      expect(mockConfigService.updateRepositoryBasePath).toHaveBeenCalledWith(newPath);
    });

    it('should update both repository base path and quick start commands', async () => {
      const newPath = '/new/repo/path';
      const newCommands = [{ command: 'test' }];

      const response = await request(app).put('/api/config').send({
        repositoryBasePath: newPath,
        quickStartCommands: newCommands,
      });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        repositoryBasePath: newPath,
        quickStartCommands: newCommands,
      });

      expect(mockConfigService.updateRepositoryBasePath).toHaveBeenCalledWith(newPath);
      expect(mockConfigService.updateQuickStartCommands).toHaveBeenCalledWith(newCommands);
    });

    it('should reject invalid repository base path', async () => {
      const response = await request(app).put('/api/config').send({ repositoryBasePath: 123 }); // Not a string

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'No valid updates provided',
      });

      expect(mockConfigService.updateRepositoryBasePath).not.toHaveBeenCalled();
    });
  });

  describe('notification preferences', () => {
    describe('GET /api/config with notification preferences', () => {
      it('should include notification preferences in response', async () => {
        const notificationPreferences = {
          enabled: true,
          sessionStart: false,
          sessionExit: true,
          commandCompletion: true,
          commandError: true,
          bell: true,
          claudeTurn: false,
        };

        mockConfigService.getNotificationPreferences = vi.fn(() => notificationPreferences);

        const response = await request(app).get('/api/config');

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
          repositoryBasePath: '/home/user/repos',
          serverConfigured: true,
          quickStartCommands: defaultConfig.quickStartCommands,
          notificationPreferences,
        });
      });

      it('should handle missing notification preferences', async () => {
        mockConfigService.getNotificationPreferences = vi.fn(() => undefined);

        const response = await request(app).get('/api/config');

        expect(response.status).toBe(200);
        expect(response.body.notificationPreferences).toBeUndefined();
      });
    });

    describe('PUT /api/config with notification preferences', () => {
      it('should update notification preferences', async () => {
        const newPreferences = {
          enabled: false,
          sessionStart: true,
          sessionExit: false,
          commandCompletion: false,
          commandError: false,
          bell: false,
          claudeTurn: true,
        };

        const response = await request(app)
          .put('/api/config')
          .send({ notificationPreferences: newPreferences });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
          success: true,
          notificationPreferences: newPreferences,
        });

        expect(mockConfigService.updateNotificationPreferences).toHaveBeenCalledWith(
          newPreferences
        );
      });

      it('should update notification preferences along with other settings', async () => {
        const newPath = '/new/repository/path';
        const newPreferences = {
          enabled: true,
          sessionStart: true,
          sessionExit: true,
          commandCompletion: true,
          commandError: true,
          bell: true,
          claudeTurn: false,
        };

        const response = await request(app).put('/api/config').send({
          repositoryBasePath: newPath,
          notificationPreferences: newPreferences,
        });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
          success: true,
          repositoryBasePath: newPath,
          notificationPreferences: newPreferences,
        });

        expect(mockConfigService.updateRepositoryBasePath).toHaveBeenCalledWith(newPath);
        expect(mockConfigService.updateNotificationPreferences).toHaveBeenCalledWith(
          newPreferences
        );
      });

      it('should reject invalid notification preferences', async () => {
        const response = await request(app)
          .put('/api/config')
          .send({ notificationPreferences: 'invalid' }); // Not an object

        expect(response.status).toBe(400);
        expect(response.body).toEqual({
          error: 'No valid updates provided',
        });

        expect(mockConfigService.updateNotificationPreferences).not.toHaveBeenCalled();
      });
    });
  });
});
