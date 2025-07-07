/**
 * Fish Shell Handler
 *
 * Provides fish shell tab completion support.
 */

import { spawn } from 'child_process';
import path from 'path';

export class FishHandler {
  /**
   * Get completion suggestions for a partial command
   */
  async getCompletions(partial: string, cwd: string = process.cwd()): Promise<string[]> {
    return new Promise((resolve) => {
      try {
        // Use fish's built-in completion system with proper escaping
        const fishProcess = spawn('fish', ['-c', `complete -C ${JSON.stringify(partial)}`], {
          cwd,
          stdio: ['ignore', 'pipe', 'ignore'],
        });

        let stdout = '';
        const timeout = setTimeout(() => {
          fishProcess.kill('SIGTERM');
          resolve([]);
        }, 2000);

        fishProcess.stdout?.on('data', (data) => {
          stdout += data.toString();
        });

        fishProcess.on('close', (code) => {
          clearTimeout(timeout);

          if (code !== 0 || !stdout.trim()) {
            resolve([]);
            return;
          }

          const completions = stdout
            .split('\n')
            .filter((line) => line.trim())
            .map((line) => line.split('\t')[0]) // Fish completions are tab-separated
            .filter((completion) => completion && completion !== partial);

          resolve(completions);
        });

        fishProcess.on('error', () => {
          clearTimeout(timeout);
          resolve([]);
        });
      } catch (_error) {
        resolve([]);
      }
    });
  }

  /**
   * Check if the current shell is fish
   */
  static isFishShell(shellPath: string): boolean {
    const basename = path.basename(shellPath);
    // Exact match for fish or fish with version suffix (e.g., fish3)
    return basename === 'fish' || /^fish\d*$/.test(basename);
  }

  /**
   * Get fish shell version
   */
  static async getFishVersion(): Promise<string | null> {
    return new Promise((resolve) => {
      try {
        const fishProcess = spawn('fish', ['--version'], {
          stdio: ['ignore', 'pipe', 'ignore'],
        });

        let stdout = '';
        const timeout = setTimeout(() => {
          fishProcess.kill('SIGTERM');
          resolve(null);
        }, 1000);

        fishProcess.stdout?.on('data', (data) => {
          stdout += data.toString();
        });

        fishProcess.on('close', (code) => {
          clearTimeout(timeout);
          resolve(code === 0 && stdout.trim() ? stdout.trim() : null);
        });

        fishProcess.on('error', () => {
          clearTimeout(timeout);
          resolve(null);
        });
      } catch {
        resolve(null);
      }
    });
  }
}

// Export singleton instance
export const fishHandler = new FishHandler();
