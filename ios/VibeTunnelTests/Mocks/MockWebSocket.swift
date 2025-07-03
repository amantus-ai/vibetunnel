import Foundation
@testable import VibeTunnel

/// Mock WebSocket implementation for testing
@MainActor
class MockWebSocket: WebSocketProtocol {
    weak var delegate: WebSocketDelegate?

    // State tracking
    var isConnected = false
    private(set) var lastConnectURL: URL?
    private(set) var lastConnectHeaders: [String: String]?
    private(set) var sentMessages: [WebSocketMessage] = []
    private(set) var pingCount = 0
    private(set) var disconnectCalled = false
    private(set) var lastDisconnectCode: URLSessionWebSocketTask.CloseCode?
    private(set) var lastDisconnectReason: Data?

    // Control test behavior
    var shouldFailConnection = false
    var connectionError: Error?
    var shouldFailSend = false
    var sendError: Error?
    var shouldFailPing = false
    var pingError: Error?

    // Message simulation
    private var messageQueue: [WebSocketMessage] = []
    private var messageDeliveryTask: Task<Void, Never>?

    func connect(to url: URL, with headers: [String: String]) async throws {
        lastConnectURL = url
        lastConnectHeaders = headers

        if shouldFailConnection {
            let error = connectionError ?? WebSocketError.connectionFailed
            throw error
        }

        isConnected = true
        delegate?.webSocketDidConnect(self)

        // Start delivering queued messages
        startMessageDelivery()
    }

    func send(_ message: WebSocketMessage) async throws {
        guard isConnected else {
            throw WebSocketError.connectionFailed
        }

        if shouldFailSend {
            throw sendError ?? WebSocketError.connectionFailed
        }

        sentMessages.append(message)
    }

    func sendPing() async throws {
        guard isConnected else {
            throw WebSocketError.connectionFailed
        }

        if shouldFailPing {
            throw pingError ?? WebSocketError.connectionFailed
        }

        pingCount += 1
    }

    func disconnect(with code: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        disconnectCalled = true
        lastDisconnectCode = code
        lastDisconnectReason = reason

        if isConnected {
            isConnected = false
            messageDeliveryTask?.cancel()
            messageDeliveryTask = nil
            delegate?.webSocketDidDisconnect(self, closeCode: code, reason: reason)
        }
    }

    // MARK: - Test Helpers

    /// Simulate receiving a message from the server
    func simulateMessage(_ message: WebSocketMessage) {
        guard isConnected else { return }
        messageQueue.append(message)
    }

    /// Simulate multiple messages
    func simulateMessages(_ messages: [WebSocketMessage]) {
        guard isConnected else { return }
        messageQueue.append(contentsOf: messages)
    }

    /// Simulate a connection error
    func simulateError(_ error: Error) {
        guard isConnected else { return }
        delegate?.webSocket(self, didFailWithError: error)
    }

    /// Simulate server disconnection
    func simulateDisconnection(closeCode: URLSessionWebSocketTask.CloseCode = .abnormalClosure, reason: Data? = nil) {
        guard isConnected else { return }
        isConnected = false
        messageDeliveryTask?.cancel()
        messageDeliveryTask = nil
        delegate?.webSocketDidDisconnect(self, closeCode: closeCode, reason: reason)
    }

    /// Clear all tracked state
    func reset() {
        isConnected = false
        lastConnectURL = nil
        lastConnectHeaders = nil
        sentMessages.removeAll()
        pingCount = 0
        disconnectCalled = false
        lastDisconnectCode = nil
        lastDisconnectReason = nil
        messageQueue.removeAll()
        messageDeliveryTask?.cancel()
        messageDeliveryTask = nil
    }
    
    /// Clear tracked state but preserve connection state
    func reset(preserveConnection: Bool) {
        let wasConnected = isConnected
        reset()
        if preserveConnection {
            isConnected = wasConnected
        }
    }

    /// Find sent messages by type
    func sentStringMessages() -> [String] {
        sentMessages.compactMap { message in
            if case .string(let text) = message {
                return text
            }
            return nil
        }
    }

    func sentDataMessages() -> [Data] {
        sentMessages.compactMap { message in
            if case .data(let data) = message {
                return data
            }
            return nil
        }
    }

    /// Find sent JSON messages
    func sentJSONMessages() -> [[String: Any]] {
        sentStringMessages().compactMap { string in
            guard let data = string.data(using: .utf8),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                return nil
            }
            return json
        }
    }

    private func startMessageDelivery() {
        messageDeliveryTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self = self else { break }

                if !messageQueue.isEmpty {
                    let message = messageQueue.removeFirst()
                    await MainActor.run {
                        self.delegate?.webSocket(self, didReceiveMessage: message)
                    }
                }

                // Small delay to simulate network latency
                try? await Task.sleep(nanoseconds: 10_000_000) // 10ms
            }
        }
    }
}

/// Mock WebSocket factory for testing
@MainActor
class MockWebSocketFactory: WebSocketFactory {
    private(set) var createdWebSockets: [MockWebSocket] = []

    func createWebSocket() -> WebSocketProtocol {
        let webSocket = MockWebSocket()
        createdWebSockets.append(webSocket)
        return webSocket
    }

    var lastCreatedWebSocket: MockWebSocket? {
        createdWebSockets.last
    }

    func reset() {
        createdWebSockets.forEach { $0.reset() }
        createdWebSockets.removeAll()
    }
}
