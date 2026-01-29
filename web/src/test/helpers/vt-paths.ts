import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Get the path to the vt script for testing
 */
export function getVtScriptPath(): string {
  return path.join(process.cwd(), 'bin', 'vt');
}

// Cache the native binary working status
let _nativeBinaryWorking: boolean | null = null;

/**
 * Check if the native binary works (can load all dependencies)
 */
export function isNativeBinaryWorking(): boolean {
  if (_nativeBinaryWorking !== null) {
    return _nativeBinaryWorking;
  }

  const nativePath = path.join(process.cwd(), 'native', 'shellops');
  if (!fs.existsSync(nativePath)) {
    _nativeBinaryWorking = false;
    return false;
  }
  try {
    // Try running --version to see if it loads properly
    execSync(`"${nativePath}" --version`, { stdio: 'pipe', timeout: 5000 });
    _nativeBinaryWorking = true;
    return true;
  } catch {
    // Binary exists but can't run (e.g., missing libnode.dylib)
    _nativeBinaryWorking = false;
    return false;
  }
}

/**
 * Get the path to the shellops binary for testing.
 * Returns the native binary path if working, otherwise the bin/shellops wrapper.
 */
export function getShellopsBinaryPath(): string {
  const nativePath = path.join(process.cwd(), 'native', 'shellops');

  // Try native binary first
  if (isNativeBinaryWorking()) {
    return nativePath;
  }

  // Fall back to bin/shellops which is the Node.js CLI wrapper
  const binShellops = path.join(process.cwd(), 'bin', 'shellops');
  if (fs.existsSync(binShellops)) {
    return binShellops;
  }

  // Last resort: return native path anyway (tests will fail with descriptive error)
  return nativePath;
}
