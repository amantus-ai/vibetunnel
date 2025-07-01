import { exec } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const execAsync = promisify(exec);

describe('vt title Command Integration', () => {
  let testControlDir: string;
  let vtScriptPath: string;

  beforeEach(async () => {
    // Create test control directory with shorter path
    const shortId = Math.random().toString(36).substring(2, 8);
    testControlDir = path.join(os.tmpdir(), `vt-${shortId}`);
    await fs.mkdir(testControlDir, { recursive: true });

    // Get path to vt script
    vtScriptPath = path.join(process.cwd(), '..', 'mac', 'VibeTunnel', 'vt');
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testControlDir, { recursive: true, force: true });
    } catch (_error) {
      // Ignore cleanup errors
    }
  });

  it('should show error when vt title is used outside a session', async () => {
    // Run vt title outside of a session
    try {
      await execAsync(`${vtScriptPath} title "Test Title"`);
      // Should not reach here
      expect.fail('Command should have failed');
    } catch (error: any) {
      expect(error.code).toBeGreaterThan(0);
      expect(error.stderr).toContain("'vt title' can only be used inside a VibeTunnel session");
      expect(error.stderr).toContain('Start a session first');
    }
  });

  it('should update session.json when vt title is used inside a session', async () => {
    // Create a mock session environment with shorter ID
    const sessionId = `t-${Math.random().toString(36).substring(2, 8)}`;
    const sessionDir = path.join(testControlDir, sessionId);
    await fs.mkdir(sessionDir, { recursive: true });

    // Create initial session.json
    const initialSessionInfo = {
      id: sessionId,
      name: 'original-name',
      command: ['bash'],
      workingDir: process.cwd(),
      status: 'running',
      startedAt: new Date().toISOString(),
      pid: process.pid,
    };

    const sessionJsonPath = path.join(sessionDir, 'session.json');
    await fs.writeFile(sessionJsonPath, JSON.stringify(initialSessionInfo, null, 2));

    // Set up environment as if we're inside a VibeTunnel session
    const env = {
      ...process.env,
      VIBETUNNEL_SESSION_ID: sessionId,
      HOME: os.homedir(),
    };

    // Override HOME to use our test directory
    const mockHome = path.join(testControlDir, 'home');
    await fs.mkdir(path.join(mockHome, '.vibetunnel', 'control'), { recursive: true });

    // Create symlink from mock home to our test session
    const mockControlDir = path.join(mockHome, '.vibetunnel', 'control');
    await fs.symlink(sessionDir, path.join(mockControlDir, sessionId));

    env.HOME = mockHome;

    // Run vt title inside the mocked session
    const { stdout, stderr } = await execAsync(`${vtScriptPath} title "Updated Title"`, { env });

    expect(stdout).toContain('Session title updated to: Updated Title');
    expect(stderr).toBe('');

    // Verify session.json was updated
    const updatedContent = await fs.readFile(sessionJsonPath, 'utf-8');
    const updatedInfo = JSON.parse(updatedContent);
    expect(updatedInfo.name).toBe('Updated Title');

    // Other fields should remain unchanged
    expect(updatedInfo.id).toBe(sessionId);
    expect(updatedInfo.command).toEqual(['bash']);
    expect(updatedInfo.status).toBe('running');
  });

  it('should handle titles with special characters', async () => {
    const sessionId = `t-${Math.random().toString(36).substring(2, 8)}`;
    const sessionDir = path.join(testControlDir, sessionId);
    await fs.mkdir(sessionDir, { recursive: true });

    // Create session.json
    const sessionInfo = {
      id: sessionId,
      name: 'original',
      command: ['bash'],
      workingDir: process.cwd(),
      status: 'running',
      startedAt: new Date().toISOString(),
    };

    const sessionJsonPath = path.join(sessionDir, 'session.json');
    await fs.writeFile(sessionJsonPath, JSON.stringify(sessionInfo, null, 2));

    // Set up environment
    const mockHome = path.join(testControlDir, 'home');
    await fs.mkdir(path.join(mockHome, '.vibetunnel', 'control'), { recursive: true });
    await fs.symlink(sessionDir, path.join(mockHome, '.vibetunnel', 'control', sessionId));

    const env = {
      ...process.env,
      VIBETUNNEL_SESSION_ID: sessionId,
      HOME: mockHome,
    };

    // Test various special characters
    const specialTitles = [
      'Title with spaces',
      'Title-with-dashes',
      'Title_with_underscores',
      'Title (with) parentheses',
      'Title [with] brackets',
      'Title {with} braces',
      'Title with "quotes"',
      "Title with 'single quotes'",
      'Title with $pecial chars',
      'Title with emoji 🚀',
      'Multi\nline\ntitle', // Should handle newlines
    ];

    for (const title of specialTitles) {
      // Run vt title
      const { stdout } = await execAsync(`${vtScriptPath} title "${title.replace(/"/g, '\\"')}"`, {
        env,
      });

      expect(stdout).toContain(`Session title updated to: ${title}`);

      // Verify update
      const content = await fs.readFile(sessionJsonPath, 'utf-8');
      const info = JSON.parse(content);
      expect(info.name).toBe(title);
    }
  });

  it('should handle missing session.json gracefully', async () => {
    const sessionId = `test-session-${uuidv4()}`;

    // Set up environment without creating session.json
    const env = {
      ...process.env,
      VIBETUNNEL_SESSION_ID: sessionId,
      HOME: testControlDir, // Use test dir as home
    };

    // Run vt title
    try {
      await execAsync(`${vtScriptPath} title "Test"`, { env });
      expect.fail('Should have failed');
    } catch (error: any) {
      expect(error.code).toBeGreaterThan(0);
      expect(error.stderr).toContain('Session file not found');
    }
  });

  it('should work without jq using sed fallback', async () => {
    const sessionId = `t-${Math.random().toString(36).substring(2, 8)}`;
    const sessionDir = path.join(testControlDir, sessionId);
    await fs.mkdir(sessionDir, { recursive: true });

    // Create session.json
    const sessionInfo = {
      id: sessionId,
      name: 'sed-test',
      command: ['bash'],
      workingDir: process.cwd(),
      status: 'running',
    };

    const sessionJsonPath = path.join(sessionDir, 'session.json');
    await fs.writeFile(sessionJsonPath, JSON.stringify(sessionInfo, null, 2));

    // Set up environment
    const mockHome = path.join(testControlDir, 'home');
    await fs.mkdir(path.join(mockHome, '.vibetunnel', 'control'), { recursive: true });
    await fs.symlink(sessionDir, path.join(mockHome, '.vibetunnel', 'control', sessionId));

    const env = {
      ...process.env,
      VIBETUNNEL_SESSION_ID: sessionId,
      HOME: mockHome,
      PATH: '/usr/bin:/bin', // Minimal PATH that likely excludes jq
    };

    // Run vt title (should use sed fallback)
    const { stdout } = await execAsync(`${vtScriptPath} title "Sed Fallback Test"`, { env });

    expect(stdout).toContain('Session title updated to: Sed Fallback Test');

    // Verify update
    const content = await fs.readFile(sessionJsonPath, 'utf-8');
    const info = JSON.parse(content);
    expect(info.name).toBe('Sed Fallback Test');
  });

  it('should handle concurrent title updates', async () => {
    const sessionId = `t-${Math.random().toString(36).substring(2, 8)}`;
    const sessionDir = path.join(testControlDir, sessionId);
    await fs.mkdir(sessionDir, { recursive: true });

    // Create session.json
    const sessionInfo = {
      id: sessionId,
      name: 'concurrent-test',
      command: ['bash'],
      workingDir: process.cwd(),
      status: 'running',
    };

    const sessionJsonPath = path.join(sessionDir, 'session.json');
    await fs.writeFile(sessionJsonPath, JSON.stringify(sessionInfo, null, 2));

    // Set up environment
    const mockHome = path.join(testControlDir, 'home');
    await fs.mkdir(path.join(mockHome, '.vibetunnel', 'control'), { recursive: true });
    await fs.symlink(sessionDir, path.join(mockHome, '.vibetunnel', 'control', sessionId));

    const env = {
      ...process.env,
      VIBETUNNEL_SESSION_ID: sessionId,
      HOME: mockHome,
    };

    // Run multiple vt title commands concurrently
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(execAsync(`${vtScriptPath} title "Concurrent Update ${i}"`, { env }));
    }

    // Wait for all to complete
    const results = await Promise.all(promises);

    // All should succeed
    for (const result of results) {
      expect(result.stdout).toContain('Session title updated to: Concurrent Update');
    }

    // Final state should be one of the updates
    const content = await fs.readFile(sessionJsonPath, 'utf-8');
    const info = JSON.parse(content);
    expect(info.name).toMatch(/^Concurrent Update \d$/);
  });

  it('should preserve JSON formatting and other fields', async () => {
    const sessionId = `t-${Math.random().toString(36).substring(2, 8)}`;
    const sessionDir = path.join(testControlDir, sessionId);
    await fs.mkdir(sessionDir, { recursive: true });

    // Create session.json with specific formatting and extra fields
    const sessionInfo = {
      id: sessionId,
      name: 'preserve-test',
      command: ['bash', '-c', 'echo test'],
      workingDir: '/test/dir',
      status: 'running',
      startedAt: '2024-01-01T00:00:00.000Z',
      pid: 12345,
      extraField: 'should-remain',
      nestedObject: {
        key: 'value',
        array: [1, 2, 3],
      },
    };

    const sessionJsonPath = path.join(sessionDir, 'session.json');
    await fs.writeFile(sessionJsonPath, JSON.stringify(sessionInfo, null, 2));

    // Set up environment
    const mockHome = path.join(testControlDir, 'home');
    await fs.mkdir(path.join(mockHome, '.vibetunnel', 'control'), { recursive: true });
    await fs.symlink(sessionDir, path.join(mockHome, '.vibetunnel', 'control', sessionId));

    const env = {
      ...process.env,
      VIBETUNNEL_SESSION_ID: sessionId,
      HOME: mockHome,
    };

    // Run vt title
    await execAsync(`${vtScriptPath} title "Preserved Fields Test"`, { env });

    // Verify all fields are preserved
    const content = await fs.readFile(sessionJsonPath, 'utf-8');
    const info = JSON.parse(content);

    expect(info.name).toBe('Preserved Fields Test');
    expect(info.id).toBe(sessionId);
    expect(info.command).toEqual(['bash', '-c', 'echo test']);
    expect(info.workingDir).toBe('/test/dir');
    expect(info.status).toBe('running');
    expect(info.startedAt).toBe('2024-01-01T00:00:00.000Z');
    expect(info.pid).toBe(12345);
    expect(info.extraField).toBe('should-remain');
    expect(info.nestedObject).toEqual({
      key: 'value',
      array: [1, 2, 3],
    });

    // Check that JSON is still nicely formatted (has newlines)
    expect(content).toContain('\n');
    expect(content).toMatch(/^\s*"name":/m);
  });
});
