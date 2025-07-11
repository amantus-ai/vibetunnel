"use strict";
/**
 * Copyright (c) 2012-2015, Christopher Jeffrey (MIT License)
 * Copyright (c) 2016, Daniel Imms (MIT License).
 * Copyright (c) 2018, Microsoft Corporation (MIT License).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Terminal = exports.DEFAULT_ROWS = exports.DEFAULT_COLS = void 0;
const events_1 = require("events");
const eventEmitter2_1 = require("./eventEmitter2");
exports.DEFAULT_COLS = 80;
exports.DEFAULT_ROWS = 24;
/**
 * Default messages to indicate PAUSE/RESUME for automatic flow control.
 * To avoid conflicts with rebound XON/XOFF control codes (such as on-my-zsh),
 * the sequences can be customized in `IPtyForkOptions`.
 */
const FLOW_CONTROL_PAUSE = '\x13'; // defaults to XOFF
const FLOW_CONTROL_RESUME = '\x11'; // defaults to XON
class Terminal {
    get onData() { return this._onData.event; }
    get onExit() { return this._onExit.event; }
    get pid() { return this._pid; }
    get cols() { return this._cols; }
    get rows() { return this._rows; }
    constructor(opt) {
        this._pid = 0;
        this._fd = 0;
        this._cols = 0;
        this._rows = 0;
        this._readable = false;
        this._writable = false;
        this._onData = new eventEmitter2_1.EventEmitter2();
        this._onExit = new eventEmitter2_1.EventEmitter2();
        // for 'close'
        this._internalee = new events_1.EventEmitter();
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
    write(data) {
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
    _forwardEvents() {
        this.on('data', e => this._onData.fire(e));
        this.on('exit', (exitCode, signal) => this._onExit.fire({ exitCode, signal }));
    }
    _checkType(name, value, type, allowArray = false) {
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
    end(data) {
        this._socket.end(data);
    }
    /** See stream.Readable.pipe */
    pipe(dest, options) {
        return this._socket.pipe(dest, options);
    }
    /** See net.Socket.pause */
    pause() {
        return this._socket.pause();
    }
    /** See net.Socket.resume */
    resume() {
        return this._socket.resume();
    }
    /** See net.Socket.setEncoding */
    setEncoding(encoding) {
        if (this._socket._decoder) {
            delete this._socket._decoder;
        }
        if (encoding) {
            this._socket.setEncoding(encoding);
        }
    }
    addListener(eventName, listener) { this.on(eventName, listener); }
    on(eventName, listener) {
        if (eventName === 'close') {
            this._internalee.on('close', listener);
            return;
        }
        this._socket.on(eventName, listener);
    }
    emit(eventName, ...args) {
        if (eventName === 'close') {
            return this._internalee.emit.apply(this._internalee, arguments);
        }
        return this._socket.emit.apply(this._socket, arguments);
    }
    listeners(eventName) {
        return this._socket.listeners(eventName);
    }
    removeListener(eventName, listener) {
        this._socket.removeListener(eventName, listener);
    }
    removeAllListeners(eventName) {
        this._socket.removeAllListeners(eventName);
    }
    once(eventName, listener) {
        this._socket.once(eventName, listener);
    }
    _close() {
        this._socket.readable = false;
        this.write = () => { };
        this.end = () => { };
        this._writable = false;
        this._readable = false;
    }
    _parseEnv(env) {
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
exports.Terminal = Terminal;
