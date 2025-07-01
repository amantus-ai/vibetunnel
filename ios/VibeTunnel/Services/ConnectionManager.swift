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
    
    // MARK: - Constants
    
    private enum Constants {
        static let connectionRestorationWindow: TimeInterval = 3_600 // 1 hour
        static let savedServerConfigKey = "savedServerConfig"
        static let connectionStateKey = "connectionState"
        static let lastConnectionTimeKey = "lastConnectionTime"
    }
    var isConnected: Bool = false {
        didSet {
            guard oldValue != isConnected else { return }
            storage.set(isConnected, forKey: Constants.connectionStateKey)
        }
    }

    var serverConfig: ServerConfig?
    var lastConnectionTime: Date?
    private(set) var authenticationService: AuthenticationService?
    private let storage: PersistentStorage

    init(storage: PersistentStorage = UserDefaultsStorage()) {
        self.storage = storage
        loadSavedConnection()
        restoreConnectionState()
    }

    private func loadSavedConnection() {
        if let data = storage.data(forKey: Constants.savedServerConfigKey),
           let config = try? JSONDecoder().decode(ServerConfig.self, from: data)
        {
            self.serverConfig = config
            
            // Set up authentication service for restored connection
            authenticationService = AuthenticationService(
                apiClient: APIClient.shared,
                serverConfig: config
            )
            
            // Configure API client and WebSocket client with auth service
            if let authService = authenticationService {
                APIClient.shared.setAuthenticationService(authService)
                BufferWebSocketClient.shared.setAuthenticationService(authService)
            }
        }
    }

    private func restoreConnectionState() {
        // Restore connection state if app was terminated while connected
        let wasConnected = storage.bool(forKey: Constants.connectionStateKey)
        if let lastConnectionData = storage.object(forKey: Constants.lastConnectionTimeKey) as? Date {
            lastConnectionTime = lastConnectionData

            // Only restore connection if it was within the last hour
            let timeSinceLastConnection = Date().timeIntervalSince(lastConnectionData)
            if wasConnected && timeSinceLastConnection < Constants.connectionRestorationWindow && serverConfig != nil {
                // Attempt to restore connection
                isConnected = true
            } else {
                // Clear stale connection state
                isConnected = false
            }
        }
    }

    func saveConnection(_ config: ServerConfig) {
        if let data = try? JSONEncoder().encode(config) {
            // Create and configure authentication service BEFORE saving config
            // This prevents race conditions where other components try to use
            // the API client before authentication is properly configured
            authenticationService = AuthenticationService(
                apiClient: APIClient.shared,
                serverConfig: config
            )

            // Configure API client and WebSocket client with auth service
            if let authService = authenticationService {
                APIClient.shared.setAuthenticationService(authService)
                BufferWebSocketClient.shared.setAuthenticationService(authService)
            }

            // Now save the config and timestamp after auth is set up
            storage.set(data, forKey: Constants.savedServerConfigKey)
            self.serverConfig = config

            // Save connection timestamp
            lastConnectionTime = Date()
            storage.set(lastConnectionTime, forKey: Constants.lastConnectionTimeKey)
        }
    }

    func disconnect() async {
        isConnected = false
        storage.removeObject(forKey: Constants.connectionStateKey)
        storage.removeObject(forKey: Constants.lastConnectionTimeKey)

        await authenticationService?.logout()
        authenticationService = nil
    }

    var currentServerConfig: ServerConfig? {
        serverConfig
    }
}

/// Make ConnectionManager accessible globally for APIClient
extension ConnectionManager {
    @MainActor static let shared = ConnectionManager()
}
