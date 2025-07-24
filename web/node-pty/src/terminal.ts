/**
 * Copyright (c) 2012-2015, Christopher Jeffrey (MIT License)
 * Copyright (c) 2016, Daniel Imms (MIT License).
 * Copyright (c) 2018, Microsoft Corporation (MIT License).
 */

import { Socket } from 'net';
import { EventEmitter } from 'events';
import { ITerminal, IPtyForkOptions, IProcessEnv } from './interfaces';
import { EventEmitter2, IEvent } from './eventEmitter2';
import { IExitEvent } from './types';

export const DEFAULT_COLS: number = 80;
export const DEFAULT_ROWS: number = 24;

/**
 * Default messages to indicate PAUSE/RESUME for automatic flow control.
 * To avoid conflicts with rebound XON/XOFF control codes (such as on-my-zsh),
 * the sequences can be customized in `IPtyForkOptions`.
 */
const FLOW_CONTROL_PAUSE =  '\x13';   // defaults to XOFF
const FLOW_CONTROL_RESUME = '\x11';   // defaults to XON

export abstract class Terminal implements ITerminal {
  protected _socket!: Socket; // Initialized in platform-specific subclass constructor
  protected _pid: number = 0;
  protected _fd: number = 0;
  protected _pty: any;

  protected _file!: string; // Initialized in platform-specific subclass constructor
  protected _name!: string; // Initialized in platform-specific subclass constructor
  protected _cols: number = 0;
  protected _rows: number = 0;

  protected _readable: boolean = false;
  protected _writable: boolean = false;

  protected _internalee: EventEmitter;
  private _flowControlPause: string;
  private _flowControlResume: string;
  public handleFlowControl: boolean;

  private _onData = new EventEmitter2<string>();
  public get onData(): IEvent<string> { return this._onData.event; }
  private _onExit = new EventEmitter2<IExitEvent>();
  public get onExit(): IEvent<IExitEvent> { return this._onExit.event; }

  public get pid(): number { return this._pid; }
  public get cols(): number { return this._cols; }
  public get rows(): number { return this._rows; }

  constructor(opt?: IPtyForkOptions) {
    // for 'close'
    this._internalee = new EventEmitter();

    // setup flow control handling
    this.handleFlowControl = !!(opt?.handleFlowControl);
    this._flowControlPause = opt?.flowControlPause || FLOW_CONTROL_PAUSE;
    this._flowControlResume = opt?.flowControlResume || FLOW_CONTROL_RESUME;

    if (!opt) {
      return;
    }

    // Do basic type checks here in case node-pty is being used within JavaScript. If the wrong
    // types go through to the C++ side it can lead to hard to diagnose exceptions.
    this._checkType('name', opt.name ? opt.name : undefined, 'string');
    this._checkType('cols', opt.cols ? opt.cols : undefined, 'number');
    this._checkType('rows', opt.rows ? opt.rows : undefined, 'number');
    this._checkType('cwd', opt.cwd ? opt.cwd : undefined, 'string');
    this._checkType('env', opt.env ? opt.env : undefined, 'object');
    this._checkType('uid', opt.uid ? opt.uid : undefined, 'number');
    this._checkType('gid', opt.gid ? opt.gid : undefined, 'number');
    this._checkType('encoding', opt.encoding ? opt.encoding : undefined, 'string');
  }

  protected abstract _write(data: string): void;

  public write(data: string): void {
    if (this.handleFlowControl) {
      // PAUSE/RESUME messages are not forwarded to the pty
      if (data === this._flowControlPause) {
        this.pause();
        return;
      }
      if (data === this._flowControlResume) {
        this.resume();
        return;
      }
    }
    // everything else goes to the real pty
    this._write(data);
  }

  protected _forwardEvents(): void {
    this.on('data', e => this._onData.fire(e));
    this.on('exit', (exitCode, signal) => this._onExit.fire({ exitCode, signal }));
  }

  protected _checkType<T>(name: string, value: T | undefined, type: string, allowArray: boolean = false): void {
    if (value === undefined) {
      return;
    }
    if (allowArray) {
      if (Array.isArray(value)) {
        value.forEach((v, i) => {
          if (typeof v !== type) {
            throw new Error(`${name}[${i}] must be a ${type} (not a ${typeof v})`);
          }
        });
        return;
      }
    }
    if (typeof value !== type) {
      throw new Error(`${name} must be a ${type} (not a ${typeof value})`);
    }
  }

  /** See net.Socket.end */
  public end(data: string): void {
    this._socket.end(data);
  }

  /** See stream.Readable.pipe */
  public pipe(dest: any, options: any): any {
    return this._socket.pipe(dest, options);
  }

  /** See net.Socket.pause */
  public pause(): Socket {
    return this._socket.pause();
  }

  /** See net.Socket.resume */
  public resume(): Socket {
    return this._socket.resume();
  }

  /** See net.Socket.setEncoding */
  public setEncoding(encoding: string | null): void {
    if ((this._socket as any)._decoder) {
      delete (this._socket as any)._decoder;
    }
    if (encoding) {
      this._socket.setEncoding(encoding as BufferEncoding);
    }
  }

  public addListener(eventName: string, listener: (...args: any[]) => any): void { this.on(eventName, listener); }
  public on(eventName: string, listener: (...args: any[]) => any): void {
    if (eventName === 'close') {
      this._internalee.on('close', listener);
      return;
    }
    this._socket.on(eventName, listener);
  }

  public emit(eventName: string, ...args: any[]): any {
    if (eventName === 'close') {
      return this._internalee.emit.apply(this._internalee, arguments as any);
    }
    return this._socket.emit.apply(this._socket, arguments as any);
  }

  public listeners(eventName: string): Function[] {
    return this._socket.listeners(eventName);
  }

  public removeListener(eventName: string, listener: (...args: any[]) => any): void {
    this._socket.removeListener(eventName, listener);
  }

  public removeAllListeners(eventName: string): void {
    this._socket.removeAllListeners(eventName);
  }

  public once(eventName: string, listener: (...args: any[]) => any): void {
    this._socket.once(eventName, listener);
  }

  public abstract resize(cols: number, rows: number): void;
  public abstract clear(): void;
  public abstract destroy(): void;
  public abstract kill(signal?: string): void;

  public abstract get process(): string;
  public abstract get master(): Socket| undefined;
  public abstract get slave(): Socket | undefined;

  protected _close(): void {
    this._socket.readable = false;
    this.write = () => {};
    this.end = () => {};
    this._writable = false;
    this._readable = false;
  }

  protected _parseEnv(env: IProcessEnv): string[] {
    const keys = Object.keys(env || {});
    const pairs = [];

    for (let i = 0; i < keys.length; i++) {
      if (keys[i] === undefined) {
        continue;
      }
      pairs.push(keys[i] + '=' + env[keys[i]]);
    }

    return pairs;
  }
}
