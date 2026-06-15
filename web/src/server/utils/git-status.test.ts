import { execFile } from 'child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { afterEach, describe, expect, it } from 'vitest';
import { getDetailedGitStatus } from './git-status.js';

const execFileAsync = promisify(execFile);

describe('getDetailedGitStatus', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  async function createTempDir() {
    const dir = await mkdtemp(join(tmpdir(), 'vibetunnel-git-status-'));
    tempDirs.push(dir);
    return dir;
  }

  async function git(cwd: string, args: string[]) {
    await execFileAsync('git', args, {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
  }

  it('includes line insertion and deletion counts', async () => {
    const repoDir = await createTempDir();

    await git(repoDir, ['init']);
    await git(repoDir, ['config', 'user.email', 'test@example.com']);
    await git(repoDir, ['config', 'user.name', 'Test User']);

    const filePath = join(repoDir, 'example.txt');
    await writeFile(filePath, 'alpha\nbeta\ngamma\n');
    await git(repoDir, ['add', 'example.txt']);
    await git(repoDir, ['commit', '-m', 'initial']);

    await writeFile(filePath, 'alpha\ngamma\ndelta\nepsilon\n');

    const status = await getDetailedGitStatus(repoDir);

    expect(status.modified).toBe(1);
    expect(status.insertions).toBe(2);
    expect(status.deletions).toBe(1);
  });

  it('includes lines from untracked files', async () => {
    const repoDir = await createTempDir();

    await git(repoDir, ['init']);
    await git(repoDir, ['config', 'user.email', 'test@example.com']);
    await git(repoDir, ['config', 'user.name', 'Test User']);
    await git(repoDir, ['commit', '--allow-empty', '-m', 'initial']);

    await writeFile(join(repoDir, 'untracked.txt'), 'alpha\nbeta');
    await writeFile(join(repoDir, 'binary.dat'), Buffer.from([0, 1, 2, 3]));

    const status = await getDetailedGitStatus(repoDir);

    expect(status.added).toBe(2);
    expect(status.insertions).toBe(2);
    expect(status.deletions).toBe(0);
  });

  it('bounds line counting for large untracked files', async () => {
    const repoDir = await createTempDir();

    await git(repoDir, ['init']);
    await git(repoDir, ['config', 'user.email', 'test@example.com']);
    await git(repoDir, ['config', 'user.name', 'Test User']);
    await git(repoDir, ['commit', '--allow-empty', '-m', 'initial']);

    await writeFile(join(repoDir, 'large.txt'), Buffer.alloc(2 * 1024 * 1024, 0x61));
    await writeFile(join(repoDir, 'small.txt'), 'counted\n');

    const status = await getDetailedGitStatus(repoDir);

    expect(status.added).toBe(2);
    expect(status.insertions).toBe(1);
    expect(status.deletions).toBe(0);
  });

  it('includes tracked and untracked lines before the first commit', async () => {
    const repoDir = await createTempDir();

    await git(repoDir, ['init']);
    await writeFile(join(repoDir, 'first.txt'), 'first\nsecond\n');
    await git(repoDir, ['add', 'first.txt']);
    await writeFile(join(repoDir, 'second.txt'), 'third\n');

    const status = await getDetailedGitStatus(repoDir);

    expect(status.added).toBe(1);
    expect(status.staged).toBe(1);
    expect(status.insertions).toBe(3);
    expect(status.deletions).toBe(0);
  });

  it('includes repository-wide untracked lines from a subdirectory', async () => {
    const repoDir = await createTempDir();
    const subdirectory = join(repoDir, 'nested');

    await git(repoDir, ['init']);
    await git(repoDir, ['config', 'user.email', 'test@example.com']);
    await git(repoDir, ['config', 'user.name', 'Test User']);
    await git(repoDir, ['commit', '--allow-empty', '-m', 'initial']);
    await mkdir(subdirectory);
    await writeFile(join(repoDir, 'root.txt'), 'root\nlines\n');
    await writeFile(join(subdirectory, 'nested.txt'), 'nested\n');

    const status = await getDetailedGitStatus(subdirectory);

    expect(status.added).toBe(2);
    expect(status.insertions).toBe(3);
    expect(status.deletions).toBe(0);
  });

  it('returns zero line counts outside a git repository', async () => {
    const dir = await createTempDir();

    const status = await getDetailedGitStatus(dir);

    expect(status.insertions).toBe(0);
    expect(status.deletions).toBe(0);
  });
});
