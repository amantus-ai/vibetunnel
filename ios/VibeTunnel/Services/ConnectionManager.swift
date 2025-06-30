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
    var isConnected: Bool = false {
        didSet {
            storage.set(isConnected, forKey: "connectionState")
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
        if let data = storage.data(forKey: "savedServerConfig"),
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
        let wasConnected = storage.bool(forKey: "connectionState")
        if let lastConnectionData = storage.object(forKey: "lastConnectionTime") as? Date {
            lastConnectionTime = lastConnectionData

            // Only restore connection if it was within the last hour
            let timeSinceLastConnection = Date().timeIntervalSince(lastConnectionData)
            if wasConnected && timeSinceLastConnection < 3_600 && serverConfig != nil {
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
            storage.set(data, forKey: "savedServerConfig")
            self.serverConfig = config

            // Save connection timestamp
            lastConnectionTime = Date()
            storage.set(lastConnectionTime, forKey: "lastConnectionTime")

            // Create and configure authentication service
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

    func disconnect() {
        isConnected = false
        storage.removeObject(forKey: "connectionState")
        storage.removeObject(forKey: "lastConnectionTime")

        // Clean up authentication
        Task {
            await authenticationService?.logout()
            authenticationService = nil
        }
    }

    var currentServerConfig: ServerConfig? {
        serverConfig
    }
}

/// Make ConnectionManager accessible globally for APIClient
extension ConnectionManager {
    @MainActor static let shared = ConnectionManager()
}