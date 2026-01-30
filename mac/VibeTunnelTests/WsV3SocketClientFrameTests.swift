import Foundation
import Testing
@testable import VibeTunnel

@Suite("WS v3 framing (mac)")
struct WsV3SocketClientFrameTests {
    @Test("encode/decode round-trip preserves fields")
    func frameRoundTrip() throws {
        let payload = Data([0x01, 0x02, 0x03])
        let encoded = WsV3SocketClient.encodeFrame(type: .ping, sessionId: "session-123", payload: payload)
        let decoded = try WsV3SocketClient.decodeFrame(encoded)

        #expect(decoded.type == .ping)
        #expect(decoded.sessionId == "session-123")
        #expect(decoded.payload == payload)
    }

    @Test("subscribe payload is 12 bytes, little-endian")
    func subscribePayloadLayout() {
        let payload = WsV3SocketClient.encodeSubscribePayload(
            flags: [.events],
            snapshotMinIntervalMs: 10,
            snapshotMaxIntervalMs: 20)

        #expect(payload.count == 12)
        #expect(payload[0] == 0x04) // Events flag
        #expect(payload[4] == 0x0A) // min interval = 10
        #expect(payload[8] == 0x14) // max interval = 20
    }
}
