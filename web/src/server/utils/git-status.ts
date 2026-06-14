/**
 * Shared Git Status Utilities
 *
 * Provides a single implementation for parsing git status output
 * to avoid duplication across the codebase.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface GitStatusCounts {
  modified: number;
  added: number;
  staged: number;
  deleted: number;
  ahead: number;
  behind: number;
  insertions: number;
  deletions: number;
}

function parseNumstat(output: string): { insertions: number; deletions: number } {
  let insertions = 0;
  let deletions = 0;

  for (const line of output.trim().split('\n')) {
    if (!line) continue;

    const [inserted, deleted] = line.split('\t');
    const insertedCount = Number.parseInt(inserted ?? '', 10);
    const deletedCount = Number.parseInt(deleted ?? '', 10);

    if (Number.isFinite(insertedCount)) insertions += insertedCount;
    if (Number.isFinite(deletedCount)) deletions += deletedCount;
  }

  return { insertions, deletions };
}

/**
 * Get detailed git status including file counts and ahead/behind info
 * @param workingDir The directory to check git status in
 * @returns Git status counts or null if not a git repository
 */
export async function getDetailedGitStatus(workingDir: string): Promise<GitStatusCounts> {
  try {
    const { stdout: statusOutput } = await execFileAsync(
      'git',
      ['status', '--porcelain=v1', '--branch'],
      {
        cwd: workingDir,
        timeout: 5000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      }
    );

    const lines = statusOutput.trim().split('\n');
    const branchLine = lines[0];

    let aheadCount = 0;
    let behindCount = 0;
    let modifiedCount = 0;
    let addedCount = 0;
    let stagedCount = 0;
    let deletedCount = 0;
    let insertions = 0;
    let deletions = 0;

    // Parse branch line for ahead/behind info
    if (branchLine?.startsWith('##')) {
      const aheadMatch = branchLine.match(/\[ahead (\d+)/);
      const behindMatch = branchLine.match(/behind (\d+)/);

      if (aheadMatch) {
        aheadCount = Number.parseInt(aheadMatch[1], 10);
      }
      if (behindMatch) {
        behindCount = Number.parseInt(behindMatch[1], 10);
      }
    }

    // Parse file statuses
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line || line.length < 2) continue;

      const indexStatus = line[0];
      const workingStatus = line[1];

      // Staged files (changes in index)
      if (indexStatus !== ' ' && indexStatus !== '?') {
        stagedCount++;
      }

      // Working directory changes
      if (workingStatus === 'M') {
        modifiedCount++;
      } else if (workingStatus === 'D' && indexStatus === ' ') {
        // Deleted in working tree but not staged
        deletedCount++;
      }

      // Added files (untracked)
      if (indexStatus === '?' && workingStatus === '?') {
        addedCount++;
      }
    }

    try {
      const { stdout: diffOutput } = await execFileAsync('git', ['diff', '--numstat', 'HEAD'], {
        cwd: workingDir,
        timeout: 5000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });
      const stats = parseNumstat(diffOutput);
      insertions = stats.insertions;
      deletions = stats.deletions;
    } catch {
      // Repositories without an initial commit cannot diff against HEAD.
    }

    return {
      modified: modifiedCount,
      added: addedCount,
      staged: stagedCount,
      deleted: deletedCount,
      ahead: aheadCount,
      behind: behindCount,
      insertions,
      deletions,
    };
  } catch (_error) {
    // Not a git repository or git command failed
    return {
      modified: 0,
      added: 0,
      staged: 0,
      deleted: 0,
      ahead: 0,
      behind: 0,
      insertions: 0,
      deletions: 0,
    };
  }
}
