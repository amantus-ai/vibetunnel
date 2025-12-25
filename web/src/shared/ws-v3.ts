/**
 * WebSocket v3 framing for terminal transport.
 *
 * Frame:
 *   u16  magic = 0x5654 ("VT") LE
 *   u8   version = 3
 *   u8   type
 *   u32  sessionIdLen LE
 *   u8[] sessionId UTF-8
 *   u32  payloadLen LE
 *   u8[] payload
 */

export const WS_V3_MAGIC = 0x5654;
export const WS_V3_VERSION = 3;

export enum WsV3MessageType {
  HELLO = 1,
  WELCOME = 2,

  SUBSCRIBE = 10,
  UNSUBSCRIBE = 11,

  STDOUT = 20,
  SNAPSHOT_VT = 21,
  EVENT = 22,
  ERROR = 23,

  INPUT_TEXT = 30,
  INPUT_KEY = 31,
  RESIZE = 32,
  KILL = 33,
  RESET_SIZE = 34,

  PING = 40,
  PONG = 41,
}

export type WsV3DecodedFrame = {
  type: WsV3MessageType;
  sessionId: string;
  payload: Uint8Array;
};

export function encodeWsV3Frame(params: {
  type: WsV3MessageType;
  sessionId?: string;
  payload?: Uint8Array;
}): Uint8Array {
  const sessionId = params.sessionId ?? '';
  const encoder = new TextEncoder();
  const sessionIdBytes = encoder.encode(sessionId);
  const payload = params.payload ?? new Uint8Array();

  const headerLen = 2 + 1 + 1 + 4 + sessionIdBytes.length + 4;
  const out = new Uint8Array(headerLen + payload.length);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);

  let offset = 0;
  view.setUint16(offset, WS_V3_MAGIC, true);
  offset += 2;
  view.setUint8(offset, WS_V3_VERSION);
  offset += 1;
  view.setUint8(offset, params.type);
  offset += 1;

  view.setUint32(offset, sessionIdBytes.length, true);
  offset += 4;
  out.set(sessionIdBytes, offset);
  offset += sessionIdBytes.length;

  view.setUint32(offset, payload.length, true);
  offset += 4;
  out.set(payload, offset);

  return out;
}

export function decodeWsV3Frame(data: Uint8Array): WsV3DecodedFrame | null {
  if (data.byteLength < 2 + 1 + 1 + 4 + 4) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;

  const magic = view.getUint16(offset, true);
  offset += 2;
  if (magic !== WS_V3_MAGIC) return null;

  const version = view.getUint8(offset);
  offset += 1;
  if (version !== WS_V3_VERSION) return null;

  const type = view.getUint8(offset) as WsV3MessageType;
  offset += 1;

  const sessionIdLen = view.getUint32(offset, true);
  offset += 4;
  if (offset + sessionIdLen > data.byteLength) return null;
  const sessionIdBytes = data.subarray(offset, offset + sessionIdLen);
  const sessionId = new TextDecoder().decode(sessionIdBytes);
  offset += sessionIdLen;

  const payloadLen = view.getUint32(offset, true);
  offset += 4;
  if (offset + payloadLen > data.byteLength) return null;

  const payload = data.subarray(offset, offset + payloadLen);
  return { type, sessionId, payload };
}

export enum WsV3SubscribeFlags {
  Stdout = 1 << 0,
  Snapshots = 1 << 1,
  Events = 1 << 2,
}

export function encodeWsV3SubscribePayload(params: {
  flags: number;
  snapshotMinIntervalMs?: number;
  snapshotMaxIntervalMs?: number;
}): Uint8Array {
  const out = new Uint8Array(12);
  const view = new DataView(out.buffer);
  view.setUint32(0, params.flags >>> 0, true);
  view.setUint32(4, (params.snapshotMinIntervalMs ?? 0) >>> 0, true);
  view.setUint32(8, (params.snapshotMaxIntervalMs ?? 0) >>> 0, true);
  return out;
}

export function decodeWsV3SubscribePayload(payload: Uint8Array): {
  flags: number;
  snapshotMinIntervalMs: number;
  snapshotMaxIntervalMs: number;
} | null {
  if (payload.byteLength < 12) return null;
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  return {
    flags: view.getUint32(0, true),
    snapshotMinIntervalMs: view.getUint32(4, true),
    snapshotMaxIntervalMs: view.getUint32(8, true),
  };
}

export function encodeWsV3ResizePayload(cols: number, rows: number): Uint8Array {
  const out = new Uint8Array(8);
  const view = new DataView(out.buffer);
  view.setUint32(0, cols >>> 0, true);
  view.setUint32(4, rows >>> 0, true);
  return out;
}

export function decodeWsV3ResizePayload(
  payload: Uint8Array
): { cols: number; rows: number } | null {
  if (payload.byteLength < 8) return null;
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  return { cols: view.getUint32(0, true), rows: view.getUint32(4, true) };
}
