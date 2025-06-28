/**
 * TypeScript interfaces and types for PTY management
 *
 * These types match the tty-fwd format to ensure compatibility
 */

import type * as fs from 'fs';
import type * as net from 'net';
import type { IPty } from 'node-pty';
import type { SessionInfo } from '../../shared/types.js';
import type { WriteQueue } from '../utils/write-queue.js';
import type { AsciinemaWriter } from './asciinema-writer.js';

export interface AsciinemaHeader {
  version: number;
  width: number;
  height: number;
  timestamp?: number;
  duration?: number;
  command?: string;
  title?: string;
  env?: Record<string, string>;
  theme?: AsciinemaTheme;
}

export interface AsciinemaTheme {
  fg?: string;
  bg?: string;
  palette?: string;
}

export interface ControlMessage {
  cmd: string;
  [key: string]: unknown;
}

export interface ResizeControlMessage extends ControlMessage {
  cmd: 'resize';
  cols: number;
  rows: number;
}

export interface KillControlMessage extends ControlMessage {
  cmd: 'kill';
  signal?: string | number;
}

export interface ResetSizeControlMessage extends ControlMessage {
  cmd: 'reset-size';
}

export type AsciinemaEvent = {
  time: number;
  type: 'o' | 'i' | 'r' | 'm';
  data: string;
};

// Internal session state for PtyManager
export interface PtySession {
  id: string;
  sessionInfo: SessionInfo;
  ptyProcess?: IPty;
  asciinemaWriter?: AsciinemaWriter;
  controlDir: string;
  stdoutPath: string;
  stdinPath: string;
  controlPipePath: string;
  sessionJsonPath: string;
  startTime: Date;
  // Optional fields for resource cleanup
  inputSocketServer?: net.Server;
  controlWatcher?: fs.FSWatcher;
  stdinHandler?: (data: string) => void;
  stdoutQueue?: WriteQueue;
  // Prevent terminal title changes
  preventTitleChange?: boolean;
  // Set terminal title with working directory and command
  setTerminalTitle?: boolean;
  // Track current working directory for title updates
  currentWorkingDir?: string;
  // Track if initial title has been sent
  initialTitleSent?: boolean;
}

export class PtyError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly sessionId?: string
  ) {
    super(message);
    this.name = 'PtyError';
  }
}

// Utility type for session creation result
export interface SessionCreationResult {
  sessionId: string;
  sessionInfo: SessionInfo;
}
