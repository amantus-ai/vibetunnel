/**
 * Simplified Windows terminal implementation without threading
 * Removed ConoutSocketWorker and shared pipe architecture
 */

import * as fs from 'fs';
import { Socket } from 'net';
import { Terminal, DEFAULT_COLS, DEFAULT_ROWS } from './terminal';
import { IPtyOpenOptions, IWindowsPtyForkOptions } from './interfaces';
import { ArgvOrCommandLine } from './types';
import { assign } from './utils';

const DEFAULT_FILE = 'cmd.exe';
const DEFAULT_NAME = 'Windows Shell';

// Native module interfaces
interface IConptyProcess {
  pty: number;
  fd: number;
  conin: string;
  conout: string;
}

interface IConptyNative {
  startProcess(file: string, cols: number, rows: number, debug: boolean, pipeName: string, inheritCursor: boolean, useConptyDll: boolean): IConptyProcess;
  connect(pty: number, commandLine: string, cwd: string, env: string[], useConptyDll: boolean, onExit: (exitCode: number) => void): { pid: number };
  resize(pty: number, cols: number, rows: number, useConptyDll: boolean): void;
  clear(pty: number, useConptyDll: boolean): void;
  kill(pty: number, useConptyDll: boolean): void;
}

let conptyNative: IConptyNative;

export class WindowsTerminal extends Terminal {
  private _isReady: boolean = false;
  protected _pid: number = 0;
  private _innerPid: number = 0;
  private _ptyNative: IConptyNative;
  protected _pty: number;
  private _inSocket!: Socket;
  private _outSocket!: Socket;
  private _exitCode: number | undefined;
  private _useConptyDll: boolean = false;

  public get master(): Socket | undefined { return this._outSocket; }
  public get slave(): Socket | undefined { return this._inSocket; }

  constructor(file?: string, args?: ArgvOrCommandLine, opt?: IWindowsPtyForkOptions) {
    super(opt);

    // Load native module
    if (!conptyNative) {
      try {
        conptyNative = require('../build/Release/conpty.node');
      } catch (outerError) {
        try {
          conptyNative = require('../build/Debug/conpty.node');
        } catch (innerError) {
          throw outerError;
        }
      }
    }
    this._ptyNative = conptyNative;

    // Initialize arguments
    args = args || [];
    file = file || DEFAULT_FILE;
    opt = opt || {};
    opt.env = opt.env || process.env;

    const env = assign({}, opt.env);
    this._cols = opt.cols || DEFAULT_COLS;
    this._rows = opt.rows || DEFAULT_ROWS;
    const cwd = opt.cwd || process.cwd();
    const parsedEnv = this._parseEnv(env);

    // Compose command line
    const commandLine = this._argsToCommandLine(file, args);

    // Start ConPTY process
    const pipeName = this._generatePipeName();
    const term = this._ptyNative.startProcess(file, this._cols, this._rows, false, pipeName, false, this._useConptyDll);
    
    this._pty = term.pty;
    this._fd = term.fd;

    // Create direct socket connections without worker threads
    this._setupDirectSockets(term);

    // Connect the process
    const connect = this._ptyNative.connect(this._pty, commandLine, cwd, parsedEnv, this._useConptyDll, (exitCode) => {
      this._exitCode = exitCode;
      this.emit('exit', exitCode);
      this._close();
    });
    this._innerPid = connect.pid;
    this._pid = connect.pid;

    this._file = file;
    this._name = opt.name || env.TERM || DEFAULT_NAME;
    this._readable = true;
    this._writable = true;

    this._forwardEvents();
  }

  private _setupDirectSockets(term: IConptyProcess): void {
    // Setup output socket - read directly from conout
    const outFd = fs.openSync(term.conout, 'r');
    this._outSocket = new Socket({ fd: outFd, readable: true, writable: false });
    this._outSocket.setEncoding('utf8');
    this._socket = this._outSocket;

    // Setup input socket - write directly to conin
    const inFd = fs.openSync(term.conin, 'w');
    this._inSocket = new Socket({ fd: inFd, readable: false, writable: true });
    this._inSocket.setEncoding('utf8');

    // Forward events directly
    this._outSocket.on('data', (data) => {
      if (!this._isReady) {
        this._isReady = true;
      }
      this.emit('data', data);
    });

    this._outSocket.on('error', (err) => {
      if ((err as any).code && ((err as any).code.includes('EPIPE') || (err as any).code.includes('EIO'))) {
        // Expected errors when process exits
        return;
      }
      this.emit('error', err);
    });

    this._outSocket.on('close', () => {
      if (this._exitCode === undefined) {
        this.emit('exit', 0);
      }
      this._close();
    });
  }

  protected _write(data: string): void {
    if (this._inSocket && this._inSocket.writable) {
      this._inSocket.write(data);
    }
  }

  public resize(cols: number, rows: number): void {
    if (cols <= 0 || rows <= 0 || isNaN(cols) || isNaN(rows) || cols === Infinity || rows === Infinity) {
      throw new Error('resizing must be done using positive cols and rows');
    }
    if (this._exitCode !== undefined) {
      throw new Error('Cannot resize a pty that has already exited');
    }
    this._cols = cols;
    this._rows = rows;
    this._ptyNative.resize(this._pty, cols, rows, this._useConptyDll);
  }

  public clear(): void {
    this._ptyNative.clear(this._pty, this._useConptyDll);
  }

  public kill(signal?: string): void {
    this._close();
    try {
      process.kill(this._pid);
    } catch (e) {
      // Ignore if process cannot be found
    }
    this._ptyNative.kill(this._pty, this._useConptyDll);
  }

  protected _close(): void {
    if (this._inSocket) {
      this._inSocket.destroy();
    }
    if (this._outSocket) {
      this._outSocket.destroy();
    }
  }

  private _generatePipeName(): string {
    return `\\\\.\\pipe\\conpty-${Date.now()}-${Math.random()}`;
  }

  private _argsToCommandLine(file: string, args: ArgvOrCommandLine): string {
    if (typeof args === 'string') {
      return `${file} ${args}`;
    }
    const argv = [file];
    if (args) {
      argv.push(...args);
    }
    return argv.map(arg => {
      if (arg.includes(' ') || arg.includes('\t')) {
        return `"${arg.replace(/"/g, '\\"')}"`;
      }
      return arg;
    }).join(' ');
  }

  public static open(options?: IPtyOpenOptions): void {
    throw new Error('open() not supported on windows, use spawn() instead.');
  }

  public get process(): string { return this._name; }
  public get pid(): number { return this._pid; }

  public destroy(): void {
    this.kill();
  }
}