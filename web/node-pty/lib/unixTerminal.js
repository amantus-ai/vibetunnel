"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.UnixTerminal = void 0;
const path = __importStar(require("path"));
const tty = __importStar(require("tty"));
const terminal_1 = require("./terminal");
const utils_1 = require("./utils");
let pty;
let helperPath;
// Check if running in SEA (Single Executable Application) context
if (process.env.VIBETUNNEL_SEA) {
    // In SEA mode, load native module using process.dlopen
    const fs = require('fs');
    const execDir = path.dirname(process.execPath);
    const ptyPath = path.join(execDir, 'pty.node');
    if (fs.existsSync(ptyPath)) {
        const module = { exports: {} };
        process.dlopen(module, ptyPath);
        pty = module.exports;
    }
    else {
        throw new Error(`Could not find pty.node next to executable at: ${ptyPath}`);
    }
    // Set spawn-helper path for macOS only (Linux doesn't use it)
    if (process.platform === 'darwin') {
        helperPath = path.join(execDir, 'spawn-helper');
        if (!fs.existsSync(helperPath)) {
            console.warn(`spawn-helper not found at ${helperPath}, PTY operations may fail`);
        }
    }
}
else {
    // Standard Node.js loading
    try {
        pty = require('../build/Release/pty.node');
        helperPath = '../build/Release/spawn-helper';
    }
    catch (outerError) {
        try {
            pty = require('../build/Debug/pty.node');
            helperPath = '../build/Debug/spawn-helper';
        }
        catch (innerError) {
            console.error('innerError', innerError);
            throw outerError;
        }
    }
    helperPath = path.resolve(__dirname, helperPath);
    helperPath = helperPath.replace('app.asar', 'app.asar.unpacked');
    helperPath = helperPath.replace('node_modules.asar', 'node_modules.asar.unpacked');
}
const DEFAULT_FILE = 'sh';
const DEFAULT_NAME = 'xterm';
const DESTROY_SOCKET_TIMEOUT_MS = 200;
class UnixTerminal extends terminal_1.Terminal {
    get master() { return this._master; }
    get slave() { return this._slave; }
    constructor(file, args, opt) {
        super(opt);
        this._boundClose = false;
        this._emittedClose = false;
        if (typeof args === 'string') {
            throw new Error('args as a string is not supported on unix.');
        }
        // Initialize arguments
        args = args || [];
        file = file || DEFAULT_FILE;
        opt = opt || {};
        opt.env = opt.env || process.env;
        this._cols = opt.cols || terminal_1.DEFAULT_COLS;
        this._rows = opt.rows || terminal_1.DEFAULT_ROWS;
        const uid = opt.uid ?? -1;
        const gid = opt.gid ?? -1;
        const env = (0, utils_1.assign)({}, opt.env);
        if (opt.env === process.env) {
            this._sanitizeEnv(env);
        }
        const cwd = opt.cwd || process.cwd();
        env.PWD = cwd;
        const name = opt.name || env.TERM || DEFAULT_NAME;
        env.TERM = name;
        const parsedEnv = this._parseEnv(env);
        const encoding = (opt.encoding === undefined ? 'utf8' : opt.encoding);
        const onexit = (code, signal) => {
            // XXX Sometimes a data event is emitted after exit. Wait til socket is
            // destroyed.
            if (!this._emittedClose) {
                if (this._boundClose) {
                    return;
                }
                this._boundClose = true;
                // From macOS High Sierra 10.13.2 sometimes the socket never gets
                // closed. A timeout is applied here to avoid the terminal never being
                // destroyed when this occurs.
                let timeout = setTimeout(() => {
                    timeout = null;
                    // Destroying the socket now will cause the close event to fire
                    this._socket.destroy();
                }, DESTROY_SOCKET_TIMEOUT_MS);
                this.once('close', () => {
                    if (timeout !== null) {
                        clearTimeout(timeout);
                    }
                    this.emit('exit', code, signal);
                });
                return;
            }
            this.emit('exit', code, signal);
        };
        // fork
        const term = pty.fork(file, args, parsedEnv, cwd, this._cols, this._rows, uid, gid, (encoding === 'utf8'), helperPath, onexit);
        this._socket = new tty.ReadStream(term.fd);
        if (encoding !== null) {
            this._socket.setEncoding(encoding);
        }
        // setup
        this._socket.on('error', (err) => {
            // NOTE: fs.ReadStream gets EAGAIN twice at first:
            if (err.code) {
                if (~err.code.indexOf('EAGAIN')) {
                    return;
                }
            }
            // close
            this._close();
            // EIO on exit from fs.ReadStream:
            if (!this._emittedClose) {
                this._emittedClose = true;
                this.emit('close');
            }
            // EIO, happens when someone closes our child process: the only process in
            // the terminal.
            // node < 0.6.14: errno 5
            // node >= 0.6.14: read EIO
            if (err.code) {
                if (~err.code.indexOf('errno 5') || ~err.code.indexOf('EIO')) {
                    return;
                }
            }
            // throw anything else
            if (this.listeners('error').length < 2) {
                throw err;
            }
        });
        this._pid = term.pid;
        this._fd = term.fd;
        this._pty = term.pty;
        this._file = file;
        this._name = name;
        this._readable = true;
        this._writable = true;
        this._socket.on('close', () => {
            if (this._emittedClose) {
                return;
            }
            this._emittedClose = true;
            this._close();
            this.emit('close');
        });
        this._forwardEvents();
    }
    _write(data) {
        this._socket.write(data);
    }
    /* Accessors */
    get fd() { return this._fd; }
    get ptsName() { return this._pty; }
    /**
     * openpty
     */
    static open(opt) {
        const self = Object.create(UnixTerminal.prototype);
        opt = opt || {};
        if (arguments.length > 1) {
            opt = {
                cols: arguments[1],
                rows: arguments[2]
            };
        }
        const cols = opt.cols || terminal_1.DEFAULT_COLS;
        const rows = opt.rows || terminal_1.DEFAULT_ROWS;
        const encoding = (opt.encoding === undefined ? 'utf8' : opt.encoding);
        // open
        const term = pty.open(cols, rows);
        self._master = new tty.ReadStream(term.master);
        if (encoding !== null) {
            self._master.setEncoding(encoding);
        }
        self._master.resume();
        self._slave = new tty.ReadStream(term.slave);
        if (encoding !== null) {
            self._slave.setEncoding(encoding);
        }
        self._slave.resume();
        self._socket = self._master;
        self._pid = -1;
        self._fd = term.master;
        self._pty = term.pty;
        self._file = process.argv[0] || 'node';
        self._name = process.env.TERM || '';
        self._readable = true;
        self._writable = true;
        self._socket.on('error', err => {
            self._close();
            if (self.listeners('error').length < 2) {
                throw err;
            }
        });
        self._socket.on('close', () => {
            self._close();
        });
        return self;
    }
    destroy() {
        this._close();
        // Need to close the read stream so node stops reading a dead file
        // descriptor. Then we can safely SIGHUP the shell.
        this._socket.once('close', () => {
            this.kill('SIGHUP');
        });
        this._socket.destroy();
    }
    kill(signal) {
        try {
            process.kill(this.pid, signal || 'SIGHUP');
        }
        catch (e) { /* swallow */ }
    }
    /**
     * Gets the name of the process.
     */
    get process() {
        if (process.platform === 'darwin') {
            const title = pty.process(this._fd);
            return (title !== 'kernel_task') ? title : this._file;
        }
        return pty.process(this._fd, this._pty) || this._file;
    }
    /**
     * TTY
     */
    resize(cols, rows) {
        if (cols <= 0 || rows <= 0 || isNaN(cols) || isNaN(rows) || cols === Infinity || rows === Infinity) {
            throw new Error('resizing must be done using positive cols and rows');
        }
        pty.resize(this._fd, cols, rows);
        this._cols = cols;
        this._rows = rows;
    }
    clear() {
    }
    _sanitizeEnv(env) {
        // Make sure we didn't start our server from inside tmux.
        delete env['TMUX'];
        delete env['TMUX_PANE'];
        // Make sure we didn't start our server from inside screen.
        // http://web.mit.edu/gnu/doc/html/screen_20.html
        delete env['STY'];
        delete env['WINDOW'];
        // Delete some variables that might confuse our terminal.
        delete env['WINDOWID'];
        delete env['TERMCAP'];
        delete env['COLUMNS'];
        delete env['LINES'];
    }
}
exports.UnixTerminal = UnixTerminal;
