import { spawnSync } from 'child_process';
import { afterAll, describe, expect, it } from 'vitest';

function isDockerAvailable(): boolean {
  const result = spawnSync('docker', ['info'], { stdio: 'ignore' });
  return result.status === 0;
}

function runDocker(args: string[], cwd: string): { stdout: string; stderr: string } {
  const result = spawnSync('docker', args, {
    cwd,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(
      `docker ${args.join(' ')} failed with code ${result.status ?? 'null'}\n` +
        `stdout:\n${result.stdout || ''}\n` +
        `stderr:\n${result.stderr || ''}`
    );
  }

  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

const describeDocker = isDockerAvailable() ? describe : describe.skip;

describeDocker('Dockerfile.standalone', () => {
  const projectRoot = process.cwd();
  const imageTag = `vibetunnel-standalone-test:${Date.now()}`;

  afterAll(() => {
    spawnSync('docker', ['image', 'rm', '-f', imageTag], { stdio: 'ignore' });
  });

  it(
    'builds and runs --version',
    () => {
      runDocker(['build', '-f', 'Dockerfile.standalone', '-t', imageTag, '.'], projectRoot);
      const runResult = runDocker(['run', '--rm', imageTag, '--version'], projectRoot);
      expect(runResult.stdout).toContain('VibeTunnel');
    },
    10 * 60 * 1000
  );
});
