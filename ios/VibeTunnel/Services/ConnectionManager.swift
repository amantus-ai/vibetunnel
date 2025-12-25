import Foundation
import Observation

/// Manages the server connection state and configuration.
///
/// ConnectionManager handles saving and loading server configurations,
/// tracking connection state, and providing a central point for
/// connection-related operations.
@Observable
@MainActor
final class ConnectionManager {
    static let shared = ConnectionManager()

    // MARK: - Constants

    private enum Constants {
        static let connectionRestorationWindow: TimeInterval = 3600 // 1 hour
        static let savedServerConfigKey = "savedServerConfig"
        static let connectionStateKey = "connectionState"
        static let lastConnectionTimeKey = "lastConnectionTime"
    }

    var isConnected: Bool = false {
        didSet {
            guard oldValue != self.isConnected else { return }
            self.storage.set(self.isConnected, forKey: Constants.connectionStateKey)
        }
    }

    var serverConfig: ServerConfig?
    var lastConnectionTime: Date?
    private(set) var authenticationService: AuthenticationService?
    private let storage: PersistentStorage

    private init(storage: PersistentStorage = UserDefaultsStorage()) {
        self.storage = storage
        self.loadSavedConnection()
        self.restoreConnectionState()
    }

    #if DEBUG
    /// Test-only factory method for creating instances with mock storage
    /// - Parameter storage: Mock storage for testing
    /// - Returns: A new ConnectionManager instance for testing
    static func createForTesting(storage: PersistentStorage) -> ConnectionManager {
        ConnectionManager(storage: storage)
    }
    #endif

    private func loadSavedConnection() {
        if let data = storage.data(forKey: Constants.savedServerConfigKey),
           let config = try? JSONDecoder().decode(ServerConfig.self, from: data)
        {
            self.serverConfig = config

            // Set up authentication service for restored connection
            self.authenticationService = AuthenticationService(
                apiClient: APIClient.shared,
                serverConfig: config)

            // Configure API client and WebSocket client with auth service
            if let authService = authenticationService {
                APIClient.shared.setAuthenticationService(authService)
                BufferWebSocketClient.shared.setAuthenticationService(authService)
            }
        }
    }

    private func restoreConnectionState() {
        // Restore connection state if app was terminated while connected
        let wasConnected = self.storage.bool(forKey: Constants.connectionStateKey)
        if let lastConnectionData = storage.object(forKey: Constants.lastConnectionTimeKey) as? Date {
            self.lastConnectionTime = lastConnectionData

            // Only restore connection if it was within the last hour
            let timeSinceLastConnection = Date().timeIntervalSince(lastConnectionData)
            if wasConnected, timeSinceLastConnection < Constants.connectionRestorationWindow, self.serverConfig != nil {
                // Attempt to restore connection
                self.isConnected = true
            } else {
                // Clear stale connection state
                self.isConnected = false
            }
        }
    }

    func saveConnection(_ config: ServerConfig) {
        if let data = try? JSONEncoder().encode(config) {
            // Create and configure authentication service BEFORE saving config
            // This prevents race conditions where other components try to use
            // the API client before authentication is properly configured
            self.authenticationService = AuthenticationService(
                apiClient: APIClient.shared,
                serverConfig: config)

            // Configure API client and WebSocket client with auth service
            if let authService = authenticationService {
                APIClient.shared.setAuthenticationService(authService)
                BufferWebSocketClient.shared.setAuthenticationService(authService)
            }

            // Now save the config and timestamp after auth is set up
            self.storage.set(data, forKey: Constants.savedServerConfigKey)
            self.serverConfig = config

            // Save connection timestamp
            self.lastConnectionTime = Date()
            self.storage.set(self.lastConnectionTime, forKey: Constants.lastConnectionTimeKey)
        }
    }

    func disconnect() async {
        self.isConnected = false
        self.storage.removeObject(forKey: Constants.connectionStateKey)
        self.storage.removeObject(forKey: Constants.lastConnectionTimeKey)

        await self.authenticationService?.logout()
        self.authenticationService = nil
    }

    var currentServerConfig: ServerConfig? {
        self.serverConfig
    }
}
