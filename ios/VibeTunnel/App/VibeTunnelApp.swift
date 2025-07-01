import Observation
import SwiftUI

/// Main entry point for the VibeTunnel iOS application.
@main
struct VibeTunnelApp: App {
    @State private var connectionManager = ConnectionManager()
    @State private var navigationManager = NavigationManager()
    @State private var networkMonitor = NetworkMonitor.shared
    @AppStorage("colorSchemePreference") private var colorSchemePreferenceRaw = "system"

    init() {
        // Configure app logging level
        AppConfig.configureLogging()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(connectionManager)
                .environment(navigationManager)
                .offlineBanner()
                .onOpenURL { url in
                    handleURL(url)
                }
                .task {
                    // Initialize network monitoring
                    _ = networkMonitor
                }
                .preferredColorScheme(colorScheme)
            #if targetEnvironment(macCatalyst)
                .macCatalystWindowStyle(getStoredWindowStyle())
            #endif
        }
    }

    private var colorScheme: ColorScheme? {
        switch colorSchemePreferenceRaw {
        case "light": .light
        case "dark": .dark
        default: nil // System default
        }
    }

    #if targetEnvironment(macCatalyst)
    private func getStoredWindowStyle() -> MacWindowStyle {
        let styleRaw = UserDefaults.standard.string(forKey: "macWindowStyle") ?? "standard"
        return styleRaw == "inline" ? .inline : .standard
    }
    #endif

    private func handleURL(_ url: URL) {
        // Handle vibetunnel://session/{sessionId} URLs
        guard url.scheme == "vibetunnel" else { return }

        if url.host == "session",
           let sessionId = url.pathComponents.last,
           !sessionId.isEmpty
        {
            navigationManager.navigateToSession(sessionId)
        }
    }
}

/// Manages the server connection state and configuration.
///
/// ConnectionManager handles saving and loading server configurations,
/// tracking connection state, and providing a central point for
/// connection-related operations.
@Observable
@MainActor
class ConnectionManager {
    var isConnected: Bool = false {
        didSet {
            UserDefaults.standard.set(isConnected, forKey: "connectionState")
        }
    }

    var serverConfig: ServerConfig?
    var lastConnectionTime: Date?
    private(set) var authenticationService: AuthenticationService?

    init() {
        loadSavedConnection()
        restoreConnectionState()
    }

    private func loadSavedConnection() {
        if let data = UserDefaults.standard.data(forKey: "savedServerConfig"),
           let config = try? JSONDecoder().decode(ServerConfig.self, from: data)
        {
            self.serverConfig = config
        }
    }

    private func restoreConnectionState() {
        // Restore connection state if app was terminated while connected
        let wasConnected = UserDefaults.standard.bool(forKey: "connectionState")
        if let lastConnectionData = UserDefaults.standard.object(forKey: "lastConnectionTime") as? Date {
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
            UserDefaults.standard.set(data, forKey: "savedServerConfig")
            self.serverConfig = config

            // Save connection timestamp
            lastConnectionTime = Date()
            UserDefaults.standard.set(lastConnectionTime, forKey: "lastConnectionTime")

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
        UserDefaults.standard.removeObject(forKey: "connectionState")
        UserDefaults.standard.removeObject(forKey: "lastConnectionTime")

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

/// Manages app-wide navigation state.
///
/// NavigationManager handles deep linking and programmatic navigation,
/// particularly for opening specific sessions via URL schemes.
@Observable
class NavigationManager {
    var selectedSessionId: String?
    var shouldNavigateToSession: Bool = false

    func navigateToSession(_ sessionId: String) {
        selectedSessionId = sessionId
        shouldNavigateToSession = true
    }

    func clearNavigation() {
        selectedSessionId = nil
        shouldNavigateToSession = false
    }
}
