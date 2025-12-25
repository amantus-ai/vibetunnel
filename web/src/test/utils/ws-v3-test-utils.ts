import WebSocket from 'ws';
import {
  decodeWsV3Frame,
  encodeWsV3Frame,
  encodeWsV3SubscribePayload,
  WsV3MessageType,
  WsV3SubscribeFlags,
} from '../../shared/ws-v3.js';

export async function connectWsV3(params: {
  port: number;
  token?: string;
}): Promise<{ ws: WebSocket }> {
  const url = new URL(`ws://localhost:${params.port}/ws`);
  if (params.token) url.searchParams.set('token', params.token);

  const ws = new WebSocket(url.toString());
  await new Promise<void>((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });

  // consume WELCOME (best-effort)
  await waitForWsV3Frame(ws, (frame) => frame.type === WsV3MessageType.WELCOME, 2000);
  return { ws };
}

export function sendSubscribe(params: {
  ws: WebSocket;
  sessionId: string;
  flags: number;
  snapshotMinIntervalMs?: number;
  snapshotMaxIntervalMs?: number;
}) {
  const payload = encodeWsV3SubscribePayload({
    flags: params.flags,
    snapshotMinIntervalMs: params.snapshotMinIntervalMs,
    snapshotMaxIntervalMs: params.snapshotMaxIntervalMs,
  });
  const frame = encodeWsV3Frame({
    type: WsV3MessageType.SUBSCRIBE,
    sessionId: params.sessionId,
    payload,
  });
  params.ws.send(Buffer.from(frame));
}

export function sendUnsubscribe(params: { ws: WebSocket; sessionId: string }) {
  const frame = encodeWsV3Frame({ type: WsV3MessageType.UNSUBSCRIBE, sessionId: params.sessionId });
  params.ws.send(Buffer.from(frame));
}

export function sendInputText(params: { ws: WebSocket; sessionId: string; text: string }) {
  const payload = new TextEncoder().encode(params.text);
  const frame = encodeWsV3Frame({
    type: WsV3MessageType.INPUT_TEXT,
    sessionId: params.sessionId,
    payload,
  });
  params.ws.send(Buffer.from(frame));
}

export async function waitForWsV3Frame(
  ws: WebSocket,
  predicate: (frame: { type: WsV3MessageType; sessionId: string; payload: Uint8Array }) => boolean,
  timeoutMs = 2000
): Promise<{ type: WsV3MessageType; sessionId: string; payload: Uint8Array }> {
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for WS v3 frame'));
    }, timeoutMs);

    const onMessage = (data: WebSocket.RawData, isBinary: boolean) => {
      if (!isBinary) return;
      const bytes =
        data instanceof Buffer ? new Uint8Array(data) : new Uint8Array(data as ArrayBuffer);
      const frame = decodeWsV3Frame(bytes);
      if (!frame) return;
      if (!predicate(frame)) return;
      cleanup();
      resolve(frame);
    };

    const onError = (err: unknown) => {
      cleanup();
      reject(err);
    };

    const cleanup = () => {
      clearTimeout(timer);
      ws.off('message', onMessage);
      ws.off('error', onError);
    };

    ws.on('message', onMessage);
    ws.on('error', onError);
  });
}

export const WS_V3_FLAGS = WsV3SubscribeFlags;
