/**
 * Copyright (c) 2012-2015, Christopher Jeffrey (MIT License)
 * Copyright (c) 2016, Daniel Imms (MIT License).
 * Copyright (c) 2018, Microsoft Corporation (MIT License).
 */
import * as net from 'net';
import { Terminal } from './terminal';
import { IPtyForkOptions, IPtyOpenOptions } from './interfaces';
import { ArgvOrCommandLine } from './types';
export declare class UnixTerminal extends Terminal {
    protected _fd: number;
    protected _pty: string;
    protected _file: string;
    protected _name: string;
    protected _readable: boolean;
    protected _writable: boolean;
    private _boundClose;
    private _emittedClose;
    private _master;
    private _slave;
    get master(): net.Socket | undefined;
    get slave(): net.Socket | undefined;
    constructor(file?: string, args?: ArgvOrCommandLine, opt?: IPtyForkOptions);
    protected _write(data: string): void;
    get fd(): number;
    get ptsName(): string;
    /**
     * openpty
     */
    static open(opt: IPtyOpenOptions): UnixTerminal;
    destroy(): void;
    kill(signal?: string): void;
    /**
     * Gets the name of the process.
     */
    get process(): string;
    /**
     * TTY
     */
    resize(cols: number, rows: number): void;
    clear(): void;
    private _sanitizeEnv;
}
