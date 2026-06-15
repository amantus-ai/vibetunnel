/**
 * Shared Git Status Utilities
 *
 * Provides a single implementation for parsing git status output
 * to avoid duplication across the codebase.
 */

import { execFile } from 'child_process';
import { createReadStream } from 'fs';
import { lstat } from 'fs/promises';
import { join } from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const GIT_BINARY_CHECK_BYTES = 8000;
const LINE_COUNT_MAX_FILE_BYTES = 1024 * 1024;
const LINE_COUNT_MAX_FILES = 256;
const LINE_COUNT_MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const UNTRACKED_FILE_READ_CONCURRENCY = 16;

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

async function countUntrackedFileInsertions(workingDir: string, relativePath: string) {
  const filePath = join(workingDir, relativePath);
  let insertions = 0;
  let bytesInspectedForBinary = 0;
  let hasContent = false;
  let lastByte = 0;

  for await (const chunk of createReadStream(filePath)) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const binaryBytesRemaining = Math.max(0, GIT_BINARY_CHECK_BYTES - bytesInspectedForBinary);

    if (binaryBytesRemaining > 0) {
      const bytesToInspect = Math.min(binaryBytesRemaining, buffer.length);
      if (buffer.subarray(0, bytesToInspect).includes(0)) return 0;
      bytesInspectedForBinary += bytesToInspect;
    }

    hasContent ||= buffer.length > 0;
    for (const byte of buffer) {
      if (byte === 0x0a) insertions++;
    }
    if (buffer.length > 0) lastByte = buffer[buffer.length - 1];
  }

  return insertions + (hasContent && lastByte !== 0x0a ? 1 : 0);
}

async function getFileInsertions(workingDir: string, includeTracked: boolean) {
  const { stdout: repositoryRootOutput } = await execFileAsync(
    'git',
    ['rev-parse', '--show-toplevel'],
    {
      cwd: workingDir,
      timeout: 5000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }
  );
  const repositoryRoot = repositoryRootOutput.trim();
  const args = ['ls-files'];
  if (includeTracked) args.push('--cached');
  args.push('--others', '--exclude-standard', '-z');

  const { stdout } = await execFileAsync('git', args, {
    cwd: repositoryRoot,
    timeout: 5000,
    encoding: 'buffer',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  const paths = stdout
    .toString()
    .split('\0')
    .filter((path) => path.length > 0);
  let insertions = 0;
  let bytesScheduled = 0;
  const filesToRead: string[] = [];

  // This runs in a two-second polling loop. Keep filesystem work bounded when
  // repositories contain large or numerous generated files that are not ignored.
  for (const path of paths.slice(0, LINE_COUNT_MAX_FILES)) {
    try {
      const stats = await lstat(join(repositoryRoot, path));
      if (stats.isSymbolicLink()) {
        insertions++;
      } else if (
        stats.isFile() &&
        stats.size <= LINE_COUNT_MAX_FILE_BYTES &&
        bytesScheduled + stats.size <= LINE_COUNT_MAX_TOTAL_BYTES
      ) {
        bytesScheduled += stats.size;
        filesToRead.push(path);
      }
    } catch {
      // Files can disappear between git listing them and the status refresh.
    }
  }

  for (let index = 0; index < filesToRead.length; index += UNTRACKED_FILE_READ_CONCURRENCY) {
    const counts = await Promise.all(
      filesToRead
        .slice(index, index + UNTRACKED_FILE_READ_CONCURRENCY)
        .map((path) => countUntrackedFileInsertions(repositoryRoot, path).catch(() => 0))
    );
    insertions += counts.reduce((total, count) => total + count, 0);
  }

  return insertions;
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

    let hasHead: boolean | null = null;
    try {
      await execFileAsync('git', ['rev-parse', '--verify', '--quiet', 'HEAD'], {
        cwd: workingDir,
        timeout: 5000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });
      hasHead = true;
    } catch (error) {
      const exitCode =
        typeof error === 'object' && error !== null && 'code' in error
          ? (error as { code?: unknown }).code
          : undefined;
      if (exitCode === 1) hasHead = false;
    }

    if (hasHead) {
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
        // Keep line counts conservative when diff fails for an existing repository.
      }
      insertions += await getFileInsertions(workingDir, false).catch(() => 0);
    } else if (hasHead === false) {
      // Without HEAD, every tracked and untracked file is new relative to the empty repository.
      insertions = await getFileInsertions(workingDir, true).catch(() => 0);
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
