/**
 * Minimal PTY implementation without threading
 * Vendored from node-pty, simplified to remove shared pipe architecture
 */
import { ITerminal, IPtyForkOptions, IWindowsPtyForkOptions } from './interfaces';
import { ArgvOrCommandLine } from './types';
/**
 * Forks a process as a pseudoterminal.
 */
export declare function spawn(file?: string, args?: ArgvOrCommandLine, opt?: IPtyForkOptions | IWindowsPtyForkOptions): ITerminal;
export declare const fork: typeof spawn;
export declare const createTerminal: typeof spawn;
export * from './interfaces';
export * from './types';
export type IPty = ITerminal;
