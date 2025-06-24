import type { ChildProcess } from 'child_process';

/**
 * Extracts the server port from stdout output
 * @param output - The stdout output string
 * @returns The port number if found, null otherwise
 */
export function extractPortFromOutput(output: string): number | null {
  // Try multiple patterns that the server might use
  const patterns = [
    /VibeTunnel Server running on http:\/\/localhost:(\d+)/,
    /Server listening on port (\d+)/,
  ];

  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match) {
      return Number.parseInt(match[1], 10);
    }
  }

  return null;
}

/**
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
