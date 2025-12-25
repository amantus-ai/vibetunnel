import { describe, expect, it } from 'vitest';
import {
  decodeWsV3Frame,
  decodeWsV3SubscribePayload,
  encodeWsV3Frame,
  encodeWsV3SubscribePayload,
  WS_V3_MAGIC,
  WS_V3_VERSION,
  WsV3MessageType,
} from '../../shared/ws-v3.js';

describe('ws-v3 framing', () => {
  it('roundtrips frame header/sessionId/payload', () => {
    const payload = new Uint8Array([1, 2, 3]);
    const encoded = encodeWsV3Frame({
      type: WsV3MessageType.STDOUT,
      sessionId: 'abc',
      payload,
    });

    const decoded = decodeWsV3Frame(encoded);
    if (!decoded) throw new Error('expected ws v3 frame');
    expect(decoded.type).toBe(WsV3MessageType.STDOUT);
    expect(decoded.sessionId).toBe('abc');
    expect(Array.from(decoded.payload)).toEqual([1, 2, 3]);
  });

  it('rejects wrong magic/version', () => {
    const good = encodeWsV3Frame({ type: WsV3MessageType.PING });
    const bytes = new Uint8Array(good);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    view.setUint16(0, WS_V3_MAGIC ^ 0xffff, true);
    expect(decodeWsV3Frame(bytes)).toBeNull();

    view.setUint16(0, WS_V3_MAGIC, true);
    view.setUint8(2, WS_V3_VERSION + 1);
    expect(decodeWsV3Frame(bytes)).toBeNull();
  });

  it('rejects truncated frames', () => {
    const encoded = encodeWsV3Frame({ type: WsV3MessageType.PONG, sessionId: 'abc' });
    expect(decodeWsV3Frame(encoded.subarray(0, 5))).toBeNull();
  });

  it('subscribe payload encode/decode', () => {
    const payload = encodeWsV3SubscribePayload({
      flags: 7,
      snapshotMinIntervalMs: 10,
      snapshotMaxIntervalMs: 20,
    });
    const decoded = decodeWsV3SubscribePayload(payload);
    expect(decoded).toEqual({ flags: 7, snapshotMinIntervalMs: 10, snapshotMaxIntervalMs: 20 });
    expect(decodeWsV3SubscribePayload(new Uint8Array([1, 2]))).toBeNull();
  });
});
