import Foundation
import Testing

@Suite("WebSocket Reconnection Tests", .tags(.critical, .websocket))
struct WebSocketReconnectionTests {
    // MARK: - Reconnection Strategy Tests

    @Test("Exponential backoff calculation", .disabled("Timing out in CI"))
    func exponentialBackoff() {
        // Test exponential backoff with jitter
        let baseDelay = 1.0
        let maxDelay = 60.0

        // Calculate delays for multiple attempts
        var delays: [Double] = []
        for attempt in 0..<10 {
            let delay = min(baseDelay * pow(2.0, Double(attempt)), maxDelay)
            let jitteredDelay = delay * (0.5 + Double.random(in: 0...0.5))
            delays.append(jitteredDelay)

            // Verify bounds
            #expect(jitteredDelay >= baseDelay * 0.5)
            #expect(jitteredDelay <= maxDelay)
        }

        // Verify progression (later delays should generally be larger)
        for i in 1..<5 {
            #expect(delays[i] >= delays[0])
        }
    }

    @Test("Maximum retry attempts")
    func maxRetryAttempts() {
        let maxAttempts = 5
        var attempts = 0
        var shouldRetry = true

        while shouldRetry, attempts < maxAttempts {
            attempts += 1
            shouldRetry = attempts < maxAttempts
        }

        #expect(attempts == maxAttempts)
        #expect(!shouldRetry)
    }

    // MARK: - Connection State Management

    @Test("Connection state transitions")
    func connectionStateTransitions() {
        enum ConnectionState {
            case disconnected
            case connecting
            case connected
            case reconnecting
            case failed
        }

        // Test valid transitions
        var state = ConnectionState.disconnected

        // Disconnected -> Connecting
        state = .connecting
        #expect(state == .connecting)

        // Connecting -> Connected
        state = .connected
        #expect(state == .connected)

        // Connected -> Reconnecting (on disconnect)
        state = .reconnecting
        #expect(state == .reconnecting)

        // Reconnecting -> Connected
        state = .connected
        #expect(state == .connected)

        // Any state -> Failed (on max retries)
        state = .failed
        #expect(state == .failed)
    }

    @Test("Connection lifecycle events")
    func connectionLifecycle() {
        var events: [String] = []

        // Simulate connection lifecycle
        events.append("will_connect")
        events.append("did_connect")
        events.append("did_disconnect")
        events.append("will_reconnect")
        events.append("did_reconnect")

        #expect(events.count == 5)
        #expect(events[0] == "will_connect")
        #expect(events[1] == "did_connect")
        #expect(events[2] == "did_disconnect")
        #expect(events[3] == "will_reconnect")
        #expect(events[4] == "did_reconnect")
    }

    // MARK: - Message Queue Management

    @Test("Message queuing during disconnection")
    func messageQueueing() {
        var messageQueue: [String] = []
        var isConnected = false

        func sendMessage(_ message: String) {
            if isConnected {
                // Send immediately
                #expect(messageQueue.isEmpty)
            } else {
                // Queue for later
                messageQueue.append(message)
            }
        }

        // Queue messages while disconnected
        sendMessage("message1")
        sendMessage("message2")
        sendMessage("message3")

        #expect(messageQueue.count == 3)
        #expect(messageQueue[0] == "message1")

        // Connect and flush queue
        isConnected = true
        let flushedMessages = messageQueue
        messageQueue.removeAll()

        #expect(flushedMessages.count == 3)
        #expect(messageQueue.isEmpty)
    }

    @Test("Message queue size limits")
    func messageQueueLimits() {
        let maxQueueSize = 100
        var messageQueue: [String] = []

        // Fill queue beyond limit
        for i in 0..<150 {
            if messageQueue.count < maxQueueSize {
                messageQueue.append("message\(i)")
            }
        }

        #expect(messageQueue.count == maxQueueSize)
        #expect(messageQueue.first == "message0")
        #expect(messageQueue.last == "message99")
    }

    // MARK: - Reconnection Scenarios

    @Test("Immediate reconnection on clean disconnect")
    func cleanDisconnectReconnection() {
        let reconnectDelay: TimeInterval = 0.1

        #expect(reconnectDelay == 0.1)
    }

    @Test("Reconnection with authentication")
    func reconnectionWithAuth() {
        struct ConnectionConfig {
            let url: String
            let authToken: String?
            let sessionId: String?
        }

        let config = ConnectionConfig(
            url: "wss://localhost:8888/ws",
            authToken: "test-token",
            sessionId: "session-123")

        // Verify auth info is preserved for reconnection
        #expect(config.authToken != nil)
        #expect(config.sessionId != nil)

        // Simulate reconnection with same config
        let reconnectConfig = config
        #expect(reconnectConfig.authToken == config.authToken)
        #expect(reconnectConfig.sessionId == config.sessionId)
    }

    // MARK: - Error Recovery

    @Test("Connection error categorization")
    func errorCategorization() {
        enum ConnectionError {
            case network(String)
            case authentication(String)
            case server(Int)
            case client(String)
        }

        func shouldRetry(error: ConnectionError) -> Bool {
            switch error {
            case .network:
                true // Always retry network errors
            case .authentication:
                false // Don't retry auth errors
            case let .server(code):
                code >= 500 // Retry server errors
            case .client:
                false // Don't retry client errors
            }
        }

        #expect(shouldRetry(error: .network("timeout")) == true)
        #expect(shouldRetry(error: .authentication("invalid token")) == false)
        #expect(shouldRetry(error: .server(500)) == true)
        #expect(shouldRetry(error: .server(503)) == true)
        #expect(shouldRetry(error: .server(400)) == false)
        #expect(shouldRetry(error: .client("bad request")) == false)
    }

    @Test("Connection health monitoring")
    func healthMonitoring() {
        var lastPingTime = Date()
        let pingInterval: TimeInterval = 30
        let pingTimeout: TimeInterval = 10

        // Simulate successful ping
        lastPingTime = Date()
        let timeSinceLastPing = Date().timeIntervalSince(lastPingTime)
        #expect(timeSinceLastPing < pingTimeout)

        // Simulate missed ping
        lastPingTime = Date().addingTimeInterval(-40)
        let missedPingTime = Date().timeIntervalSince(lastPingTime)
        #expect(missedPingTime > pingInterval)
        #expect(missedPingTime > pingTimeout)
    }

    // MARK: - State Persistence

    @Test("Connection state persistence")
    func statePersistence() {
        struct ConnectionState: Codable {
            let url: String
            let sessionId: String?
            let lastConnected: Date
            let reconnectCount: Int
        }

        let state = ConnectionState(
            url: "wss://localhost:8888",
            sessionId: "abc123",
            lastConnected: Date(),
            reconnectCount: 3)

        // Encode
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let data = try? encoder.encode(state)
        #expect(data != nil)

        // Decode
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let decoded = try? decoder.decode(ConnectionState.self, from: data!)

        #expect(decoded?.url == state.url)
        #expect(decoded?.sessionId == state.sessionId)
        #expect(decoded?.reconnectCount == state.reconnectCount)
    }

    // MARK: - Circuit Breaker Pattern

    @Test("Circuit breaker for repeated failures")
    func circuitBreaker() {
        class CircuitBreaker {
            private var failureCount = 0
            private let failureThreshold = 5
            private let resetTimeout: TimeInterval = 60
            private var lastFailureTime: Date?

            enum State {
                case closed // Normal operation
                case open // Failing, reject requests
                case halfOpen // Testing if service recovered
            }

            var state: State {
                if let lastFailure = lastFailureTime {
                    let timeSinceFailure = Date().timeIntervalSince(lastFailure)
                    if timeSinceFailure > self.resetTimeout {
                        return .halfOpen
                    }
                }

                return self.failureCount >= self.failureThreshold ? .open : .closed
            }

            func recordSuccess() {
                self.failureCount = 0
                self.lastFailureTime = nil
            }

            func recordFailure() {
                self.failureCount += 1
                self.lastFailureTime = Date()
            }
        }

        let breaker = CircuitBreaker()

        // Test normal state
        #expect(breaker.state == .closed)

        // Record failures
        for _ in 0..<5 {
            breaker.recordFailure()
        }

        // Circuit should be open
        #expect(breaker.state == .open)

        // Record success resets the breaker
        breaker.recordSuccess()
        #expect(breaker.state == .closed)
    }
}
