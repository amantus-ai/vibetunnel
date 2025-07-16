import { type ChildProcess, exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';

export const execAsync = promisify(exec);

export interface ChildProcessPromise extends ChildProcess {
  promise?: Promise<void>;
}

export function spawnAsync(
  command: string,
  args: string[] = [],
  options: any = {}
): ChildProcessPromise {
  const child = spawn(command, args, options) as ChildProcessPromise;

  child.promise = new Promise((resolve, reject) => {
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Process exited with code ${code}`));
      }
    });

    child.on('error', reject);
  });

  return child;
}
