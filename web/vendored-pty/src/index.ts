/**
 * Minimal PTY implementation without threading
 * Vendored from node-pty, simplified to remove shared pipe architecture
 */

import { ITerminal, IPtyForkOptions, IWindowsPtyForkOptions } from './interfaces';
import { ArgvOrCommandLine } from './types';

let terminalCtor: any;
if (process.platform === 'win32') {
  terminalCtor = require('./windowsTerminal').WindowsTerminal;
} else {
  terminalCtor = require('./unixTerminal').UnixTerminal;
}

/**
 * Forks a process as a pseudoterminal.
 */
export function spawn(file?: string, args?: ArgvOrCommandLine, opt?: IPtyForkOptions | IWindowsPtyForkOptions): ITerminal {
  return new terminalCtor(file, args, opt);
}

// Deprecated aliases
export const fork = spawn;
export const createTerminal = spawn;

// Re-export types
export * from './interfaces';
export * from './types';

// Alias for compatibility
export type IPty = ITerminal;