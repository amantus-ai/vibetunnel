import {
  decodeWsV3Frame,
  encodeWsV3Frame,
  encodeWsV3ResizePayload,
  encodeWsV3SubscribePayload,
  WsV3MessageType,
  WsV3SubscribeFlags,
} from '../../shared/ws-v3.js';
import { createLogger } from '../utils/logger.js';
import { authClient } from './auth-client.js';

const logger = createLogger('terminal-socket-client');

export interface BufferCell {
  char: string;
  width: number;
  fg?: number;
  bg?: number;
  attributes?: number;
}

export interface BufferSnapshot {
  cols: number;
  rows: number;
  viewportY: number;
  cursorX: number;
  cursorY: number;
  cells: BufferCell[][];
}

export type TerminalSocketEvent =
  | { kind: 'event'; sessionId: string; data: unknown }
  | { kind: 'error'; sessionId: string; message: string };

type Subscription = {
  wantStdout: boolean;
  wantSnapshots: boolean;
  wantEvents: boolean;
  onStdout?: (data: Uint8Array) => void;
  onSnapshot?: (snapshot: BufferSnapshot) => void;
  onEvent?: (data: unknown) => void;
  onError?: (message: string) => void;
};

type SessionSubs = {
  subs: Set<Subscription>;
  flags: number;
};

export class TerminalSocketClient {
  private ws: WebSocket | null = null;
  private isConnecting = false;
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  private pingInterval: number | null = null;
  private isConnected = false;
  private connectionStateHandlers: Set<(connected: boolean) => void> = new Set();

  private initialized = false;
  private noAuthMode: boolean | null = null;

  private sessions = new Map<string, SessionSubs>();
  private messageQueue: Uint8Array[] = [];
  private encoder = new TextEncoder();

  async initialize() {
    if (this.initialized) return;
    this.initialized = true;

    await this.checkNoAuthMode();
    setTimeout(() => this.connect(), 100);
  }

  private async checkNoAuthMode(): Promise<void> {
    try {
      const response = await fetch('/api/auth/config');
      if (response.ok) {
        const config = await response.json();
        this.noAuthMode = config.noAuth === true;
      }
    } catch (error) {
      logger.warn('Failed to check auth config:', error);
      this.noAuthMode = false;
    }
  }

  private isNoAuthMode(): boolean {
    return this.noAuthMode === true;
  }

  private connect() {
    if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) return;

    const currentUser = authClient.getCurrentUser();
    const token = currentUser?.token;

    if (!token && !this.isNoAuthMode()) {
      logger.debug('No auth token available yet, postponing v3 socket connect');
      setTimeout(() => {
        if (this.initialized && !this.ws) this.connect();
      }, 500);
      return;
    }

    this.isConnecting = true;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let wsUrl = `${protocol}//${window.location.host}/ws`;
    if (token) wsUrl += `?token=${encodeURIComponent(token)}`;

    try {
      this.ws = new WebSocket(wsUrl);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => {
        this.isConnecting = false;
        this.reconnectAttempts = 0;
        this.setConnected(true);
        this.startPingPong();

        // Flush queued frames
        while (this.messageQueue.length > 0) {
          const msg = this.messageQueue.shift();
          if (msg) this.safeSend(msg);
        }

        // Re-subscribe all sessions (aggregate flags)
        for (const [sessionId, info] of this.sessions) {
          const payload = encodeWsV3SubscribePayload({ flags: info.flags });
          this.safeSend(encodeWsV3Frame({ type: WsV3MessageType.SUBSCRIBE, sessionId, payload }));
        }
      };

      this.ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          this.handleBinary(event.data);
        }
      };

      this.ws.onerror = (error) => {
        logger.debug('v3 socket error', error);
      };

      this.ws.onclose = () => {
        this.isConnecting = false;
        this.stopPingPong();
        this.setConnected(false);
        this.ws = null;
        this.scheduleReconnect();
      };
    } catch (error) {
      logger.error('failed to create v3 websocket', error);
      this.isConnecting = false;
      this.setConnected(false);
      this.scheduleReconnect();
    }
  }

  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  onConnectionStateChange(handler: (connected: boolean) => void): () => void {
    this.connectionStateHandlers.add(handler);
    return () => this.connectionStateHandlers.delete(handler);
  }

  private setConnected(connected: boolean) {
    if (this.isConnected === connected) return;
    this.isConnected = connected;
    for (const handler of this.connectionStateHandlers) {
      try {
        handler(connected);
      } catch (error) {
        logger.debug('connection state handler error', error);
      }
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30000);
    this.reconnectAttempts++;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private startPingPong() {
    if (this.pingInterval) return;
    this.pingInterval = window.setInterval(() => {
      this.sendFrame(
        encodeWsV3Frame({ type: WsV3MessageType.PING, payload: this.encoder.encode('ping') })
      );
    }, 20000);
  }

  private stopPingPong() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private safeSend(buffer: Uint8Array) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(buffer);
    } else {
      this.messageQueue.push(buffer);
      if (this.initialized && !this.ws) this.connect();
    }
  }

  private sendFrame(buffer: Uint8Array) {
    this.safeSend(buffer);
  }

  subscribe(
    sessionId: string,
    opts: {
      stdout?: boolean;
      snapshots?: boolean;
      events?: boolean;
      onStdout?: (data: Uint8Array) => void;
      onSnapshot?: (snapshot: BufferSnapshot) => void;
      onEvent?: (data: unknown) => void;
      onError?: (message: string) => void;
    }
  ): () => void {
    if (!this.initialized) this.initialize();

    const subscription: Subscription = {
      wantStdout: opts.stdout === true,
      wantSnapshots: opts.snapshots === true,
      wantEvents: opts.events === true,
      onStdout: opts.onStdout,
      onSnapshot: opts.onSnapshot,
      onEvent: opts.onEvent,
      onError: opts.onError,
    };

    let session = this.sessions.get(sessionId);
    if (!session) {
      session = { subs: new Set(), flags: 0 };
      this.sessions.set(sessionId, session);
    }

    session.subs.add(subscription);
    this.updateSessionFlagsAndNotify(sessionId);

    return () => {
      const s = this.sessions.get(sessionId);
      if (!s) return;
      s.subs.delete(subscription);
      if (s.subs.size === 0) {
        this.sessions.delete(sessionId);
        this.sendFrame(encodeWsV3Frame({ type: WsV3MessageType.UNSUBSCRIBE, sessionId }));
      } else {
        this.updateSessionFlagsAndNotify(sessionId);
      }
    };
  }

  private updateSessionFlagsAndNotify(sessionId: string) {
    const s = this.sessions.get(sessionId);
    if (!s) return;

    let flags = 0;
    for (const sub of s.subs) {
      if (sub.wantStdout) flags |= WsV3SubscribeFlags.Stdout;
      if (sub.wantSnapshots) flags |= WsV3SubscribeFlags.Snapshots;
      if (sub.wantEvents) flags |= WsV3SubscribeFlags.Events;
    }

    if (flags === s.flags) return;
    s.flags = flags;
    const payload = encodeWsV3SubscribePayload({ flags });
    this.sendFrame(encodeWsV3Frame({ type: WsV3MessageType.SUBSCRIBE, sessionId, payload }));
  }

  sendInputText(sessionId: string, text: string): boolean {
    if (!sessionId) return false;
    const payload = this.encoder.encode(text);
    this.sendFrame(encodeWsV3Frame({ type: WsV3MessageType.INPUT_TEXT, sessionId, payload }));
    return true;
  }

  sendInputKey(sessionId: string, key: string): boolean {
    if (!sessionId) return false;
    const payload = this.encoder.encode(key);
    this.sendFrame(encodeWsV3Frame({ type: WsV3MessageType.INPUT_KEY, sessionId, payload }));
    return true;
  }

  resize(sessionId: string, cols: number, rows: number): boolean {
    if (!sessionId) return false;
    const payload = encodeWsV3ResizePayload(cols, rows);
    this.sendFrame(encodeWsV3Frame({ type: WsV3MessageType.RESIZE, sessionId, payload }));
    return true;
  }

  kill(sessionId: string, signal: string): boolean {
    if (!sessionId) return false;
    const payload = this.encoder.encode(signal);
    this.sendFrame(encodeWsV3Frame({ type: WsV3MessageType.KILL, sessionId, payload }));
    return true;
  }

  resetSize(sessionId: string): boolean {
    if (!sessionId) return false;
    this.sendFrame(encodeWsV3Frame({ type: WsV3MessageType.RESET_SIZE, sessionId }));
    return true;
  }

  private handleBinary(data: ArrayBuffer) {
    const frame = decodeWsV3Frame(new Uint8Array(data));
    if (!frame) return;

    const session = this.sessions.get(frame.sessionId);
    const globalEvents = frame.sessionId !== '' ? this.sessions.get('') : null;

    if (frame.type === WsV3MessageType.STDOUT) {
      if (!session) return;
      const bytes = frame.payload;
      for (const sub of session.subs) {
        if (sub.wantStdout) sub.onStdout?.(bytes);
      }
      return;
    }

    if (frame.type === WsV3MessageType.EVENT) {
      let obj: unknown = null;
      try {
        obj = JSON.parse(new TextDecoder().decode(frame.payload));
      } catch {
        obj = new TextDecoder().decode(frame.payload);
      }

      if (session) {
        for (const sub of session.subs) {
          if (sub.wantEvents) sub.onEvent?.(obj);
        }
      }

      if (globalEvents) {
        for (const sub of globalEvents.subs) {
          if (sub.wantEvents) sub.onEvent?.(obj);
        }
      }
      return;
    }

    if (frame.type === WsV3MessageType.ERROR) {
      let message = new TextDecoder().decode(frame.payload);
      try {
        const parsed = JSON.parse(message) as { message?: string };
        if (parsed?.message) message = parsed.message;
      } catch {
        // ignore
      }

      if (session) {
        for (const sub of session.subs) sub.onError?.(message);
      }
      if (globalEvents) {
        for (const sub of globalEvents.subs) sub.onError?.(message);
      }
      return;
    }

    if (frame.type === WsV3MessageType.SNAPSHOT_VT) {
      if (!session) return;
      // Avoid circular dependency; decode lazily.
      import('../utils/terminal-renderer.js')
        .then(({ TerminalRenderer }) => {
          try {
            const payload = frame.payload;
            // TerminalRenderer expects ArrayBuffer (not SharedArrayBuffer). Copy to detach.
            const copy = new Uint8Array(payload.byteLength);
            copy.set(payload);
            const snapshot = TerminalRenderer.decodeBinaryBuffer(copy.buffer);
            for (const sub of session.subs) {
              if (sub.wantSnapshots) sub.onSnapshot?.(snapshot);
            }
          } catch (error) {
            logger.error('failed to decode snapshot', error);
          }
        })
        .catch((error) => {
          logger.error('failed to import terminal renderer', error);
        });
    }
  }
}

export const terminalSocketClient = new TerminalSocketClient();
