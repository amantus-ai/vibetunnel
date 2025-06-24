/**
 * @deprecated This file is deprecated. Import from './server-utils' instead.
 * 
 * This file is kept for backward compatibility and re-exports the functions
 * from the new unified server-utils module.
 */

import type { ChildProcess } from 'child_process';
import { extractPortFromOutput as _extractPortFromOutput, startTestServer } from './server-utils';

/**
 * @deprecated Use extractPortFromOutput from './server-utils' instead
 */
export const extractPortFromOutput = _extractPortFromOutput;

/**
 * @deprecated Use startTestServer from './server-utils' instead
 * 
 * Waits for the server to start and returns the port it's listening on
 * @param serverProcess - The server process to monitor
 * @param timeout - Maximum time to wait in milliseconds
 * @returns Promise that resolves with the port number
 */
export function waitForServerPort(serverProcess: ChildProcess, timeout = 10000): Promise<number> {
  return new Promise((resolve, reject) => {
    let outputBuffer = '';
    let resolved = false;

    const timeoutHandle = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        serverProcess.stdout?.off('data', dataListener);
        reject(new Error(`Server did not start within ${timeout}ms`));
      }
    }, timeout);

    const dataListener = (data: Buffer) => {
      outputBuffer += data.toString();
      const port = extractPortFromOutput(outputBuffer);

      if (port && !resolved) {
        resolved = true;
        clearTimeout(timeoutHandle);
        serverProcess.stdout?.off('data', dataListener);
        resolve(port);
      }
    };

    serverProcess.stdout?.on('data', dataListener);

    // Also listen to stderr for debugging
    serverProcess.stderr?.on('data', (data) => {
      console.error(`Server stderr: ${data}`);
    });
  });
}
