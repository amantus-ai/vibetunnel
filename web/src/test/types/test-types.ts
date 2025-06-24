// Shared test type definitions

export interface SessionData {
  id: string;
  name?: string;
  cmdline?: string[];
  cwd?: string;
  pid?: number;
  status?: string;
  started_at?: string;
  exitCode?: number | null;
  term?: string;
  spawn_type?: string;
  cols?: number;
  rows?: number;
}

export interface ActivityStatus {
  isActive: boolean;
  timestamp: string;
  session: SessionData;
}

export interface BufferMessage {
  type: string;
  sessionId?: string;
  version?: string;
  message?: string;
}

// Type for WebSocket mock constructor
export interface MockWebSocketConstructor {
  new (url: string): WebSocket;
  CONNECTING: number;
  OPEN: number;
  CLOSING: number;
  CLOSED: number;
}

// Type for EventSource mock constructor
export interface MockEventSourceConstructor {
  new (url: string, eventSourceInitDict?: EventSourceInit): EventSource;
  CONNECTING: number;
  OPEN: number;
  CLOSED: number;
}
