import Foundation
import Testing
@testable import VibeTunnel

// MARK: - Test Mocks
// TODO: Move these to a separate file once Xcode project is updated

/// Mock WebSocket for testing
@MainActor
class MockWebSocket: WebSocketProtocol {
    weak var delegate: WebSocketDelegate?
    
    // State tracking
    var isConnected = false
    private(set) var lastConnectURL: URL?
    private(set) var lastConnectHeaders: [String: String]?
    var sentMessages: [WebSocketMessage] = []
    private(set) var pingCount = 0
    private(set) var disconnectCalled = false
    private(set) var lastDisconnectCode: URLSessionWebSocketTask.CloseCode?
    private(set) var lastDisconnectReason: Data?
    
    // Message queue for async delivery
    private var messageHandlers: [() async -> Void] = []
    
    func connect(to url: URL, with headers: [String: String]) async throws {
        lastConnectURL = url
        lastConnectHeaders = headers
        isConnected = true
        delegate?.webSocketDidConnect(self)
    }
    
    func send(_ message: WebSocketMessage) async throws {
        guard isConnected else { throw WebSocketError.connectionFailed }
        sentMessages.append(message)
    }
    
    func sendPing() async throws {
        guard isConnected else { throw WebSocketError.connectionFailed }
        pingCount += 1
    }
    
    func disconnect(with code: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        disconnectCalled = true
        lastDisconnectCode = code
        lastDisconnectReason = reason
        
        if isConnected {
            isConnected = false
            delegate?.webSocketDidDisconnect(self, closeCode: code, reason: reason)
        }
    }
    
    // Test helpers
    func simulateMessage(_ message: WebSocketMessage) {
        guard isConnected else { return }
        // Queue the message for async delivery
        messageHandlers.append { [weak self] in
            guard let self = self else { return }
            self.delegate?.webSocket(self, didReceiveMessage: message)
        }
        // Trigger async delivery
        Task {
            while !messageHandlers.isEmpty {
                let handler = messageHandlers.removeFirst()
                await handler()
            }
        }
    }
    
    func simulateError(_ error: Error) {
        guard isConnected else { return }
        delegate?.webSocket(self, didFailWithError: error)
    }
    
    func simulateDisconnection() {
        guard isConnected else { return }
        isConnected = false
        delegate?.webSocketDidDisconnect(self, closeCode: .abnormalClosure, reason: nil)
    }
    
    func reset() {
        isConnected = false
        sentMessages.removeAll()
        pingCount = 0
    }
    
    func sentJSONMessages() -> [[String: Any]] {
        sentMessages.compactMap { message in
            guard case .string(let text) = message,
                  let data = text.data(using: .utf8),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                return nil
            }
            return json
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

@Suite("BufferWebSocketClient Tests", .tags(.critical, .websocket), .disabled("Needs async mock refactoring"))
@MainActor
final class BufferWebSocketClientTests {
    // Test dependencies
    let mockFactory: MockWebSocketFactory
    let client: BufferWebSocketClient
    
    // Initialize test environment
    init() {
        mockFactory = MockWebSocketFactory()
        client = BufferWebSocketClient(webSocketFactory: mockFactory)
        
        // Setup test server configuration
        TestFixtures.saveServerConfig(.init(
            host: "localhost",
            port: 8888,
            name: nil
        ))
    }
    
    deinit {
        // Cleanup is handled by test framework
        // Main actor isolated methods cannot be called from deinit
    }
    @Test("Connects successfully with valid configuration", .timeLimit(.minutes(1)))
    func successfulConnection() async throws {
        // Act
        client.connect()
        
        // Give it a moment to process
        try await Task.sleep(nanoseconds: 100_000_000) // 100ms
        
        // Assert
        #expect(mockFactory.createdWebSockets.count == 1)
        
        let mockWebSocket = try #require(mockFactory.lastCreatedWebSocket)
        #expect(mockWebSocket.isConnected)
        #expect(mockWebSocket.lastConnectURL?.absoluteString.contains("/buffers") ?? false)
        #expect(client.isConnected)
        #expect(client.connectionError == nil)
    }

    @Test("Handles connection failure gracefully")
    func connectionFailure() async throws {
        // Act
        client.connect()
        try await Task.sleep(nanoseconds: 50_000_000) // 50ms
        
        let mockWebSocket = try #require(mockFactory.lastCreatedWebSocket)
        mockWebSocket.simulateError(WebSocketError.connectionFailed)
        
        try await Task.sleep(nanoseconds: 50_000_000) // 50ms
        
        // Assert
        #expect(!client.isConnected)
        #expect(client.connectionError != nil)
    }

    @Test("Parses binary buffer messages", arguments: [
        (cols: 80, rows: 24),
        (cols: 120, rows: 30),
        (cols: 160, rows: 50)
    ])
    func binaryMessageParsing(cols: Int, rows: Int) async throws {
        // Arrange
        var receivedEvent: TerminalWebSocketEvent?
        let sessionId = "test-session-123"
        
        // Subscribe to events
        client.subscribe(to: sessionId) { event in
            receivedEvent = event
        }
        
        // Connect
        client.connect()
        try await Task.sleep(nanoseconds: 100_000_000) // 100ms
        
        let mockWebSocket = try #require(mockFactory.lastCreatedWebSocket)
        #expect(mockWebSocket.isConnected)
        
        // Create test message
        let bufferData = TestFixtures.bufferSnapshot(cols: cols, rows: rows)
        let messageData = TestFixtures.wrappedBufferMessage(sessionId: sessionId, bufferData: bufferData)
        
        // Act - Simulate receiving the message
        mockWebSocket.simulateMessage(WebSocketMessage.data(messageData))
        
        // Wait for processing
        try await Task.sleep(nanoseconds: 100_000_000) // 100ms
        
        // Assert
        let event = try #require(receivedEvent)
        guard case .bufferUpdate(let snapshot) = event else {
            Issue.record("Expected buffer update event, got \(event)")
            return
        }
        
        #expect(snapshot.cols == cols)
        #expect(snapshot.rows == rows)
    }

    @Test("Handles text messages", arguments: [
        (type: "ping", expectedResponse: "pong"),
        (type: "error", expectedResponse: nil)
    ])
    func textMessageHandling(type: String, expectedResponse: String?) async throws {
        // Connect
        client.connect()
        try await Task.sleep(nanoseconds: 100_000_000) // 100ms
        
        let mockWebSocket = try #require(mockFactory.lastCreatedWebSocket)
        
        // Act - Simulate message
        let message = TestFixtures.terminalEvent(type: type)
        mockWebSocket.simulateMessage(WebSocketMessage.string(message))
        
        // Wait for processing
        try await Task.sleep(nanoseconds: 50_000_000) // 50ms
        
        // Assert
        let sentMessages = mockWebSocket.sentJSONMessages()
        
        if let expectedResponse = expectedResponse {
            #expect(sentMessages.contains { $0["type"] as? String == expectedResponse })
        } else {
            // For error messages, we expect no response
            #expect(!sentMessages.contains { $0["type"] as? String == type })
        }
    }

    @Test("Subscribes to sessions correctly")
    func sessionSubscription() async throws {
        // Arrange
        let sessionId = "test-session-456"
        
        // Act
        client.subscribe(to: sessionId) { _ in
            // Event handler
        }
        
        client.connect()
        try await Task.sleep(nanoseconds: 100_000_000) // 100ms
        
        let mockWebSocket = try #require(mockFactory.lastCreatedWebSocket)
        
        // Assert - Check if subscribe message was sent
        let sentMessages = mockWebSocket.sentJSONMessages()
        #expect(sentMessages.contains { msg in
            msg["type"] as? String == "subscribe" &&
            msg["sessionId"] as? String == sessionId
        })
    }

    @Test("Handles reconnection after disconnection", .timeLimit(.minutes(1)))
    func reconnection() async throws {
        // Connect
        client.connect()
        try await Task.sleep(nanoseconds: 100_000_000) // 100ms
        
        let firstWebSocket = try #require(mockFactory.lastCreatedWebSocket)
        #expect(client.isConnected)
        
        // Act - Simulate disconnection
        firstWebSocket.simulateDisconnection()
        
        // Wait for reconnection attempt
        try await waitFor { [weak self] in
            (self?.mockFactory.createdWebSockets.count ?? 0) > 1
        }
        
        // Assert
        let secondWebSocket = try #require(mockFactory.lastCreatedWebSocket)
        #expect(secondWebSocket !== firstWebSocket)
    }

    @Test("Sends ping messages periodically", .disabled("Ping timing is unpredictable in tests"))
    func pingMessages() async throws {
        // Act
        client.connect()
        try await Task.sleep(nanoseconds: 100_000_000) // 100ms
        
        let mockWebSocket = try #require(mockFactory.lastCreatedWebSocket)
        let initialPingCount = mockWebSocket.pingCount
        
        // Wait longer to see if pings are sent
        try await Task.sleep(nanoseconds: 1_000_000_000) // 1 second
        
        // Assert - Should have sent at least one ping
        #expect(mockWebSocket.pingCount > initialPingCount)
    }

    @Test("Unsubscribes from sessions correctly")
    func sessionUnsubscription() async throws {
        // Arrange
        let sessionId = "test-session-789"
        
        // Subscribe first
        client.subscribe(to: sessionId) { _ in }
        
        // Connect
        client.connect()
        try await Task.sleep(nanoseconds: 100_000_000) // 100ms
        
        let mockWebSocket = try #require(mockFactory.lastCreatedWebSocket)
        
        // Clear sent messages to isolate unsubscribe message
        let prevConnected = mockWebSocket.isConnected
        mockWebSocket.reset()
        mockWebSocket.isConnected = prevConnected // Keep connected state
        
        // Act - Unsubscribe
        client.unsubscribe(from: sessionId)
        try await Task.sleep(nanoseconds: 50_000_000) // 50ms
        
        // Assert
        let sentMessages = mockWebSocket.sentJSONMessages()
        #expect(sentMessages.contains { msg in
            msg["type"] as? String == "unsubscribe" &&
            msg["sessionId"] as? String == sessionId
        })
    }

    @Test("Cleans up on disconnect")
    func cleanup() async throws {
        // Subscribe to a session
        client.subscribe(to: "test-session") { _ in }
        
        // Connect
        client.connect()
        try await Task.sleep(nanoseconds: 100_000_000) // 100ms
        
        let mockWebSocket = try #require(mockFactory.lastCreatedWebSocket)
        #expect(client.isConnected)
        
        // Act
        client.disconnect()
        
        // Assert
        #expect(!client.isConnected)
        #expect(mockWebSocket.disconnectCalled)
        #expect(mockWebSocket.lastDisconnectCode == URLSessionWebSocketTask.CloseCode.goingAway)
    }
    
    // MARK: - Error Handling Tests
    
    @Test("Handles invalid magic byte in binary messages")
    func invalidMagicByte() async throws {
        // Arrange
        var receivedEvent: TerminalWebSocketEvent?
        let sessionId = "test-session"
        
        client.subscribe(to: sessionId) { event in
            receivedEvent = event
        }
        
        client.connect()
        try await Task.sleep(nanoseconds: 100_000_000)
        
        let mockWebSocket = try #require(mockFactory.lastCreatedWebSocket)
        
        // Create message with wrong magic byte
        var messageData = Data()
        messageData.append(0xFF) // Wrong magic byte
        messageData.append(contentsOf: [0, 0, 0, 4]) // Session ID length
        messageData.append("test".data(using: .utf8)!)
        
        // Act
        mockWebSocket.simulateMessage(WebSocketMessage.data(messageData))
        try await Task.sleep(nanoseconds: 50_000_000)
        
        // Assert - Should not receive any event
        #expect(receivedEvent == nil)
    }
    
    @Test("Handles malformed buffer data gracefully")
    func malformedBufferData() async throws {
        // Arrange
        var receivedEvent: TerminalWebSocketEvent?
        let sessionId = "test-session"
        
        client.subscribe(to: sessionId) { event in
            receivedEvent = event
        }
        
        client.connect()
        try await Task.sleep(nanoseconds: 100_000_000)
        
        let mockWebSocket = try #require(mockFactory.lastCreatedWebSocket)
        
        // Create message with valid wrapper but invalid buffer data
        var bufferData = Data()
        bufferData.append(contentsOf: [0xFF, 0xFF]) // Invalid magic for buffer
        bufferData.append(contentsOf: [1, 2, 3, 4]) // Random data
        
        let messageData = TestFixtures.wrappedBufferMessage(sessionId: sessionId, bufferData: bufferData)
        
        // Act
        mockWebSocket.simulateMessage(WebSocketMessage.data(messageData))
        try await Task.sleep(nanoseconds: 50_000_000)
        
        // Assert - Should not crash and not receive event
        #expect(receivedEvent == nil)
    }
}

// MARK: - Test Extensions

extension BufferWebSocketClientTests {
    /// Wait for condition with timeout
    func waitFor(
        _ condition: @escaping () async -> Bool,
        timeout: Duration = .seconds(5),
        pollingInterval: Duration = .milliseconds(100)
    ) async throws {
        let deadline = ContinuousClock.now.advanced(by: timeout)
        
        while ContinuousClock.now < deadline {
            if await condition() {
                return
            }
            try await Task.sleep(for: pollingInterval)
        }
        
        Issue.record("Timeout waiting for condition")
    }
}
