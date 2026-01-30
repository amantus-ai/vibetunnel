/**
 * Process tree utilities for detecting parent processes
 */

import { execSync } from 'child_process';
import { createLogger } from './logger.js';

const logger = createLogger('process-tree');

interface ProcessInfo {
  pid: number;
  ppid: number;
  command: string;
}

/**
 * Get the process tree starting from current process up to root
 * Returns array of process info from current to root
 */
export function getProcessTree(): ProcessInfo[] {
  const tree: ProcessInfo[] = [];
  let currentPid = process.pid;

  // Safety limit to prevent infinite loops
  const maxDepth = 20;
  let depth = 0;

  while (currentPid > 0 && depth < maxDepth) {
    try {
      // Use ps to get process info
      // Format: PID PPID COMMAND
      const output = execSync(`ps -p ${currentPid} -o pid,ppid,command`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'], // Suppress stderr
      });

      const lines = output.trim().split('\n');
      if (lines.length < 2) break; // No data line after header

      const dataLine = lines[1].trim();
      const parts = dataLine.split(/\s+/);

      if (parts.length < 3) break;

      const pid = Number.parseInt(parts[0], 10);
      const ppid = Number.parseInt(parts[1], 10);
      // Command is everything after ppid
      const command = parts.slice(2).join(' ');

      tree.push({ pid, ppid, command });

      // Move to parent
      currentPid = ppid;
      depth++;

      // Stop at init process
      if (ppid === 0 || ppid === 1) break;
    } catch (error) {
      // Process might have disappeared or ps failed
      logger.debug(`Failed to get info for PID ${currentPid}:`, error);
      break;
    }
  }

  return tree;
}

/**
 * Check if any process in the tree matches Claude patterns
 * Returns true if Claude is detected in the process tree
 */
export function isClaudeInProcessTree(): boolean {
  try {
    const tree = getProcessTree();

    // Patterns that indicate Claude is running
    const claudePatterns = [
      /\bclaude\b/i, // Direct claude command
      /\bcly\b/i, // cly wrapper
      /claude-wrapper/i, // Claude wrapper script
      /node.*claude/i, // Node running claude
      /tsx.*claude/i, // tsx running claude
      /bun.*claude/i, // bun running claude
      /npx.*claude/i, // npx claude
      /claude-code/i, // claude-code command
    ];

    for (const proc of tree) {
      const matched = claudePatterns.some((pattern) => pattern.test(proc.command));
      if (matched) {
        logger.debug(`Claude detected in process tree: PID ${proc.pid}, Command: ${proc.command}`);
        return true;
      }
    }

    // Log tree for debugging if VIBETUNNEL_CLAUDE_DEBUG is set
    if (process.env.VIBETUNNEL_CLAUDE_DEBUG === 'true') {
      logger.debug('Process tree:');
      tree.forEach((proc, index) => {
        logger.debug(`  ${' '.repeat(index * 2)}[${proc.pid}] ${proc.command}`);
      });
    }

    return false;
  } catch (error) {
    logger.debug('Failed to check process tree:', error);
    // Fall back to false if we can't check
    return false;
  }
}

/**
 * Get the Claude command from the process tree if available
 * Returns the full command line of the Claude process or null
 */
export function getClaudeCommandFromTree(): string | null {
  try {
    const tree = getProcessTree();

    // Find the first Claude process
    const claudePatterns = [/\bclaude\b/i, /\bcly\b/i, /claude-wrapper/i, /claude-code/i];

    for (const proc of tree) {
      const matched = claudePatterns.some((pattern) => pattern.test(proc.command));
      if (matched) {
        return proc.command;
      }
    }

    return null;
  } catch (error) {
    logger.debug('Failed to get Claude command from tree:', error);
    return null;
  }
}
