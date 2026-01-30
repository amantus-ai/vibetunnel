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
        self.lastConnectURL = url
        self.lastConnectHeaders = headers

        if self.shouldFailConnection {
            let error = self.connectionError ?? WebSocketError.connectionFailed
            throw error
        }

        self.isConnected = true
        self.delegate?.webSocketDidConnect(self)

        // Start delivering queued messages
        self.startMessageDelivery()
    }

    func send(_ message: WebSocketMessage) async throws {
        guard self.isConnected else {
            throw WebSocketError.connectionFailed
        }

        if self.shouldFailSend {
            throw self.sendError ?? WebSocketError.connectionFailed
        }

        self.sentMessages.append(message)
    }

    func sendPing() async throws {
        guard self.isConnected else {
            throw WebSocketError.connectionFailed
        }

        if self.shouldFailPing {
            throw self.pingError ?? WebSocketError.connectionFailed
        }

        self.pingCount += 1
    }

    func disconnect(with code: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        self.disconnectCalled = true
        self.lastDisconnectCode = code
        self.lastDisconnectReason = reason

        if self.isConnected {
            self.isConnected = false
            self.messageDeliveryTask?.cancel()
            self.messageDeliveryTask = nil
            self.delegate?.webSocketDidDisconnect(self, closeCode: code, reason: reason)
        }
    }

    // MARK: - Test Helpers

    /// Simulate receiving a message from the server
    func simulateMessage(_ message: WebSocketMessage) {
        guard self.isConnected else { return }
        self.messageQueue.append(message)
    }

    /// Simulate multiple messages
    func simulateMessages(_ messages: [WebSocketMessage]) {
        guard self.isConnected else { return }
        self.messageQueue.append(contentsOf: messages)
    }

    /// Simulate a connection error
    func simulateError(_ error: Error) {
        guard self.isConnected else { return }
        self.delegate?.webSocket(self, didFailWithError: error)
    }

    /// Simulate server disconnection
    func simulateDisconnection(closeCode: URLSessionWebSocketTask.CloseCode = .abnormalClosure, reason: Data? = nil) {
        guard self.isConnected else { return }
        self.isConnected = false
        self.messageDeliveryTask?.cancel()
        self.messageDeliveryTask = nil
        self.delegate?.webSocketDidDisconnect(self, closeCode: closeCode, reason: reason)
    }

    /// Clear all tracked state
    func reset() {
        self.isConnected = false
        self.lastConnectURL = nil
        self.lastConnectHeaders = nil
        self.sentMessages.removeAll()
        self.pingCount = 0
        self.disconnectCalled = false
        self.lastDisconnectCode = nil
        self.lastDisconnectReason = nil
        self.messageQueue.removeAll()
        self.messageDeliveryTask?.cancel()
        self.messageDeliveryTask = nil
    }

    /// Clear tracked state but preserve connection state
    func reset(preserveConnection: Bool) {
        let wasConnected = self.isConnected
        self.reset()
        if preserveConnection {
            self.isConnected = wasConnected
        }
    }

    /// Find sent messages by type
    func sentStringMessages() -> [String] {
        self.sentMessages.compactMap { message in
            if case let .string(text) = message {
                return text
            }
            return nil
        }
    }

    func sentDataMessages() -> [Data] {
        self.sentMessages.compactMap { message in
            if case let .data(data) = message {
                return data
            }
            return nil
        }
    }

    /// Find sent JSON messages
    func sentJSONMessages() -> [[String: JSONValue]] {
        self.sentStringMessages().compactMap { string in
            guard let data = string.data(using: .utf8),
                  let json = JSONValue.decodeObject(from: data)
            else {
                return nil
            }
            return json
        }
    }

    private func startMessageDelivery() {
        self.messageDeliveryTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { break }

                if !self.messageQueue.isEmpty {
                    let message = self.messageQueue.removeFirst()
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
        self.createdWebSockets.append(webSocket)
        return webSocket
    }

    var lastCreatedWebSocket: MockWebSocket? {
        self.createdWebSockets.last
    }

    func reset() {
        self.createdWebSockets.forEach { $0.reset() }
        self.createdWebSockets.removeAll()
    }
}
