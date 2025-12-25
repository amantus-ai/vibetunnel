import Foundation
import Network

/// Manages automatic reconnection with exponential backoff.
/// Monitors network status and attempts to restore connections when possible.
@MainActor
@Observable
class ReconnectionManager {
    private let connectionManager: ConnectionManager
    private let maxRetries = 5
    private var currentRetry = 0
    private var reconnectionTask: Task<Void, Never>?

    var isReconnecting = false
    var nextRetryTime: Date?
    var lastError: Error?

    init(connectionManager: ConnectionManager) {
        self.connectionManager = connectionManager
        self.setupNetworkMonitoring()
    }

    private func setupNetworkMonitoring() {
        // Listen for network changes
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(self.networkStatusChanged),
            name: NetworkMonitor.statusChangedNotification,
            object: nil)
    }

    @objc
    private func networkStatusChanged() {
        if NetworkMonitor.shared.isConnected, !self.connectionManager.isConnected {
            // Network is back, attempt reconnection
            self.startReconnection()
        }
    }

    func startReconnection() {
        guard !self.isReconnecting,
              let serverConfig = connectionManager.serverConfig else { return }

        self.isReconnecting = true
        self.currentRetry = 0
        self.lastError = nil

        self.reconnectionTask?.cancel()
        self.reconnectionTask = Task {
            await self.performReconnection(config: serverConfig)
        }
    }

    func stopReconnection() {
        self.isReconnecting = false
        self.currentRetry = 0
        self.nextRetryTime = nil
        self.reconnectionTask?.cancel()
        self.reconnectionTask = nil
    }

    private func performReconnection(config: ServerConfig) async {
        while self.isReconnecting, self.currentRetry < self.maxRetries {
            // Check if we still have network
            guard NetworkMonitor.shared.isConnected else {
                // Wait for network to come back
                try? await Task.sleep(for: .seconds(5))
                continue
            }

            do {
                // Attempt connection
                _ = try await APIClient.shared.getSessions()

                // Success!
                self.connectionManager.isConnected = true
                self.isReconnecting = false
                self.currentRetry = 0
                self.nextRetryTime = nil
                self.lastError = nil

                // Update last connection time
                self.connectionManager.saveConnection(config)

                return
            } catch {
                self.lastError = error
                self.currentRetry += 1

                if self.currentRetry < self.maxRetries {
                    // Calculate exponential backoff
                    let backoffSeconds = min(pow(2.0, Double(currentRetry - 1)), 60.0)
                    self.nextRetryTime = Date().addingTimeInterval(backoffSeconds)

                    try? await Task.sleep(for: .seconds(backoffSeconds))
                }
            }
        }

        // Max retries reached
        self.isReconnecting = false
        await self.connectionManager.disconnect()
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }
}

// MARK: - Exponential Backoff Calculator

extension ReconnectionManager {
    /// Calculate the next retry delay using exponential backoff
    static func calculateBackoff(
        attempt: Int,
        baseDelay: TimeInterval = 1.0,
        maxDelay: TimeInterval = 60.0)
        -> TimeInterval
    {
        let exponentialDelay = baseDelay * pow(2.0, Double(attempt - 1))
        return min(exponentialDelay, maxDelay)
    }
}

// MARK: - NetworkMonitor Extension

extension NetworkMonitor {
    static let statusChangedNotification = Notification.Name("NetworkStatusChanged")
}
