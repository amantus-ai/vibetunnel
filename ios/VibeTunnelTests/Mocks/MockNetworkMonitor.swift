import Foundation
@testable import VibeTunnel

/// Mock implementation of NetworkMonitoring for testing
/// Provides controllable network state simulation and error injection
@MainActor
class MockNetworkMonitor: NetworkMonitoring {
    // MARK: - Properties

    /// Current network connection state
    private(set) var isConnected: Bool

    /// Error scenarios to simulate
    private var errorScenarios: Set<String> = []

    /// Pending state change tasks
    private var pendingStateChanges: [Task<Void, Never>] = []

    // MARK: - Initialization

    /// Initialize mock network monitor with specified connection state
    /// - Parameter isConnected: Initial connection state (defaults to true)
    init(isConnected: Bool = true) {
        self.isConnected = isConnected
    }

    // MARK: - State Control

    /// Simulate network state change
    /// - Parameters:
    ///   - connected: Target connection state
    ///   - delay: Optional delay before state change (defaults to immediate)
    func simulateStateChange(to connected: Bool, after delay: TimeInterval = 0) {
        if delay == 0 {
            self.isConnected = connected
        } else {
            let task = Task {
                try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                self.isConnected = connected
            }
            self.pendingStateChanges.append(task)
        }
    }

    /// Simulate intermittent connectivity (disconnect then reconnect)
    /// - Parameters:
    ///   - disconnectAfter: Delay before disconnection
    ///   - reconnectAfter: Delay before reconnection (from disconnect time)
    func simulateIntermittentConnectivity(
        disconnectAfter: TimeInterval = 0.1,
        reconnectAfter: TimeInterval = 0.2)
    {
        self.simulateStateChange(to: false, after: disconnectAfter)
        self.simulateStateChange(to: true, after: disconnectAfter + reconnectAfter)
    }

    /// Inject error for specific scenarios
    /// - Parameter scenario: Error scenario identifier
    func injectError(for scenario: String) {
        self.errorScenarios.insert(scenario)
    }

    /// Check if error should be simulated for scenario
    /// - Parameter scenario: Scenario identifier
    /// - Returns: True if error should be simulated
    func shouldSimulateError(for scenario: String) -> Bool {
        self.errorScenarios.contains(scenario)
    }

    /// Reset mock to clean state
    func reset() {
        self.isConnected = true
        self.errorScenarios.removeAll()

        // Cancel pending state changes
        for task in self.pendingStateChanges {
            task.cancel()
        }
        self.pendingStateChanges.removeAll()
    }

    // MARK: - Test Helpers

    /// Wait for network to reach specified state
    /// - Parameters:
    ///   - connected: Target connection state
    ///   - timeout: Maximum time to wait (defaults to 2.0 seconds)
    /// - Returns: True if state was reached within timeout
    func waitForState(
        connected: Bool,
        timeout: TimeInterval = 2.0)
        async -> Bool
    {
        let startTime = Date()

        while self.isConnected != connected {
            if Date().timeIntervalSince(startTime) > timeout {
                return false
            }
            try? await Task.sleep(nanoseconds: UInt64(0.01 * 1_000_000_000))
        }

        return true
    }
}

// MARK: - Convenience Extensions

extension MockNetworkMonitor {
    /// Simulate going offline immediately
    func goOffline() {
        self.simulateStateChange(to: false)
    }

    /// Simulate going online immediately
    func goOnline() {
        self.simulateStateChange(to: true)
    }

    /// Simulate unstable connection (rapid connect/disconnect cycles)
    /// - Parameters:
    ///   - cycles: Number of connect/disconnect cycles
    ///   - cycleInterval: Time between state changes
    func simulateUnstableConnection(cycles: Int = 3, cycleInterval: TimeInterval = 0.1) {
        for i in 0..<cycles {
            let disconnectTime = TimeInterval(i * 2) * cycleInterval
            let reconnectTime = TimeInterval(i * 2 + 1) * cycleInterval

            self.simulateStateChange(to: false, after: disconnectTime)
            self.simulateStateChange(to: true, after: reconnectTime)
        }
    }

    /// Simulate connection recovery after specified delay
    /// - Parameter delay: Delay before recovery
    func simulateConnectionRecovery(after delay: TimeInterval = 1.0) {
        self.simulateStateChange(to: false)
        self.simulateStateChange(to: true, after: delay)
    }
}

// MARK: - Error Scenarios

extension MockNetworkMonitor {
    /// Common error scenarios for testing
    enum ErrorScenario {
        static let authentication = "authentication"
        static let connectionTimeout = "connection_timeout"
        static let serverUnreachable = "server_unreachable"
        static let networkUnavailable = "network_unavailable"
        static let certificateError = "certificate_error"
        static let apiError = "api_error"
    }

    /// Inject authentication error scenario
    func injectAuthenticationError() {
        self.injectError(for: ErrorScenario.authentication)
    }

    /// Inject connection timeout error scenario
    func injectConnectionTimeoutError() {
        self.injectError(for: ErrorScenario.connectionTimeout)
    }

    /// Inject server unreachable error scenario
    func injectServerUnreachableError() {
        self.injectError(for: ErrorScenario.serverUnreachable)
    }

    /// Remove all error scenarios
    func clearAllErrors() {
        self.errorScenarios.removeAll()
    }
}
