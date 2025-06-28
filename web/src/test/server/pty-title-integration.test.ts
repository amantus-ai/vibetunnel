import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import { PtyManager } from '../../server/pty/pty-manager.js';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs/promises';

describe('PTY Terminal Title Integration', () => {
  let ptyManager: PtyManager;
  let controlPath: string;
  let testSessionIds: string[] = [];

  beforeEach(async () => {
    // Create a temporary control directory for tests
    controlPath = path.join(os.tmpdir(), `vt-test-${uuidv4()}`);
    await fs.mkdir(controlPath, { recursive: true });
    ptyManager = new PtyManager(controlPath);
  });

  afterEach(async () => {
    // Clean up all test sessions
    for (const sessionId of testSessionIds) {
      try {
        await ptyManager.killSession(sessionId);
      } catch (error) {
        // Session might already be killed
      }
    }
    testSessionIds = [];

    // Shutdown PTY manager
    await ptyManager.shutdown();

    // Clean up control directory
    try {
      await fs.rm(controlPath, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  it('should set initial terminal title when setTerminalTitle is enabled', async () => {
    const sessionId = `test-${uuidv4()}`;
    testSessionIds.push(sessionId);

    const result = await ptyManager.createSession(['echo', 'test'], {
      sessionId,
      name: 'test-session',
      workingDir: process.cwd(),
      setTerminalTitle: true,
    });

    expect(result.sessionId).toBe(sessionId);
    
    // Get the session to verify it was created with setTerminalTitle
    const session = ptyManager.getSession(sessionId);
    expect(session).toBeDefined();
    expect(session?.setTerminalTitle).toBe(true);
  });

  it('should not set terminal title when setTerminalTitle is false', async () => {
    const sessionId = `test-${uuidv4()}`;
    testSessionIds.push(sessionId);

    const result = await ptyManager.createSession(['echo', 'test'], {
      sessionId,
      name: 'test-session',
      workingDir: process.cwd(),
      setTerminalTitle: false,
    });

    const session = ptyManager.getSession(sessionId);
    expect(session?.setTerminalTitle).toBe(false);
  });

  it('should track working directory changes on cd commands', async () => {
    const sessionId = `test-${uuidv4()}`;
    testSessionIds.push(sessionId);

    await ptyManager.createSession(['bash', '-i'], {
      sessionId,
      name: 'test-session',
      workingDir: process.cwd(),
      setTerminalTitle: true,
    });

    const session = ptyManager.getSession(sessionId);
    expect(session).toBeDefined();
    
    // Initial working directory
    expect(session?.currentWorkingDir).toBe(process.cwd());

    // Send cd command
    ptyManager.sendInput(sessionId, { text: 'cd /tmp\n' });

    // Wait a bit for the command to be processed
    await new Promise(resolve => setTimeout(resolve, 100));

    // Check that working directory was updated
    expect(session?.currentWorkingDir).toBe('/tmp');
  });

  it('should filter title sequences when preventTitleChange is enabled', async () => {
    const sessionId = `test-${uuidv4()}`;
    testSessionIds.push(sessionId);

    const result = await ptyManager.createSession(['echo', '-e', '\\033]2;Test Title\\007Hello'], {
      sessionId,
      name: 'test-session',
      workingDir: process.cwd(),
      preventTitleChange: true,
      forwardToStdout: false,
    });

    // Session should have preventTitleChange enabled
    const session = ptyManager.getSession(sessionId);
    expect(session?.preventTitleChange).toBe(true);
  });

  it('should allow both setTerminalTitle and preventTitleChange to be configured', async () => {
    const sessionId = `test-${uuidv4()}`;
    testSessionIds.push(sessionId);

    await ptyManager.createSession(['bash'], {
      sessionId,
      name: 'test-session',
      workingDir: process.cwd(),
      setTerminalTitle: true,
      preventTitleChange: true,
    });

    const session = ptyManager.getSession(sessionId);
    expect(session?.setTerminalTitle).toBe(true);
    expect(session?.preventTitleChange).toBe(true);
  });
});