"use strict";
/**
 * Minimal PTY implementation without threading
 * Vendored from node-pty, simplified to remove shared pipe architecture
 */
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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTerminal = exports.fork = void 0;
exports.spawn = spawn;
let terminalCtor;
if (process.platform === 'win32') {
    terminalCtor = require('./windowsTerminal').WindowsTerminal;
}
else {
    terminalCtor = require('./unixTerminal').UnixTerminal;
}
/**
 * Forks a process as a pseudoterminal.
 */
function spawn(file, args, opt) {
    return new terminalCtor(file, args, opt);
}
// Deprecated aliases
exports.fork = spawn;
exports.createTerminal = spawn;
// Re-export types
__exportStar(require("./interfaces"), exports);
__exportStar(require("./types"), exports);
