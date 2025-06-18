/**
 * TypeScript interfaces and types for PTY management
 *
 * These types match the tty-fwd format to ensure compatibility
 */

export interface SessionInfo {
  cmdline: string[];
  name: string;
  cwd: string;
  pid?: number;
  status: 'starting' | 'running' | 'exited';
  exit_code?: number;
  started_at?: string;
  term: string;
  spawn_type: string;
}

export interface SessionListEntry {
  // Flatten session info
  cmdline: string[];
  name: string;
  cwd: string;
  pid?: number;
  status: 'starting' | 'running' | 'exited';
  exit_code?: number;
  started_at?: string;
  term: string;
  spawn_type: string;

  // Additional metadata
  'stream-out': string;
  stdin: string;
  'notification-stream': string;
  waiting: boolean;
}

export interface SessionEntryWithId {
  session_id: string;
  // Flatten the entry for compatibility
  cmdline: string[];
  name: string;
  cwd: string;
  pid?: number;
  status: 'starting' | 'running' | 'exited';
  exit_code?: number;
  started_at?: string;
  term: string;
  spawn_type: string;
  'stream-out': string;
  stdin: string;
  'notification-stream': string;
  waiting: boolean;
}

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

export type AsciinemaEventType = 'o' | 'i' | 'r' | 'm'; // output, input, resize, marker

export interface AsciinemaEvent {
  time: number;
  type: AsciinemaEventType;
  data: string;
}

export interface NotificationEvent {
  timestamp: string;
  event: string;
  data: unknown;
}

export interface SessionOptions {
  sessionName?: string;
  workingDir?: string;
  term?: string;
  cols?: number;
  rows?: number;
}

export interface PtyConfig {
  implementation: 'node-pty' | 'tty-fwd' | 'auto';
  controlPath: string;
  fallbackToTtyFwd: boolean;
  ttyFwdPath?: string;
}

export interface StreamEvent {
  type: 'header' | 'terminal' | 'exit' | 'error' | 'end';
  data?: unknown;
}

// Special keys that can be sent to sessions
export type SpecialKey =
  | 'arrow_up'
  | 'arrow_down'
  | 'arrow_left'
  | 'arrow_right'
  | 'escape'
  | 'enter'
  | 'ctrl_enter'
  | 'shift_enter';

// Internal session state for PtyManager
export interface PtySession {
  id: string;
  sessionInfo: SessionInfo;
  ptyProcess?: any; // node-pty IPty instance (typed as any to avoid import dependency)
  asciinemaWriter?: any; // AsciinemaWriter instance (typed as any to avoid import dependency)
  controlDir: string;
  streamOutPath: string;
  stdinPath: string;
  notificationPath: string;
  sessionJsonPath: string;
  startTime: Date;
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

// Utility type for session input
export interface SessionInput {
  text?: string;
  key?: SpecialKey;
}
