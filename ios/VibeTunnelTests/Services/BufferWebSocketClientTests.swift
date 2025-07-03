import Foundation
import Testing
@testable import VibeTunnel

// Tests use mock classes from Mocks/ directory

@Suite("BufferWebSocketClient Tests", .tags(.critical, .websocket))
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
        
        // Wait for processing - increased to allow async response to be sent
        try await Task.sleep(nanoseconds: 200_000_000) // 200ms
        
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
        
        // Connect first to ensure WebSocket is available
        client.connect()
        try await Task.sleep(nanoseconds: 100_000_000) // 100ms
        
        let mockWebSocket = try #require(mockFactory.lastCreatedWebSocket)
        
        // Act - Subscribe after connection is established
        client.subscribe(to: sessionId) { _ in
            // Event handler
        }
        
        // Wait longer for subscription message to be sent
        try await Task.sleep(nanoseconds: 200_000_000) // 200ms
        
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
        mockWebSocket.reset(preserveConnection: true)
        
        // Act - Unsubscribe
        client.unsubscribe(from: sessionId)
        try await Task.sleep(nanoseconds: 50_000_000) // 50ms
        
        // Assert - Should have sent only the unsubscribe message
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
