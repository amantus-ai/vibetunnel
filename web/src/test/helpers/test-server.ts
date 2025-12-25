/**
 * Test Server Helper
 *
 * Provides utilities for setting up test servers with properly initialized services
 */

import express from 'express';
import { PtyManager } from '../../server/pty/pty-manager.js';
import { createConfigRoutes } from '../../server/routes/config.js';
import { createGitRoutes } from '../../server/routes/git.js';
import type { SessionRoutesConfig } from '../../server/routes/sessions.js';
import { createSessionRoutes } from '../../server/routes/sessions.js';
import { createWorktreeRoutes } from '../../server/routes/worktrees.js';
import { RemoteRegistry } from '../../server/services/remote-registry.js';
import { TerminalManager } from '../../server/services/terminal-manager.js';

export interface TestServerOptions {
  controlPath?: string;
  isHQMode?: boolean;
  includeRoutes?: {
    sessions?: boolean;
    worktrees?: boolean;
    git?: boolean;
    config?: boolean;
  };
}

export interface TestServerResult {
  app: express.Application;
  ptyManager: PtyManager;
  terminalManager: TerminalManager;
  cleanup: () => Promise<void>;
}

/**
 * Create a test server with properly initialized services
 */
export async function createTestServer(options: TestServerOptions = {}): Promise<TestServerResult> {
  const {
    controlPath,
    isHQMode = false,
    includeRoutes = {
      sessions: true,
      worktrees: true,
      git: true,
      config: true,
    },
  } = options;

  // Initialize PtyManager before creating instance
  await PtyManager.initialize();

  // Initialize services
  const ptyManager = new PtyManager(controlPath);
  const terminalManager = new TerminalManager();
  const remoteRegistry = isHQMode ? new RemoteRegistry() : null;

  // Create Express app
  const app = express();
  app.use(express.json());

  // Create config for routes
  const config: SessionRoutesConfig = {
    ptyManager,
    terminalManager,
    remoteRegistry,
    isHQMode,
  };

  // Mount routes based on options
  if (includeRoutes.sessions) {
    app.use('/api', createSessionRoutes(config));
  }
  if (includeRoutes.worktrees) {
    app.use('/api', createWorktreeRoutes());
  }
  if (includeRoutes.git) {
    app.use('/api', createGitRoutes());
  }
  if (includeRoutes.config) {
    const configService = {
      getConfig: async () => ({}),
      updateConfig: async () => ({}),
    };
    app.use('/api', createConfigRoutes(configService));
  }

  // Cleanup function
  const cleanup = async () => {
    // Get the session manager from ptyManager
    const sessionManager = ptyManager.getSessionManager();

    // Close all sessions
    const sessions = sessionManager.listSessions();
    for (const session of sessions) {
      try {
        await ptyManager.killSession(session.id);
      } catch (_error) {
        // Ignore errors during cleanup
      }
    }

    // Stop services
    if (remoteRegistry) {
      remoteRegistry.stop();
    }
  };

  return {
    app,
    ptyManager,
    terminalManager,
    cleanup,
  };
}

/**
 * Create a minimal test server for unit tests
 */
export function createMinimalTestServer() {
  return createTestServer({
    includeRoutes: {
      sessions: false,
      worktrees: true,
      git: false,
      config: false,
    },
  });
}
