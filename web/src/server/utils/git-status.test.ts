import { execFile } from 'child_process';
import { mkdtemp, rm, writeFile } from 'fs/promises';
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

  it('returns zero line counts outside a git repository', async () => {
    const dir = await createTempDir();

    const status = await getDetailedGitStatus(dir);

    expect(status.insertions).toBe(0);
    expect(status.deletions).toBe(0);
  });
});
