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
        setupNetworkMonitoring()
    }

    private func setupNetworkMonitoring() {
        // Listen for network changes
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(networkStatusChanged),
            name: NetworkMonitor.statusChangedNotification,
            object: nil
        )
    }

    @objc
    private func networkStatusChanged() {
        if NetworkMonitor.shared.isConnected && !connectionManager.isConnected {
            // Network is back, attempt reconnection
            startReconnection()
        }
    }

    func startReconnection() {
        guard !isReconnecting,
              let serverConfig = connectionManager.serverConfig else { return }

        isReconnecting = true
        currentRetry = 0
        lastError = nil

        reconnectionTask?.cancel()
        reconnectionTask = Task {
            await performReconnection(config: serverConfig)
        }
    }

    func stopReconnection() {
        isReconnecting = false
        currentRetry = 0
        nextRetryTime = nil
        reconnectionTask?.cancel()
        reconnectionTask = nil
    }

    private func performReconnection(config: ServerConfig) async {
        while isReconnecting && currentRetry < maxRetries {
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
                connectionManager.isConnected = true
                isReconnecting = false
                currentRetry = 0
                nextRetryTime = nil
                lastError = nil

                // Update last connection time
                connectionManager.saveConnection(config)

                return
            } catch {
                lastError = error
                currentRetry += 1

                if currentRetry < maxRetries {
                    // Calculate exponential backoff
                    let backoffSeconds = min(pow(2.0, Double(currentRetry - 1)), 60.0)
                    nextRetryTime = Date().addingTimeInterval(backoffSeconds)

                    try? await Task.sleep(for: .seconds(backoffSeconds))
                }
            }
        }

        // Max retries reached
        isReconnecting = false
        await connectionManager.disconnect()
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
        maxDelay: TimeInterval = 60.0
    )
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
