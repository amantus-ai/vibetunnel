import * as path from 'path';

/**
 * Get the path to the vt script for testing
 */
export function getVtScriptPath(): string {
  return path.join(process.cwd(), 'bin', 'vt');
}

/**
 * Get the path to the shellops binary for testing
 */
export function getShellopsBinaryPath(): string {
  return path.join(process.cwd(), 'native', 'shellops');
}
