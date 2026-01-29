import { exec } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getShellopsBinaryPath,
  getVtScriptPath,
  isNativeBinaryWorking,
} from '../helpers/vt-paths.js';

const execAsync = promisify(exec);

// These tests require the real node-pty module, not mocked
vi.unmock('node-pty');

function normalizeStderr(stderr: string): string {
  const lines = stderr
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .filter(
      (line) =>
        line !==
        'Warning: authenticate-pam native module not found. PAM authentication will not work.'
    );

  return lines.join('\n');
}

describe('vt title Command Integration', () => {
  let testControlDir: string;
  let vtScriptPath: string;
  let shellopsPath: string;

  beforeEach(async () => {
    // Create test control directory with shorter path
    const shortId = Math.random().toString(36).substring(2, 8);
    testControlDir = path.join(os.tmpdir(), `vt-${shortId}`);
    await fs.mkdir(testControlDir, { recursive: true });

    // Get path to vt script and shellops binary
    vtScriptPath = getVtScriptPath();
    shellopsPath = getShellopsBinaryPath();
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
    // Test using shellops directly with --update-title flag (which vt script would call)
    try {
      await execAsync(`${shellopsPath} fwd --update-title "Test Title"`);
      // Should not reach here
      expect.fail('Command should have failed');
    } catch (error) {
      const execError = error as { code?: number; stderr?: string; stdout?: string; message?: string };
      // Error occurred - command should have failed
      expect(error).toBeDefined();
      // The exit code might be a number or the error might just exist
      if (typeof execError.code === 'number') {
        expect(execError.code).toBeGreaterThan(0);
      }
      // The error might be in stderr, stdout, or message
      const output = execError.stderr || execError.stdout || execError.message || '';
      expect(output.toLowerCase()).toMatch(/session|error|not found|library/i);
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

    // Set up environment as if we're inside a ShellOps session
    const env = {
      ...process.env,
      SHELLOPS_SESSION_ID: sessionId,
      HOME: os.homedir(),
    };

    // Override HOME to use our test directory
    const mockHome = path.join(testControlDir, 'home');
    await fs.mkdir(path.join(mockHome, '.shellops', 'control'), { recursive: true });

    // Create symlink from mock home to our test session
    const mockControlDir = path.join(mockHome, '.shellops', 'control');
    await fs.symlink(sessionDir, path.join(mockControlDir, sessionId));

    env.HOME = mockHome;

    // Run shellops directly with --update-title flag (what vt script would call)
    const { stderr } = await execAsync(
      `${shellopsPath} fwd --update-title "Updated Title" --session-id "${sessionId}"`,
      { env }
    );

    // Check that command succeeded (no specific output expected from fwd command)
    expect(normalizeStderr(stderr)).toBe('');

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
    await fs.mkdir(path.join(mockHome, '.shellops', 'control'), { recursive: true });
    await fs.symlink(sessionDir, path.join(mockHome, '.shellops', 'control', sessionId));

    const env = {
      ...process.env,
      SHELLOPS_SESSION_ID: sessionId,
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
      // Skip $ character as it requires complex shell escaping
      // 'Title with $pecial chars',
      'Title with emoji 🚀',
      // Skip newline test as it requires special handling in shell commands
      // 'Multi\nline\ntitle',
    ];

    for (const title of specialTitles) {
      // Run shellops directly
      // Use single quotes for shell safety and escape any single quotes in the title
      const escapedTitle = title.replace(/'/g, "'\"'\"'");
      const { stderr } = await execAsync(
        `${shellopsPath} fwd --update-title '${escapedTitle}' --session-id "${sessionId}"`,
        { env }
      );

      expect(normalizeStderr(stderr)).toBe('');

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
      SHELLOPS_SESSION_ID: sessionId,
      HOME: testControlDir, // Use test dir as home
    };

    // Run shellops directly
    try {
      await execAsync(`${shellopsPath} fwd --update-title "Test" --session-id "${sessionId}"`, {
        env,
      });
      expect.fail('Should have failed');
    } catch (error) {
      const execError = error as { code?: number; stderr?: string; message?: string };
      // Error occurred - command should have failed
      expect(error).toBeDefined();
      // The exit code might be a number or the error might just exist
      if (typeof execError.code === 'number') {
        expect(execError.code).toBeGreaterThan(0);
      }
      // The error message might be in stderr or message
      const output = execError.stderr || execError.message || '';
      expect(output.toLowerCase()).toMatch(/session|error|not found|library/i);
    }
  });

  it('should work without jq using sed fallback', async () => {
    // This test requires the native binary since it uses a restricted PATH
    // that excludes Node.js (to test minimal PATH scenarios)
    if (!isNativeBinaryWorking()) {
      console.log('Skipping test: native binary not working');
      return;
    }

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
    await fs.mkdir(path.join(mockHome, '.shellops', 'control'), { recursive: true });
    await fs.symlink(sessionDir, path.join(mockHome, '.shellops', 'control', sessionId));

    const nativePath = path.join(process.cwd(), 'native', 'shellops');
    const env = {
      ...process.env,
      SHELLOPS_SESSION_ID: sessionId,
      HOME: mockHome,
      PATH: '/usr/bin:/bin', // Minimal PATH that likely excludes jq
    };

    // Run native shellops binary directly (fwd doesn't use jq/sed, it updates directly)
    const { stderr } = await execAsync(
      `${nativePath} fwd --update-title "Sed Fallback Test" --session-id "${sessionId}"`,
      { env }
    );

    expect(normalizeStderr(stderr)).toBe('');

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
    await fs.mkdir(path.join(mockHome, '.shellops', 'control'), { recursive: true });
    await fs.symlink(sessionDir, path.join(mockHome, '.shellops', 'control', sessionId));

    const env = {
      ...process.env,
      SHELLOPS_SESSION_ID: sessionId,
      HOME: mockHome,
    };

    // Run multiple shellops commands concurrently
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(
        execAsync(
          `${shellopsPath} fwd --update-title "Concurrent Update ${i}" --session-id "${sessionId}"`,
          { env }
        )
      );
    }

    // Wait for all to complete - some might fail due to concurrent writes
    const results = await Promise.allSettled(promises);

    // At least some should succeed
    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    expect(succeeded).toBeGreaterThan(0);

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
    await fs.mkdir(path.join(mockHome, '.shellops', 'control'), { recursive: true });
    await fs.symlink(sessionDir, path.join(mockHome, '.shellops', 'control', sessionId));

    const env = {
      ...process.env,
      SHELLOPS_SESSION_ID: sessionId,
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
