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

    /// Initialize test environment
    init() {
        self.mockFactory = MockWebSocketFactory()
        self.client = BufferWebSocketClient(webSocketFactory: self.mockFactory)

        // Setup test server configuration
        TestFixtures.saveServerConfig(.init(
            host: "localhost",
            port: 8888,
            name: nil))
    }

    deinit {
        // Cleanup is handled by test framework
        // Main actor isolated methods cannot be called from deinit
    }

    @Test("Connects successfully with valid configuration", .timeLimit(.minutes(1)))
    func successfulConnection() async throws {
        // Act
        self.client.connect()

        // Give it a moment to process
        try await Task.sleep(nanoseconds: 100_000_000) // 100ms

        // Assert
        #expect(self.mockFactory.createdWebSockets.count == 1)

        let mockWebSocket = try #require(mockFactory.lastCreatedWebSocket)
        #expect(mockWebSocket.isConnected)
        #expect(mockWebSocket.lastConnectURL?.absoluteString.contains("/ws") ?? false)
        #expect(self.client.isConnected)
        #expect(self.client.connectionError == nil)
    }

    @Test("Handles connection failure gracefully")
    func connectionFailure() async throws {
        // Act
        self.client.connect()
        try await Task.sleep(nanoseconds: 50_000_000) // 50ms

        let mockWebSocket = try #require(mockFactory.lastCreatedWebSocket)
        mockWebSocket.simulateError(WebSocketError.connectionFailed)

        try await Task.sleep(nanoseconds: 50_000_000) // 50ms

        // Assert
        #expect(!self.client.isConnected)
        #expect(self.client.connectionError != nil)
    }

    @Test("Parses binary buffer messages", arguments: [
        (cols: 80, rows: 24),
        (cols: 120, rows: 30),
        (cols: 160, rows: 50),
    ])
    func binaryMessageParsing(cols: Int, rows: Int) async throws {
        // Arrange
        var receivedEvent: TerminalWebSocketEvent?
        let sessionId = "test-session-123"

        // Subscribe to events
        self.client.subscribe(to: sessionId) { event in
            receivedEvent = event
        }

        // Connect
        self.client.connect()
        try await Task.sleep(nanoseconds: 100_000_000) // 100ms

        let mockWebSocket = try #require(mockFactory.lastCreatedWebSocket)
        #expect(mockWebSocket.isConnected)

        // Create test message
        let bufferData = TestFixtures.bufferSnapshot(cols: cols, rows: rows)
        let messageData = TestFixtures.wrappedV3SnapshotMessage(sessionId: sessionId, bufferData: bufferData)

        // Act - Simulate receiving the message
        mockWebSocket.simulateMessage(WebSocketMessage.data(messageData))

        // Wait for processing
        try await Task.sleep(nanoseconds: 100_000_000) // 100ms

        // Assert
        let event = try #require(receivedEvent)
        guard case let .bufferUpdate(snapshot) = event else {
            Issue.record("Expected buffer update event, got \(event)")
            return
        }

        #expect(snapshot.cols == cols)
        #expect(snapshot.rows == rows)
    }

    @Test("Subscribes to sessions correctly")
    func sessionSubscription() async throws {
        // Arrange
        let sessionId = "test-session-456"

        // Connect first to ensure WebSocket is available
        self.client.connect()
        try await Task.sleep(nanoseconds: 100_000_000) // 100ms

        let mockWebSocket = try #require(mockFactory.lastCreatedWebSocket)

        // Act - Subscribe after connection is established
        self.client.subscribe(to: sessionId) { _ in
            // Event handler
        }

        // Wait longer for subscription message to be sent
        try await Task.sleep(nanoseconds: 200_000_000) // 200ms

        // Assert - Check if subscribe frame was sent (v3 type 10)
        let frames = mockWebSocket.sentDataMessages().compactMap { TestFixtures.decodeV3Frame($0) }
        #expect(frames.contains { $0.type == 10 && $0.sessionId == sessionId })
    }

    @Test("Handles reconnection after disconnection", .timeLimit(.minutes(1)))
    func reconnection() async throws {
        // Connect
        self.client.connect()
        try await Task.sleep(nanoseconds: 100_000_000) // 100ms

        let firstWebSocket = try #require(mockFactory.lastCreatedWebSocket)
        #expect(self.client.isConnected)

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
        self.client.connect()
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
        self.client.subscribe(to: sessionId) { _ in }

        // Connect
        self.client.connect()
        try await Task.sleep(nanoseconds: 100_000_000) // 100ms

        let mockWebSocket = try #require(mockFactory.lastCreatedWebSocket)

        // Clear sent messages to isolate unsubscribe message
        mockWebSocket.reset(preserveConnection: true)

        // Act - Unsubscribe
        self.client.unsubscribe(from: sessionId)
        try await Task.sleep(nanoseconds: 50_000_000) // 50ms

        // Assert - Should have sent the unsubscribe frame (v3 type 11)
        let frames = mockWebSocket.sentDataMessages().compactMap { TestFixtures.decodeV3Frame($0) }
        #expect(frames.contains { $0.type == 11 && $0.sessionId == sessionId })
    }

    @Test("Cleans up on disconnect")
    func cleanup() async throws {
        // Subscribe to a session
        self.client.subscribe(to: "test-session") { _ in }

        // Connect
        self.client.connect()
        try await Task.sleep(nanoseconds: 100_000_000) // 100ms

        let mockWebSocket = try #require(mockFactory.lastCreatedWebSocket)
        #expect(self.client.isConnected)

        // Act
        self.client.disconnect()

        // Assert
        #expect(!self.client.isConnected)
        #expect(mockWebSocket.disconnectCalled)
        #expect(mockWebSocket.lastDisconnectCode == URLSessionWebSocketTask.CloseCode.goingAway)
    }

    // MARK: - Error Handling Tests

    @Test("Handles invalid magic byte in binary messages")
    func invalidMagicByte() async throws {
        // Arrange
        var receivedEvent: TerminalWebSocketEvent?
        let sessionId = "test-session"

        self.client.subscribe(to: sessionId) { event in
            receivedEvent = event
        }

        self.client.connect()
        try await Task.sleep(nanoseconds: 100_000_000)

        let mockWebSocket = try #require(mockFactory.lastCreatedWebSocket)

        // Create message with wrong magic (v3 expects "VT" + version 3)
        var messageData = Data()
        messageData.append(0xFF)
        messageData.append(0x00)
        messageData.append(0x03) // version
        messageData.append(21) // snapshot type
        messageData.append(contentsOf: [0, 0, 0, 0]) // session id len
        messageData.append(contentsOf: [0, 0, 0, 0]) // payload len

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

        self.client.subscribe(to: sessionId) { event in
            receivedEvent = event
        }

        self.client.connect()
        try await Task.sleep(nanoseconds: 100_000_000)

        let mockWebSocket = try #require(mockFactory.lastCreatedWebSocket)

        // Create message with valid wrapper but invalid buffer data
        var bufferData = Data()
        bufferData.append(contentsOf: [0xFF, 0xFF]) // Invalid magic for buffer
        bufferData.append(contentsOf: [1, 2, 3, 4]) // Random data

        let messageData = TestFixtures.wrappedV3SnapshotMessage(sessionId: sessionId, bufferData: bufferData)

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
        pollingInterval: Duration = .milliseconds(100))
        async throws
    {
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
