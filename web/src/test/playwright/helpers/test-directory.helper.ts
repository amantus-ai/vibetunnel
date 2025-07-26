import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Helper to ensure tests have a valid working directory
 * In CI environments, the default process.cwd() might not be suitable for PTY spawning
 */
export function getTestWorkingDirectory(): string {
  // In CI, use temp directory to ensure we have a writable location
  if (process.env.CI) {
    const tempDir = os.tmpdir();
    const testDir = path.join(tempDir, 'vibetunnel-test-sessions');

    // Ensure directory exists
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }

    return testDir;
  }

  // In local development, use current directory
  return process.cwd();
}
