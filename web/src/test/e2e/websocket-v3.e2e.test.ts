import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WsV3MessageType } from '../../shared/ws-v3.js';
import { type ServerInstance, startTestServer, stopServer } from '../utils/server-utils';
import {
  connectWsV3,
  sendInputText,
  sendSubscribe,
  WS_V3_FLAGS,
  waitForWsV3Frame,
} from '../utils/ws-v3-test-utils';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('WebSocket v3 Tests', () => {
  let server: ServerInstance | null = null;
  let sessionId: string;

  const requirePort = () => {
    const port = server?.port;
    if (!port) throw new Error('Server not started');
    return port;
  };

  beforeAll(async () => {
    server = await startTestServer({
      args: ['--port', '0', '--no-auth'],
      env: {},
      waitForHealth: true,
    });

    const createResponse = await fetch(`http://localhost:${server.port}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: ['bash', '-c', 'echo "hello v3"; sleep 2; echo "bye v3"; sleep 1000'],
        workingDir: server.testDir,
        name: 'WebSocket v3 Test Session',
        cols: 80,
        rows: 24,
      }),
    });

    const createResult = await createResponse.json();
    sessionId = createResult.sessionId;

    await sleep(200);
  });

  afterAll(async () => {
    if (server) await stopServer(server.process);
  });

  it('connects to /ws (no-auth)', async () => {
    const { ws } = await connectWsV3({ port: requirePort() });
    expect(ws.readyState).toBe(1); // OPEN
    ws.close();
  });

  it('streams stdout via v3', async () => {
    const { ws } = await connectWsV3({ port: requirePort() });
    sendSubscribe({ ws, sessionId, flags: WS_V3_FLAGS.Stdout });

    const frame = await waitForWsV3Frame(
      ws,
      (f) => f.type === WsV3MessageType.STDOUT && f.sessionId === sessionId,
      10000
    );
    const text = new TextDecoder().decode(frame.payload);
    expect(text.length).toBeGreaterThan(0);

    ws.close();
  });

  it('streams snapshots via v3', async () => {
    const { ws } = await connectWsV3({ port: requirePort() });
    sendSubscribe({
      ws,
      sessionId,
      flags: WS_V3_FLAGS.Snapshots,
      snapshotMinIntervalMs: 0,
      snapshotMaxIntervalMs: 0,
    });

    const frame = await waitForWsV3Frame(
      ws,
      (f) => f.type === WsV3MessageType.SNAPSHOT_VT && f.sessionId === sessionId,
      10000
    );

    const view = new DataView(
      frame.payload.buffer,
      frame.payload.byteOffset,
      frame.payload.byteLength
    );
    expect(view.getUint16(0, true)).toBe(0x5654); // "VT"
    expect(view.getUint8(2)).toBe(1); // snapshot version

    ws.close();
  });

  it('allows INPUT_TEXT via v3', async () => {
    const { ws } = await connectWsV3({ port: requirePort() });
    sendSubscribe({ ws, sessionId, flags: WS_V3_FLAGS.Stdout });

    sendInputText({ ws, sessionId, text: 'echo "input ok"\n' });

    const frame = await waitForWsV3Frame(
      ws,
      (f) =>
        f.type === WsV3MessageType.STDOUT &&
        f.sessionId === sessionId &&
        new TextDecoder().decode(f.payload).includes('input ok'),
      6000
    );
    expect(frame).toBeTruthy();

    ws.close();
  });

  it('returns ERROR for invalid subscribe payload', async () => {
    const { ws } = await connectWsV3({ port: requirePort() });

    // send SUBSCRIBE with too-short payload
    const badFrame = new Uint8Array([
      0x54,
      0x56,
      0x03,
      WsV3MessageType.SUBSCRIBE,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
    ]);
    ws.send(Buffer.from(badFrame));

    const err = await waitForWsV3Frame(ws, (f) => f.type === WsV3MessageType.ERROR, 2000);
    expect(err).toBeTruthy();
    ws.close();
  });

  it('streams ServerEvent notifications via global EVENT channel', async () => {
    const { ws } = await connectWsV3({ port: requirePort() });

    const ackPromise = waitForWsV3Frame(
      ws,
      (f) =>
        f.type === WsV3MessageType.EVENT &&
        new TextDecoder().decode(f.payload).includes('connected'),
      2000
    );
    sendSubscribe({ ws, sessionId: '', flags: WS_V3_FLAGS.Events });
    await ackPromise;

    const testEventPromise = waitForWsV3Frame(
      ws,
      (f) => {
        if (f.type !== WsV3MessageType.EVENT) return false;
        try {
          const event = JSON.parse(new TextDecoder().decode(f.payload)) as { type?: string };
          return event.type === 'test-notification';
        } catch {
          return false;
        }
      },
      5000
    );

    const resp = await fetch(`http://localhost:${requirePort()}/api/test-notification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(resp.ok).toBe(true);

    const frame = await testEventPromise;

    const event = JSON.parse(new TextDecoder().decode(frame.payload)) as { type?: string };
    expect(event.type).toBe('test-notification');
    ws.close();
  });
});
