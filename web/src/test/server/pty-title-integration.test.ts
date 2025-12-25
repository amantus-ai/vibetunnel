import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PtyManager } from '../../server/pty/pty-manager.js';
import { TitleMode } from '../../shared/types.js';

describe('PTY Terminal Title Integration', () => {
  let ptyManager: PtyManager;
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

  it('should set terminal title in static mode', async () => {
    const sessionId = `t-${Math.random().toString(36).substring(2, 8)}`;
    testSessionIds.push(sessionId);

    const _result = await ptyManager.createSession(['echo', 'test'], {
      sessionId,
      name: 'test-session',
      workingDir: process.cwd(),
      titleMode: TitleMode.STATIC,
    });

    expect(_result.sessionId).toBe(sessionId);

    // Get the internal session to verify it was created with static title mode
    const session = ptyManager.getInternalSession(sessionId);
    expect(session).toBeDefined();
    expect(session?.titleMode).toBe(TitleMode.STATIC);
  });

  it('should accept dynamic (legacy) title mode', async () => {
    const sessionId = `t-${Math.random().toString(36).substring(2, 8)}`;
    testSessionIds.push(sessionId);

    const _result = await ptyManager.createSession(['echo', 'test'], {
      sessionId,
      name: 'test-session',
      workingDir: process.cwd(),
      titleMode: TitleMode.DYNAMIC,
    });

    expect(_result.sessionId).toBe(sessionId);

    // Get the internal session to verify it was created with dynamic title mode
    const session = ptyManager.getInternalSession(sessionId);
    expect(session).toBeDefined();
    expect(session?.titleMode).toBe(TitleMode.DYNAMIC);
  });

  it('should not set terminal title when mode is none', async () => {
    const sessionId = `t-${Math.random().toString(36).substring(2, 8)}`;
    testSessionIds.push(sessionId);

    const _result = await ptyManager.createSession(['echo', 'test'], {
      sessionId,
      name: 'test-session',
      workingDir: process.cwd(),
      titleMode: TitleMode.NONE,
    });

    const session = ptyManager.getInternalSession(sessionId);
    expect(session?.titleMode).toBe(TitleMode.NONE);
  });

  it('should track current working directory in static mode', async () => {
    const sessionId = `t-${Math.random().toString(36).substring(2, 8)}`;
    testSessionIds.push(sessionId);

    const _result = await ptyManager.createSession(['bash'], {
      sessionId,
      name: 'test-session',
      workingDir: process.cwd(),
      titleMode: TitleMode.STATIC,
    });

    const session = ptyManager.getInternalSession(sessionId);
    expect(session).toBeDefined();
    expect(session?.currentWorkingDir).toBe(process.cwd());

    // Simulate cd command
    await ptyManager.sendInput(sessionId, { text: 'cd /tmp\n' });

    // Wait a bit for processing
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify directory was updated
    expect(session?.currentWorkingDir).toBe('/tmp');
  });

  it('should filter title sequences when filter mode is enabled', async () => {
    const sessionId = `t-${Math.random().toString(36).substring(2, 8)}`;
    testSessionIds.push(sessionId);

    const _result = await ptyManager.createSession(['echo', 'test'], {
      sessionId,
      name: 'test-session',
      workingDir: process.cwd(),
      titleMode: TitleMode.FILTER,
    });

    // Session should have filter mode enabled
    const session = ptyManager.getInternalSession(sessionId);
    expect(session).toBeDefined();
    expect(session?.titleMode).toBe(TitleMode.FILTER);
  });

  it('should not auto-select title mode for Claude commands', async () => {
    const sessionId = `t-${Math.random().toString(36).substring(2, 8)}`;
    testSessionIds.push(sessionId);

    // Don't specify titleMode - should stay at NONE
    const _result = await ptyManager.createSession(['claude', '--help'], {
      sessionId,
      name: 'claude-session',
      workingDir: process.cwd(),
    });

    const session = ptyManager.getInternalSession(sessionId);
    expect(session).toBeDefined();

    // Claude commands should not auto-select a title mode
    expect(session?.titleMode).toBe(TitleMode.NONE);
  });

  it('should respect explicit title mode even for Claude', async () => {
    const sessionId = `t-${Math.random().toString(36).substring(2, 8)}`;
    testSessionIds.push(sessionId);

    const _result = await ptyManager.createSession(['claude', '--help'], {
      sessionId,
      name: 'claude-session',
      workingDir: process.cwd(),
      titleMode: TitleMode.FILTER,
    });

    const session = ptyManager.getInternalSession(sessionId);
    expect(session?.titleMode).toBe(TitleMode.FILTER);
  });
});
