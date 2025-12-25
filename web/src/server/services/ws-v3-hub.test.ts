import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import type { ServerEvent } from '../../shared/types.js';
import { ServerEventType } from '../../shared/types.js';
import {
  decodeWsV3Frame,
  encodeWsV3Frame,
  encodeWsV3ResizePayload,
  encodeWsV3SubscribePayload,
  WsV3MessageType,
  WsV3SubscribeFlags,
} from '../../shared/ws-v3.js';
import type { PtyManager } from '../pty/index.js';
import type { CastOutputHub, CastOutputHubListener } from './cast-output-hub.js';
import type { GitStatusHub, GitStatusHubListener } from './git-status-hub.js';
import type { SessionMonitor } from './session-monitor.js';
import type { TerminalManager } from './terminal-manager.js';
import { type WebSocketRequestV3, WsV3Hub } from './ws-v3-hub.js';

vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({
    log: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

class FakeWebSocket extends EventEmitter {
  readyState = WebSocket.OPEN;
  sent: Uint8Array[] = [];
  send = vi.fn((data: Uint8Array) => {
    this.sent.push(new Uint8Array(data));
  });
  close = vi.fn(() => {
    this.readyState = WebSocket.CLOSED;
    this.emit('close');
  });
}

function decodeLastFrame(ws: FakeWebSocket) {
  const raw = ws.sent.at(-1);
  if (!raw) throw new Error('no ws sends');
  const frame = decodeWsV3Frame(raw);
  if (!frame) throw new Error('failed to decode ws v3 frame');
  return frame;
}

function sendBinaryFrame(ws: FakeWebSocket, frame: Uint8Array) {
  ws.emit('message', Buffer.from(frame), true);
}

async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

describe('WsV3Hub', () => {
  type BufferChangeListener = Parameters<TerminalManager['subscribeToBufferChanges']>[1];

  let ptyManager: PtyManager;
  let terminalManager: TerminalManager;
  let castOutputHub: CastOutputHub;
  let gitStatusHub: GitStatusHub;
  let sessionMonitor: EventEmitter;
  let hub: WsV3Hub;

  let castListener: CastOutputHubListener | undefined;
  let snapshotListener: BufferChangeListener | undefined;
  let gitListener: GitStatusHubListener | undefined;

  beforeEach(() => {
    castListener = undefined;
    snapshotListener = undefined;
    gitListener = undefined;

    type PtySessionStub = { gitRepoPath?: string; workingDir?: string } | null;
    const getSession = vi.fn<(sessionId: string) => PtySessionStub>(() => null);

    ptyManager = {
      getSession,
      sendInput: vi.fn<PtyManager['sendInput']>(),
      resizeSession: vi.fn<PtyManager['resizeSession']>(),
      killSession: vi.fn<PtyManager['killSession']>(async () => {}),
      resetSessionSize: vi.fn<PtyManager['resetSessionSize']>(),
    } as unknown as PtyManager;

    type SubscribeToBufferChangesFn = (
      sessionId: string,
      listener: BufferChangeListener
    ) => Promise<() => void>;

    terminalManager = {
      subscribeToBufferChanges: vi.fn<SubscribeToBufferChangesFn>(async (_sessionId, cb) => {
        snapshotListener = cb;
        return vi.fn();
      }),
      encodeSnapshot: vi.fn(() => Buffer.from([9, 9, 9])),
    } as unknown as TerminalManager;

    type CastSubscribeFn = (sessionId: string, listener: CastOutputHubListener) => () => void;
    castOutputHub = {
      subscribe: vi.fn<CastSubscribeFn>((_sessionId, listener) => {
        castListener = listener;
        return vi.fn();
      }),
    } as unknown as CastOutputHub;

    type GitStartWatchingFn = GitStatusHub['startWatching'];
    type GitAddClientFn = GitStatusHub['addClient'];
    type GitRemoveClientFn = GitStatusHub['removeClient'];
    gitStatusHub = {
      startWatching: vi.fn<GitStartWatchingFn>(),
      addClient: vi.fn<GitAddClientFn>((_sessionId, listener) => {
        gitListener = listener;
      }),
      removeClient: vi.fn<GitRemoveClientFn>(),
    } as unknown as GitStatusHub;

    sessionMonitor = new EventEmitter();

    hub = new WsV3Hub({
      ptyManager,
      terminalManager,
      castOutputHub,
      gitStatusHub,
      sessionMonitor: sessionMonitor as unknown as SessionMonitor,
      remoteRegistry: null,
      isHQMode: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends WELCOME on connect', () => {
    const ws = new FakeWebSocket();
    hub.handleClientConnection(
      ws as unknown as WebSocket,
      { userId: 'u', authMethod: 'token' } as unknown as WebSocketRequestV3
    );
    const first = ws.sent[0];
    if (!first) throw new Error('expected welcome frame');
    const frame = decodeWsV3Frame(first);
    expect(frame?.type).toBe(WsV3MessageType.WELCOME);
  });

  it('acks global events subscription + broadcasts sessionMonitor events', async () => {
    const ws = new FakeWebSocket();
    hub.handleClientConnection(ws as unknown as WebSocket, {} as unknown as WebSocketRequestV3);

    sendBinaryFrame(
      ws,
      encodeWsV3Frame({
        type: WsV3MessageType.SUBSCRIBE,
        sessionId: '',
        payload: encodeWsV3SubscribePayload({ flags: WsV3SubscribeFlags.Events }),
      })
    );
    await flush();

    const ack = decodeLastFrame(ws);
    expect(ack.type).toBe(WsV3MessageType.EVENT);
    expect(ack.sessionId).toBe('');
    expect(JSON.parse(new TextDecoder().decode(ack.payload))).toMatchObject({ type: 'connected' });

    const evt: ServerEvent = {
      type: ServerEventType.SessionExit,
      sessionId: 's1',
      exitCode: 0,
      timestamp: new Date().toISOString(),
    };
    sessionMonitor.emit('notification', evt);
    await flush();

    const forwarded = decodeLastFrame(ws);
    expect(forwarded.type).toBe(WsV3MessageType.EVENT);
    expect(forwarded.sessionId).toBe('s1');
    expect(JSON.parse(new TextDecoder().decode(forwarded.payload))).toMatchObject({
      type: ServerEventType.SessionExit,
      exitCode: 0,
      sessionId: 's1',
    });
  });

  it('forwards stdout events when subscribed', async () => {
    const ws = new FakeWebSocket();
    hub.handleClientConnection(ws as unknown as WebSocket, {} as unknown as WebSocketRequestV3);

    sendBinaryFrame(
      ws,
      encodeWsV3Frame({
        type: WsV3MessageType.SUBSCRIBE,
        sessionId: 's1',
        payload: encodeWsV3SubscribePayload({ flags: WsV3SubscribeFlags.Stdout }),
      })
    );
    await flush();

    expect(castOutputHub.subscribe).toHaveBeenCalledWith('s1', expect.any(Function));
    expect(castListener).toBeTypeOf('function');

    if (!castListener) throw new Error('expected cast listener');
    castListener({ kind: 'output', data: 'hello' });
    await flush();
    const stdout = decodeLastFrame(ws);
    expect(stdout.type).toBe(WsV3MessageType.STDOUT);
    expect(stdout.sessionId).toBe('s1');
    expect(new TextDecoder().decode(stdout.payload)).toBe('hello');

    castListener({ kind: 'exit', exitCode: 0 });
    await flush();
    const exitEvt = decodeLastFrame(ws);
    expect(exitEvt.type).toBe(WsV3MessageType.EVENT);
    expect(exitEvt.sessionId).toBe('s1');
    expect(JSON.parse(new TextDecoder().decode(exitEvt.payload))).toEqual({
      kind: 'exit',
      exitCode: 0,
    });

    castListener({ kind: 'error', message: 'boom' });
    await flush();
    const err = decodeLastFrame(ws);
    expect(err.type).toBe(WsV3MessageType.ERROR);
    expect(err.sessionId).toBe('s1');
    expect(JSON.parse(new TextDecoder().decode(err.payload))).toEqual({ message: 'boom' });
  });

  it('forwards VT snapshots when subscribed', async () => {
    const ws = new FakeWebSocket();
    hub.handleClientConnection(ws as unknown as WebSocket, {} as unknown as WebSocketRequestV3);

    sendBinaryFrame(
      ws,
      encodeWsV3Frame({
        type: WsV3MessageType.SUBSCRIBE,
        sessionId: 's1',
        payload: encodeWsV3SubscribePayload({ flags: WsV3SubscribeFlags.Snapshots }),
      })
    );
    await flush();

    expect(terminalManager.subscribeToBufferChanges).toHaveBeenCalledWith(
      's1',
      expect.any(Function)
    );
    expect(snapshotListener).toBeTypeOf('function');

    if (!snapshotListener) throw new Error('expected snapshot listener');
    snapshotListener('s1', {
      cols: 80,
      rows: 24,
      viewportY: 0,
      cursorX: 0,
      cursorY: 0,
      cells: [],
    });
    await flush();

    const snap = decodeLastFrame(ws);
    expect(snap.type).toBe(WsV3MessageType.SNAPSHOT_VT);
    expect(snap.sessionId).toBe('s1');
    expect(Array.from(snap.payload)).toEqual([9, 9, 9]);
  });

  it('routes input/resize/kill to PtyManager for local sessions', async () => {
    const ws = new FakeWebSocket();
    hub.handleClientConnection(ws as unknown as WebSocket, {} as unknown as WebSocketRequestV3);

    sendBinaryFrame(
      ws,
      encodeWsV3Frame({
        type: WsV3MessageType.INPUT_TEXT,
        sessionId: 's1',
        payload: new TextEncoder().encode('ls'),
      })
    );
    sendBinaryFrame(
      ws,
      encodeWsV3Frame({
        type: WsV3MessageType.RESIZE,
        sessionId: 's1',
        payload: encodeWsV3ResizePayload(80, 24),
      })
    );
    sendBinaryFrame(
      ws,
      encodeWsV3Frame({
        type: WsV3MessageType.KILL,
        sessionId: 's1',
        payload: new TextEncoder().encode('SIGKILL'),
      })
    );
    await flush();

    expect(ptyManager.sendInput).toHaveBeenCalledWith('s1', { text: 'ls' });
    expect(ptyManager.resizeSession).toHaveBeenCalledWith('s1', 80, 24);
    expect(ptyManager.killSession).toHaveBeenCalledWith('s1', 'SIGKILL');
  });

  it('sends ERROR for invalid SUBSCRIBE payload', async () => {
    const ws = new FakeWebSocket();
    hub.handleClientConnection(ws as unknown as WebSocket, {} as unknown as WebSocketRequestV3);

    sendBinaryFrame(
      ws,
      encodeWsV3Frame({
        type: WsV3MessageType.SUBSCRIBE,
        sessionId: 's1',
        payload: new Uint8Array([1, 2, 3]),
      })
    );
    await flush();

    const err = decodeLastFrame(ws);
    expect(err.type).toBe(WsV3MessageType.ERROR);
    expect(err.sessionId).toBe('s1');
    expect(JSON.parse(new TextDecoder().decode(err.payload)).message).toContain(
      'Invalid SUBSCRIBE payload'
    );
  });

  it('unsubscribes old listeners on re-subscribe', async () => {
    const ws = new FakeWebSocket();
    hub.handleClientConnection(ws as unknown as WebSocket, {} as unknown as WebSocketRequestV3);

    sendBinaryFrame(
      ws,
      encodeWsV3Frame({
        type: WsV3MessageType.SUBSCRIBE,
        sessionId: 's1',
        payload: encodeWsV3SubscribePayload({ flags: WsV3SubscribeFlags.Stdout }),
      })
    );
    await flush();

    const unsubscribeStdout = castOutputHub.subscribe.mock.results[0]?.value;
    expect(typeof unsubscribeStdout).toBe('function');

    sendBinaryFrame(
      ws,
      encodeWsV3Frame({
        type: WsV3MessageType.SUBSCRIBE,
        sessionId: 's1',
        payload: encodeWsV3SubscribePayload({ flags: WsV3SubscribeFlags.Snapshots }),
      })
    );
    await flush();

    expect(unsubscribeStdout).toHaveBeenCalled();
  });

  it('streams git-status updates as EVENT frames when enabled', async () => {
    ptyManager.getSession.mockReturnValue({
      gitRepoPath: '/repo',
      workingDir: '/repo',
    });

    const ws = new FakeWebSocket();
    hub.handleClientConnection(ws as unknown as WebSocket, {} as unknown as WebSocketRequestV3);

    sendBinaryFrame(
      ws,
      encodeWsV3Frame({
        type: WsV3MessageType.SUBSCRIBE,
        sessionId: 's1',
        payload: encodeWsV3SubscribePayload({ flags: WsV3SubscribeFlags.Events }),
      })
    );
    await flush();

    expect(gitStatusHub.startWatching).toHaveBeenCalledWith('s1', '/repo', '/repo');
    expect(gitListener).toBeTypeOf('function');

    if (!gitListener) throw new Error('expected git listener');
    gitListener({ kind: 'git-status-update', gitBranch: 'main' });
    await flush();
    const evt = decodeLastFrame(ws);
    expect(evt.type).toBe(WsV3MessageType.EVENT);
    expect(evt.sessionId).toBe('s1');
    expect(JSON.parse(new TextDecoder().decode(evt.payload))).toMatchObject({
      kind: 'git-status-update',
      gitBranch: 'main',
    });
  });
});
