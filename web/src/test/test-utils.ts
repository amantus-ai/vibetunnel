import { Express } from 'express';
import { Server } from 'http';
import { vi } from 'vitest';

export interface MockSession {
  id: string;
  command: string;
  workingDir: string;
  name?: string;
  status: 'running' | 'exited';
  exitCode?: number;
  startedAt: string;
  lastModified: string;
  pid?: number;
  waiting?: boolean;
}

export const createMockSession = (overrides?: Partial<MockSession>): MockSession => ({
  id: 'test-session-123',
  command: 'bash',
  workingDir: '/tmp',
  status: 'running',
  startedAt: new Date().toISOString(),
  lastModified: new Date().toISOString(),
  pid: 12345,
  ...overrides,
});

export const createTestServer = async (app: Express): Promise<Server> => {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      resolve(server);
    });
  });
};

export const closeTestServer = async (server: Server): Promise<void> => {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
};

export const waitForWebSocket = (ms: number = 100): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

export const mockWebSocketServer = () => {
  const clients = new Set();
  const broadcast = vi.fn();

  return {
    clients,
    broadcast,
    on: vi.fn(),
    handleUpgrade: vi.fn(),
  };
};
