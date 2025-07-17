/**
 * Copyright (c) 2012-2015, Christopher Jeffrey (MIT License)
 * Copyright (c) 2016, Daniel Imms (MIT License).
 * Copyright (c) 2018, Microsoft Corporation (MIT License).
 */
import { Socket } from 'net';
import { EventEmitter } from 'events';
import { ITerminal, IPtyForkOptions, IProcessEnv } from './interfaces';
import { IEvent } from './eventEmitter2';
import { IExitEvent } from './types';
export declare const DEFAULT_COLS: number;
export declare const DEFAULT_ROWS: number;
export declare abstract class Terminal implements ITerminal {
    protected _socket: Socket;
    protected _pid: number;
    protected _fd: number;
    protected _pty: any;
    protected _file: string;
    protected _name: string;
    protected _cols: number;
    protected _rows: number;
    protected _readable: boolean;
    protected _writable: boolean;
    protected _internalee: EventEmitter;
    private _flowControlPause;
    private _flowControlResume;
    handleFlowControl: boolean;
    private _onData;
    get onData(): IEvent<string>;
    private _onExit;
    get onExit(): IEvent<IExitEvent>;
    get pid(): number;
    get cols(): number;
    get rows(): number;
    constructor(opt?: IPtyForkOptions);
    protected abstract _write(data: string): void;
    write(data: string): void;
    protected _forwardEvents(): void;
    protected _checkType<T>(name: string, value: T | undefined, type: string, allowArray?: boolean): void;
    /** See net.Socket.end */
    end(data: string): void;
    /** See stream.Readable.pipe */
    pipe(dest: any, options: any): any;
    /** See net.Socket.pause */
    pause(): Socket;
    /** See net.Socket.resume */
    resume(): Socket;
    /** See net.Socket.setEncoding */
    setEncoding(encoding: string | null): void;
    addListener(eventName: string, listener: (...args: any[]) => any): void;
    on(eventName: string, listener: (...args: any[]) => any): void;
    emit(eventName: string, ...args: any[]): any;
    listeners(eventName: string): Function[];
    removeListener(eventName: string, listener: (...args: any[]) => any): void;
    removeAllListeners(eventName: string): void;
    once(eventName: string, listener: (...args: any[]) => any): void;
    abstract resize(cols: number, rows: number): void;
    abstract clear(): void;
    abstract destroy(): void;
    abstract kill(signal?: string): void;
    abstract get process(): string;
    abstract get master(): Socket | undefined;
    abstract get slave(): Socket | undefined;
    protected _close(): void;
    protected _parseEnv(env: IProcessEnv): string[];
}
