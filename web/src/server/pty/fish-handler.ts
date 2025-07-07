/**
 * Fish Shell Handler
 *
 * Provides fish shell tab completion support.
 */

import { spawnSync } from 'child_process';
import path from 'path';

export class FishHandler {
  /**
   * Get completion suggestions for a partial command
   */
  async getCompletions(partial: string, cwd: string = process.cwd()): Promise<string[]> {
    try {
      // Use fish's built-in completion system with proper escaping
      // Use spawnSync to avoid shell injection
      const result = spawnSync('fish', ['-c', `complete -C ${JSON.stringify(partial)}`], {
        cwd,
        encoding: 'utf8',
        timeout: 2000,
      });

      if (result.status !== 0 || !result.stdout) {
        return [];
      }

      return result.stdout
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => line.split('\t')[0]) // Fish completions are tab-separated
        .filter((completion) => completion && completion !== partial);
    } catch (_error) {
      return [];
    }
  }

  /**
   * Check if the current shell is fish
   */
  static isFishShell(shellPath: string): boolean {
    return shellPath.includes('fish') || path.basename(shellPath) === 'fish';
  }

  /**
   * Get fish shell version
   */
  static getFishVersion(): string | null {
    try {
      const result = spawnSync('fish', ['--version'], { encoding: 'utf8', timeout: 1000 });
      return result.status === 0 && result.stdout ? result.stdout.trim() : null;
    } catch {
      return null;
    }
  }
}

// Export singleton instance
export const fishHandler = new FishHandler();
