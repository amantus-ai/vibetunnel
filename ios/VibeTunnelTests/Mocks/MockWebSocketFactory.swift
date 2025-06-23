import Foundation
@testable import VibeTunnel

/// Mock WebSocket factory for testing
@MainActor
class MockWebSocketFactory: WebSocketFactory {
    var createdWebSockets: [MockWebSocket] = []

    override func createWebSocket() -> WebSocketProtocol {
        let webSocket = MockWebSocket()
        createdWebSockets.append(webSocket)
        return webSocket
    }
}

/// Mock BufferWebSocketClient for testing
@MainActor
class MockBufferWebSocketClient: BufferWebSocketClient {
    var connectCalled = false
    var disconnectCalled = false
    var subscribeCalled = false
    var unsubscribeCalled = false
    var lastSubscribedSessionId: String?

    private var eventHandlers: [String: (TerminalWebSocketEvent) -> Void] = [:]

    override func connect() {
        connectCalled = true
        isConnected = true
    }

    override func disconnect() {
        disconnectCalled = true
        isConnected = false
        eventHandlers.removeAll()
    }

    override func subscribe(to sessionId: String, handler: @escaping (TerminalWebSocketEvent) -> Void) {
        subscribeCalled = true
        lastSubscribedSessionId = sessionId
        eventHandlers[sessionId] = handler
    }

    override func unsubscribe(from sessionId: String) {
        unsubscribeCalled = true
        eventHandlers.removeValue(forKey: sessionId)
    }

    /// Simulate receiving an event
    func simulateEvent(_ event: TerminalWebSocketEvent) {
        for handler in eventHandlers.values {
            handler(event)
        }
    }
}

/// Mock SSEClient for testing
@MainActor
class MockSSEClient: SSEClient {
    var connectCalled = false
    var disconnectCalled = false
    var lastConnectHeaders: [String: String]?

    override func connect(headers: [String: String]? = nil) async {
        connectCalled = true
        lastConnectHeaders = headers
        isConnected = true
    }

    override func disconnect() {
        disconnectCalled = true
        isConnected = false
    }
}
