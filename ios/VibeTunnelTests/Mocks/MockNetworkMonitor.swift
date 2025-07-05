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
            isConnected = connected
        } else {
            let task = Task {
                try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                isConnected = connected
            }
            pendingStateChanges.append(task)
        }
    }

    /// Simulate intermittent connectivity (disconnect then reconnect)
    /// - Parameters:
    ///   - disconnectAfter: Delay before disconnection
    ///   - reconnectAfter: Delay before reconnection (from disconnect time)
    func simulateIntermittentConnectivity(
        disconnectAfter: TimeInterval = 0.1,
        reconnectAfter: TimeInterval = 0.2
    ) {
        simulateStateChange(to: false, after: disconnectAfter)
        simulateStateChange(to: true, after: disconnectAfter + reconnectAfter)
    }

    /// Inject error for specific scenarios
    /// - Parameter scenario: Error scenario identifier
    func injectError(for scenario: String) {
        errorScenarios.insert(scenario)
    }

    /// Check if error should be simulated for scenario
    /// - Parameter scenario: Scenario identifier
    /// - Returns: True if error should be simulated
    func shouldSimulateError(for scenario: String) -> Bool {
        errorScenarios.contains(scenario)
    }

    /// Reset mock to clean state
    func reset() {
        isConnected = true
        errorScenarios.removeAll()

        // Cancel pending state changes
        for task in pendingStateChanges {
            task.cancel()
        }
        pendingStateChanges.removeAll()
    }

    // MARK: - Test Helpers

    /// Wait for network to reach specified state
    /// - Parameters:
    ///   - connected: Target connection state
    ///   - timeout: Maximum time to wait (defaults to 2.0 seconds)
    /// - Returns: True if state was reached within timeout
    func waitForState(
        connected: Bool,
        timeout: TimeInterval = 2.0
    )
        async -> Bool
    {
        let startTime = Date()

        while isConnected != connected {
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
        simulateStateChange(to: false)
    }

    /// Simulate going online immediately
    func goOnline() {
        simulateStateChange(to: true)
    }

    /// Simulate unstable connection (rapid connect/disconnect cycles)
    /// - Parameters:
    ///   - cycles: Number of connect/disconnect cycles
    ///   - cycleInterval: Time between state changes
    func simulateUnstableConnection(cycles: Int = 3, cycleInterval: TimeInterval = 0.1) {
        for i in 0..<cycles {
            let disconnectTime = TimeInterval(i * 2) * cycleInterval
            let reconnectTime = TimeInterval(i * 2 + 1) * cycleInterval

            simulateStateChange(to: false, after: disconnectTime)
            simulateStateChange(to: true, after: reconnectTime)
        }
    }

    /// Simulate connection recovery after specified delay
    /// - Parameter delay: Delay before recovery
    func simulateConnectionRecovery(after delay: TimeInterval = 1.0) {
        simulateStateChange(to: false)
        simulateStateChange(to: true, after: delay)
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
        injectError(for: ErrorScenario.authentication)
    }

    /// Inject connection timeout error scenario
    func injectConnectionTimeoutError() {
        injectError(for: ErrorScenario.connectionTimeout)
    }

    /// Inject server unreachable error scenario
    func injectServerUnreachableError() {
        injectError(for: ErrorScenario.serverUnreachable)
    }

    /// Remove all error scenarios
    func clearAllErrors() {
        errorScenarios.removeAll()
    }
}
