import { existsSync } from 'fs';
import * as path from 'path';

/**
 * Get the path to the vt script for testing
 */
export function getVtScriptPath(): string {
  return path.join(process.cwd(), 'bin', 'vt');
}

/**
 * Get the path to the vibetunnel binary for testing
 */
export function getVibetunnelBinaryPath(): string {
  const nativeBinary = path.join(process.cwd(), 'native', 'vibetunnel');
  if (existsSync(nativeBinary)) {
    return nativeBinary;
  }

  const testBinary = path.join(process.cwd(), 'native', 'vibetunnel-test');
  if (existsSync(testBinary)) {
    return testBinary;
  }

  return path.join(process.cwd(), 'bin', 'vibetunnel');
}
