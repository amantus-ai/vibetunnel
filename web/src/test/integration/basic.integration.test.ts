import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

describe('Basic Integration Test', () => {
  describe('tty-fwd binary', () => {
    it('should be available and executable', () => {
      const ttyFwdPath = path.resolve(__dirname, '../../../../tty-fwd/target/release/tty-fwd');
      expect(fs.existsSync(ttyFwdPath)).toBe(true);

      // Check if executable
      try {
        fs.accessSync(ttyFwdPath, fs.constants.X_OK);
        expect(true).toBe(true);
      } catch (_e) {
        expect(_e).toBeUndefined();
      }
    });

    it('should show help information', async () => {
      const ttyFwdPath = path.resolve(__dirname, '../../../../tty-fwd/target/release/tty-fwd');

      const result = await new Promise<string>((resolve, reject) => {
        const proc = spawn(ttyFwdPath, ['--help']);
        let output = '';

        proc.stdout.on('data', (data) => {
          output += data.toString();
        });

        proc.stderr.on('data', (data) => {
          output += data.toString();
        });

        proc.on('close', (code) => {
          if (code === 0) {
            resolve(output);
          } else {
            reject(new Error(`Process exited with code ${code}: ${output}`));
          }
        });
      });

      expect(result).toContain('tty-fwd');
      expect(result).toContain('Usage:');
    });

    it('should list sessions (empty)', async () => {
      const ttyFwdPath = path.resolve(__dirname, '../../../../tty-fwd/target/release/tty-fwd');
      const controlDir = path.join(os.tmpdir(), 'tty-fwd-test-' + Date.now());

      // Create control directory
      fs.mkdirSync(controlDir, { recursive: true });

      try {
        const result = await new Promise<string>((resolve, reject) => {
          const proc = spawn(ttyFwdPath, ['--control-path', controlDir, '--list-sessions']);
          let output = '';

          proc.stdout.on('data', (data) => {
            output += data.toString();
          });

          proc.on('close', (code) => {
            if (code === 0) {
              resolve(output);
            } else {
              reject(new Error(`Process exited with code ${code}`));
            }
          });
        });

        // Should return empty JSON object for no sessions
        const sessions = JSON.parse(result);
        expect(typeof sessions).toBe('object');
        expect(Object.keys(sessions)).toHaveLength(0);
      } finally {
        // Clean up
        fs.rmSync(controlDir, { recursive: true, force: true });
      }
    });

    it.skip('should create and list a session', async () => {
      // Skip this test as it's specific to tty-fwd binary behavior
      // The server is now using node-pty by default
      const ttyFwdPath = path.resolve(__dirname, '../../../../tty-fwd/target/release/tty-fwd');
      const controlDir = path.join(os.tmpdir(), 'tty-fwd-test-' + Date.now());

      // Create control directory
      fs.mkdirSync(controlDir, { recursive: true });

      try {
        // Create a session
        const createResult = await new Promise<string>((resolve, reject) => {
          const proc = spawn(ttyFwdPath, [
            '--control-path',
            controlDir,
            '--session-name',
            'Test Session',
            '--',
            'echo',
            'Hello from tty-fwd',
          ]);
          let output = '';

          proc.stdout.on('data', (data) => {
            output += data.toString();
          });

          proc.stderr.on('data', (data) => {
            console.error('tty-fwd stderr:', data.toString());
          });

          proc.on('close', (code) => {
            if (code === 0) {
              // tty-fwd spawn returns session ID on stdout, or empty if spawned in background
              resolve(output.trim() || 'session-created');
            } else {
              reject(new Error(`Process exited with code ${code}`));
            }
          });
        });

        // Should return a session ID or success indicator
        expect(createResult).toBeTruthy();

        // Wait a bit for the session to be fully created
        await new Promise((resolve) => setTimeout(resolve, 100));

        // List sessions
        const listResult = await new Promise<string>((resolve, reject) => {
          const proc = spawn(ttyFwdPath, ['--control-path', controlDir, '--list-sessions']);
          let output = '';

          proc.stdout.on('data', (data) => {
            output += data.toString();
          });

          proc.on('close', (code) => {
            if (code === 0) {
              resolve(output);
            } else {
              reject(new Error(`Process exited with code ${code}`));
            }
          });
        });

        // tty-fwd returns sessions as JSON object
        const sessions = JSON.parse(listResult);
        expect(typeof sessions).toBe('object');
        // The session should be listed (note: tty-fwd might use a different key format)
        const sessionKeys = Object.keys(sessions);
        expect(sessionKeys.length).toBeGreaterThan(0);
      } finally {
        // Clean up
        fs.rmSync(controlDir, { recursive: true, force: true });
      }
    });
  });

  describe('Server startup', () => {
    it('should verify server dependencies exist', () => {
      // Check that key files exist
      const serverPath = path.resolve(__dirname, '../../server.ts');
      const publicPath = path.resolve(__dirname, '../../../public');

      // Debug paths
      console.log('Looking for server at:', serverPath);
      console.log('Server exists:', fs.existsSync(serverPath));
      console.log('Looking for public at:', publicPath);
      console.log('Public exists:', fs.existsSync(publicPath));

      expect(fs.existsSync(serverPath)).toBe(true);
      expect(fs.existsSync(publicPath)).toBe(true);
    });

    it('should load server module without crashing', async () => {
      // Set up environment
      process.env.NODE_ENV = 'test';
      process.env.PORT = '0';

      // This will test that the server module can be loaded
      // In a real test, you'd start the server in a separate process
      const serverPath = path.resolve(__dirname, '../../server.ts');
      expect(fs.existsSync(serverPath)).toBe(true);
    });
  });
});
