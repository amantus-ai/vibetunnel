import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PtyManager } from '../../server/pty/pty-manager.js';
import { SessionManager } from '../../server/pty/session-manager.js';
import { TitleMode } from '../../shared/types.js';

describe('PTY Session.json Watcher', () => {
  let ptyManager: PtyManager;
  let sessionManager: SessionManager;
  let controlPath: string;
  let testSessionIds: string[] = [];

  beforeEach(async () => {
    // Initialize PtyManager
    await PtyManager.initialize();

    // Create a temporary control directory for tests with shorter path
    const shortId = Math.random().toString(36).substring(2, 8);
    controlPath = path.join(os.tmpdir(), `vt-${shortId}`);
    await fs.mkdir(controlPath, { recursive: true });
    ptyManager = new PtyManager(controlPath);
    sessionManager = new SessionManager(controlPath);
  });

  afterEach(async () => {
    // Clean up all test sessions
    for (const sessionId of testSessionIds) {
      try {
        await ptyManager.killSession(sessionId);
      } catch (_error) {
        // Session might already be killed
      }
    }
    testSessionIds = [];

    // NEVER call ptyManager.shutdown() as it would kill ALL sessions
    // including the VibeTunnel session running Claude Code

    // Clean up control directory
    try {
      await fs.rm(controlPath, { recursive: true, force: true });
    } catch (_error) {
      // Ignore cleanup errors
    }
  });

  it('should detect session name changes in session.json', async () => {
    const sessionId = `t-${Math.random().toString(36).substring(2, 8)}`;
    testSessionIds.push(sessionId);

    // Create a session with static title mode
    const result = await ptyManager.createSession(['sleep', '10'], {
      sessionId,
      name: 'original-name',
      workingDir: process.cwd(),
      titleMode: TitleMode.STATIC,
      forwardToStdout: true,
    });

    expect(result.sessionInfo.name).toBe('original-name');

    // Wait for session to be fully set up
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Set up event listener for name change
    const nameChangePromise = new Promise<{ sessionId: string; name: string }>((resolve) => {
      ptyManager.once('sessionNameChanged', (changedSessionId, newName) => {
        resolve({ sessionId: changedSessionId, name: newName });
      });
    });

    // Update session.json directly (simulating vt title command)
    const sessionInfo = sessionManager.loadSessionInfo(sessionId);
    expect(sessionInfo).not.toBeNull();
    if (sessionInfo) {
      sessionInfo.name = 'updated-name';
      sessionManager.saveSessionInfo(sessionId, sessionInfo);
    }

    // Wait for the watcher to detect the change
    const nameChange = await Promise.race([
      nameChangePromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout waiting for name change')), 2000)
      ),
    ]);

    expect(nameChange.sessionId).toBe(sessionId);
    expect(nameChange.name).toBe('updated-name');

    // Verify the in-memory session info was updated
    const internalSession = ptyManager.getInternalSession(sessionId);
    expect(internalSession?.sessionInfo.name).toBe('updated-name');
  });

  it('should inject new title when session name changes in static mode', async () => {
    const sessionId = `t-${Math.random().toString(36).substring(2, 8)}`;
    testSessionIds.push(sessionId);

    // Mock process.stdout.write to capture title sequences
    const originalWrite = process.stdout.write;
    const writeSpy = vi.fn((data: string | Uint8Array, ...args: unknown[]): boolean => {
      // Call the original write method
      return originalWrite.call(process.stdout, data, ...args) as boolean;
    });
    process.stdout.write = writeSpy as typeof process.stdout.write;

    try {
      // Create a session with static title mode
      const _result = await ptyManager.createSession(['sleep', '10'], {
        sessionId,
        name: 'original-name',
        workingDir: '/test/path',
        titleMode: TitleMode.STATIC,
        forwardToStdout: true,
      });

      // Wait for session setup and initial title injection
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Clear previous calls
      writeSpy.mockClear();

      // Update session name
      const sessionInfo = sessionManager.loadSessionInfo(sessionId);
      if (sessionInfo) {
        sessionInfo.name = 'new-title';
        sessionManager.saveSessionInfo(sessionId, sessionInfo);
      }

      // Wait for watcher to process (100ms polling) and title injection (50ms quiet period)
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Check if title sequence was written to stdout
      const titleWrites = writeSpy.mock.calls.filter((call) => {
        const data = call[0];
        return typeof data === 'string' && data.includes('\x1B]2;') && data.includes('new-title');
      });

      expect(titleWrites.length).toBeGreaterThan(0);
      // When a session name is set, only the name is used in the title
      expect(titleWrites[0][0]).toBe('\x1B]2;new-title\x07');
    } finally {
      // Restore original write method
      process.stdout.write = originalWrite;
    }
  });

  it('should update static title with new session name', async () => {
    const sessionId = `t-${Math.random().toString(36).substring(2, 8)}`;
    testSessionIds.push(sessionId);

    // Mock process.stdout.write to capture title sequences
    const originalWrite = process.stdout.write;
    const writeSpy = vi.fn((data: string | Uint8Array, ...args: unknown[]): boolean => {
      return originalWrite.call(process.stdout, data, ...args) as boolean;
    });
    process.stdout.write = writeSpy as typeof process.stdout.write;

    try {
      // Create a session with static title mode
      const _result = await ptyManager.createSession(['sleep', '10'], {
        sessionId,
        name: 'original-name',
        workingDir: '/test/path',
        titleMode: TitleMode.STATIC,
        forwardToStdout: true,
      });

      // Wait for setup and initial title
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Clear previous calls
      writeSpy.mockClear();

      // Update session name
      const sessionInfo = sessionManager.loadSessionInfo(sessionId);
      if (sessionInfo) {
        sessionInfo.name = 'static-title';
        sessionManager.saveSessionInfo(sessionId, sessionInfo);
      }

      // Wait for processing and title injection
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Verify static title was updated
      const titleWrites = writeSpy.mock.calls.filter((call) => {
        const data = call[0];
        return typeof data === 'string' && data.includes('\x1B]2;');
      });

      expect(titleWrites.length).toBeGreaterThan(0);
      // Static title with session name - check that it contains the static title
      const lastTitleWrite = titleWrites[titleWrites.length - 1][0];
      expect(lastTitleWrite).toContain('static-title');
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  it('should not update title in NONE mode', async () => {
    const sessionId = `t-${Math.random().toString(36).substring(2, 8)}`;
    testSessionIds.push(sessionId);

    // Create session with NONE title mode
    const _result = await ptyManager.createSession(['sleep', '10'], {
      sessionId,
      name: 'original-name',
      workingDir: process.cwd(),
      titleMode: TitleMode.NONE,
      forwardToStdout: true,
    });

    // Mock PTY write
    const writeSpy = vi.fn();
    const pty = ptyManager.getPtyForSession(sessionId);
    if (pty) {
      pty.write = writeSpy;
    }

    // Wait for setup
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Update session name
    const sessionInfo = sessionManager.loadSessionInfo(sessionId);
    if (sessionInfo) {
      sessionInfo.name = 'should-not-appear';
      sessionManager.saveSessionInfo(sessionId, sessionInfo);
    }

    // Wait for potential processing
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Verify no title sequences were written
    const titleWrites = writeSpy.mock.calls.filter((call) => {
      const data = call[0];
      return data.includes('\x1B]2;');
    });

    expect(titleWrites.length).toBe(0);
  });

  it('should not update title in FILTER mode', async () => {
    const sessionId = `t-${Math.random().toString(36).substring(2, 8)}`;
    testSessionIds.push(sessionId);

    // Create session with FILTER title mode
    const _result = await ptyManager.createSession(['sleep', '10'], {
      sessionId,
      name: 'original-name',
      workingDir: process.cwd(),
      titleMode: TitleMode.FILTER,
      forwardToStdout: true,
    });

    // Mock PTY write
    const writeSpy = vi.fn();
    const pty = ptyManager.getPtyForSession(sessionId);
    if (pty) {
      pty.write = writeSpy;
    }

    // Wait for setup
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Update session name
    const sessionInfo = sessionManager.loadSessionInfo(sessionId);
    if (sessionInfo) {
      sessionInfo.name = 'filtered-title';
      sessionManager.saveSessionInfo(sessionId, sessionInfo);
    }

    // Wait for potential processing
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Verify no title sequences were written
    const titleWrites = writeSpy.mock.calls.filter((call) => {
      const data = call[0];
      return data.includes('\x1B]2;');
    });

    expect(titleWrites.length).toBe(0);
  });

  it('should handle rapid session name changes', async () => {
    const sessionId = `t-${Math.random().toString(36).substring(2, 8)}`;
    testSessionIds.push(sessionId);

    // Create session
    const _result = await ptyManager.createSession(['sleep', '10'], {
      sessionId,
      name: 'original',
      workingDir: process.cwd(),
      titleMode: TitleMode.STATIC,
      forwardToStdout: true,
    });

    // Wait for setup
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Track name changes
    const nameChanges: string[] = [];
    ptyManager.on('sessionNameChanged', (_sessionId, newName) => {
      if (_sessionId === sessionId) {
        nameChanges.push(newName);
      }
    });

    // Perform rapid updates
    const updates = ['update1', 'update2', 'update3', 'update4', 'update5'];
    for (const name of updates) {
      const sessionInfo = sessionManager.loadSessionInfo(sessionId);
      if (sessionInfo) {
        sessionInfo.name = name;
        sessionManager.saveSessionInfo(sessionId, sessionInfo);
      }
      // Small delay between updates (must be longer than polling interval)
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    // Wait for all updates to process
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Should have received all name changes
    expect(nameChanges.length).toBe(updates.length);
    expect(nameChanges).toEqual(updates);
  });

  it('should clean up watcher on session exit', async () => {
    const sessionId = `t-${Math.random().toString(36).substring(2, 8)}`;
    // Don't push to testSessionIds so afterEach doesn't try to kill it

    // Create session with a simple exit command
    const _result = await ptyManager.createSession(['exit'], {
      sessionId,
      name: 'test-cleanup',
      workingDir: process.cwd(),
      titleMode: TitleMode.STATIC,
      forwardToStdout: true,
    });

    // Force kill the PTY to trigger cleanup
    await ptyManager.killSession(sessionId);

    // Give a moment for cleanup to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Get internal session to verify cleanup
    const internalSession = ptyManager.getInternalSession(sessionId);

    // Session should be cleaned up
    expect(internalSession).toBeUndefined();

    // Try to update session.json after cleanup - should not cause errors
    try {
      const sessionInfo = sessionManager.loadSessionInfo(sessionId);
      if (sessionInfo) {
        sessionInfo.name = 'after-cleanup';
        sessionManager.saveSessionInfo(sessionId, sessionInfo);
      }
    } catch (_error) {
      // Expected - session might be cleaned up
    }

    // No errors should occur
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  it('should only update title for external terminals', async () => {
    const sessionId = `t-${Math.random().toString(36).substring(2, 8)}`;
    testSessionIds.push(sessionId);

    // Create session without forwardToStdout (web session)
    const _result = await ptyManager.createSession(['sleep', '10'], {
      sessionId,
      name: 'web-session',
      workingDir: process.cwd(),
      titleMode: TitleMode.STATIC,
      forwardToStdout: false, // This makes it a web session
    });

    // Mock PTY write
    const writeSpy = vi.fn();
    const pty = ptyManager.getPtyForSession(sessionId);
    if (pty) {
      pty.write = writeSpy;
    }

    // Wait for setup
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Update session name
    const sessionInfo = sessionManager.loadSessionInfo(sessionId);
    if (sessionInfo) {
      sessionInfo.name = 'should-not-write';
      sessionManager.saveSessionInfo(sessionId, sessionInfo);
    }

    // Wait for potential processing
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Verify no title sequences were written (web sessions don't get title injection)
    const titleWrites = writeSpy.mock.calls.filter((call) => {
      const data = call[0];
      return data.includes('\x1B]2;');
    });

    expect(titleWrites.length).toBe(0);
  });
});
