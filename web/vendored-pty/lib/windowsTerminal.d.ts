/**
 * Simplified Windows terminal implementation without threading
 * Removed ConoutSocketWorker and shared pipe architecture
 */
import { Socket } from 'net';
import { Terminal } from './terminal';
import { IPtyOpenOptions, IWindowsPtyForkOptions } from './interfaces';
import { ArgvOrCommandLine } from './types';
export declare class WindowsTerminal extends Terminal {
    private _isReady;
    protected _pid: number;
    private _innerPid;
    private _ptyNative;
    protected _pty: number;
    private _inSocket;
    private _outSocket;
    private _exitCode;
    private _useConptyDll;
    get master(): Socket | undefined;
    get slave(): Socket | undefined;
    constructor(file?: string, args?: ArgvOrCommandLine, opt?: IWindowsPtyForkOptions);
    private _setupDirectSockets;
    protected _write(data: string): void;
    resize(cols: number, rows: number): void;
    clear(): void;
    kill(signal?: string): void;
    protected _close(): void;
    private _generatePipeName;
    private _argsToCommandLine;
    static open(options?: IPtyOpenOptions): void;
    get process(): string;
    get pid(): number;
    destroy(): void;
}
