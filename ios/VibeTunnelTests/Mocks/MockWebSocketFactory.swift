import Foundation
@testable import VibeTunnel

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
        // Set the parent class isConnected property through public interface
        super.connect()
    }

    override func disconnect() {
        disconnectCalled = true
        eventHandlers.removeAll()
        super.disconnect()
    }

    override func subscribe(to sessionId: String, handler: @escaping (TerminalWebSocketEvent) -> Void) {
        subscribeCalled = true
        lastSubscribedSessionId = sessionId
        eventHandlers[sessionId] = handler
        super.subscribe(to: sessionId, handler: handler)
    }

    override func unsubscribe(from sessionId: String) {
        unsubscribeCalled = true
        eventHandlers.removeValue(forKey: sessionId)
        super.unsubscribe(from: sessionId)
    }

    /// Simulate receiving an event
    func simulateEvent(_ event: TerminalWebSocketEvent) {
        for handler in eventHandlers.values {
            handler(event)
        }
    }
}

/// Mock SSEClient for testing (composition pattern since SSEClient is final)
@MainActor
class MockSSEClient {
    var connectCalled = false
    var disconnectCalled = false
    var lastConnectHeaders: [String: String]?
    var isConnected = false

    func connect(headers: [String: String]? = nil) async {
        connectCalled = true
        lastConnectHeaders = headers
        isConnected = true
    }

    func disconnect() {
        disconnectCalled = true
        isConnected = false
    }
}
