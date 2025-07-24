/**
 * Fish Shell Handler
 *
 * Provides fish shell tab completion support.
 */

import { spawn } from 'child_process';
import path from 'path';

/**
 * FishHandler - Provides intelligent tab completion support for the Fish shell
 *
 * This class integrates with Fish shell's built-in completion system to provide
 * context-aware command and argument suggestions. It handles the complexity of
 * spawning Fish processes, managing timeouts, and parsing completion results.
 *
 * Key features:
 * - Leverages Fish's powerful built-in completion engine
 * - Handles process timeouts to prevent hanging
 * - Safely escapes input to prevent injection attacks
 * - Parses Fish's tab-separated completion format
 * - Provides shell detection and version checking utilities
 *
 * @example
 * ```typescript
 * import { fishHandler } from './fish-handler';
 *
 * // Get completions for a partial command
 * const completions = await fishHandler.getCompletions('git co', '/home/user/project');
 * // Returns: ['commit', 'config', 'checkout', ...]
 *
 * // Check if a shell path is Fish
 * if (FishHandler.isFishShell('/usr/local/bin/fish')) {
 *   // Use Fish-specific features
 *   const version = await FishHandler.getFishVersion();
 *   console.log(`Fish version: ${version}`);
 * }
 * ```
 */
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
