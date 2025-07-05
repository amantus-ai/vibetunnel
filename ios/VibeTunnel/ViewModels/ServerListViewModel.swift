import Foundation
import os.log
import SwiftUI

/// Protocol defining the interface for server list view model
@MainActor
protocol ServerListViewModelProtocol: Observable {
    var profiles: [ServerProfile] { get }
    var isLoading: Bool { get }
    var errorMessage: String? { get set }
    var showLoginView: Bool { get set }
    var currentConnectingProfile: ServerProfile? { get set }
    var connectionManager: ConnectionManager { get }

    func loadProfiles()
    func addProfile(_ profile: ServerProfile, password: String?) async throws
    func updateProfile(_ profile: ServerProfile, password: String?) async throws
    func deleteProfile(_ profile: ServerProfile) async throws
    func initiateConnectionToProfile(_ profile: ServerProfile) async
    func connectToServer(config: ServerConfig) async
    func handleLoginSuccess(username: String, password: String) async throws
    func getPassword(for profile: ServerProfile) -> String?
}

/// View model for ServerListView - managing server profiles
@MainActor
@Observable
class ServerListViewModel: ServerListViewModelProtocol {
    var profiles: [ServerProfile] = []
    var isLoading = false
    var errorMessage: String?
    var showLoginView = false
    var currentConnectingProfile: ServerProfile?

    let connectionManager: ConnectionManager
    private let networkMonitor: NetworkMonitoring
    private let keychainService: KeychainServiceProtocol
    private let userDefaults: UserDefaults

    // Logger instances
    private let connectionLogger = Logger(category: "ServerList.Connection")
    private let authLogger = Logger(category: "ServerList.Authentication")
    private let credentialsLogger = Logger(category: "ServerList.Credentials")

    init(
        connectionManager: ConnectionManager = ConnectionManager.shared,
        networkMonitor: NetworkMonitoring = NetworkMonitor.shared,
        keychainService: KeychainServiceProtocol = KeychainService(),
        userDefaults: UserDefaults = .standard
    ) {
        self.connectionManager = connectionManager
        self.networkMonitor = networkMonitor
        self.keychainService = keychainService
        self.userDefaults = userDefaults
        loadProfiles()
    }

    func loadProfiles() {
        profiles = ServerProfile.loadAll(from: userDefaults).sorted { profile1, profile2 in
            // Sort by last connected (most recent first), then by name
            if let date1 = profile1.lastConnected, let date2 = profile2.lastConnected {
                date1 > date2
            } else if profile1.lastConnected != nil {
                true
            } else if profile2.lastConnected != nil {
                false
            } else {
                profile1.name < profile2.name
            }
        }
    }

    func addProfile(_ profile: ServerProfile, password: String? = nil) async throws {
        ServerProfile.save(profile, to: userDefaults)

        // Save password to keychain if provided
        if let password, !password.isEmpty {
            try keychainService.savePassword(password, for: profile.id)
        }

        loadProfiles()
    }

    func updateProfile(_ profile: ServerProfile, password: String? = nil) async throws {
        var updatedProfile = profile
        updatedProfile.updatedAt = Date()
        ServerProfile.save(updatedProfile, to: userDefaults)

        // Handle password updates based on auth requirement
        if !profile.requiresAuth {
            // If profile doesn't require auth, remove any stored password
            try? keychainService.deletePassword(for: profile.id)
        } else if let password {
            if password.isEmpty {
                // Delete password if empty string provided
                try keychainService.deletePassword(for: profile.id)
            } else {
                // Save new password
                try keychainService.savePassword(password, for: profile.id)
            }
        }
        // If password is nil and profile requires auth, leave existing password unchanged

        loadProfiles()
    }

    func deleteProfile(_ profile: ServerProfile) async throws {
        ServerProfile.delete(profile, from: userDefaults)

        // Delete password from keychain
        try keychainService.deletePassword(for: profile.id)

        loadProfiles()
    }

    func getPassword(for profile: ServerProfile) -> String? {
        do {
            return try keychainService.getPassword(for: profile.id)
        } catch {
            // Password not found or error occurred
            return nil
        }
    }

    func connectToProfile(_ profile: ServerProfile) async throws {
        connectionLogger.info("🔗 Starting connection to profile: \(profile.name) (id: \(profile.id))")
        connectionLogger
            .debug("🔗 Profile details: requiresAuth=\(profile.requiresAuth), username=\(profile.username ?? "nil")")

        isLoading = true
        errorMessage = nil
        showLoginView = false
        defer { isLoading = false }

        // Create server config
        guard let config = profile.toServerConfig() else {
            connectionLogger.error("🔗 ❌ Failed to create server config")
            throw APIError.invalidURL
        }
        connectionLogger.debug("🔗 ✅ Created server config: \(config.baseURL)")

        // Save connection - this sets up the AuthenticationService
        connectionManager.saveConnection(config)
        connectionLogger.debug("🔗 ✅ Saved connection to manager")

        // Get auth service
        guard let authService = connectionManager.authenticationService else {
            connectionLogger.error("🔗 ❌ No authentication service available")
            throw APIError.noServerConfigured
        }
        connectionLogger.debug("🔗 ✅ Got authentication service")

        // Check if server requires authentication
        let authConfig = try await authService.getAuthConfig()
        connectionLogger.debug("🔗 Auth config: noAuth=\(authConfig.noAuth)")

        if authConfig.noAuth {
            // No auth required, test connection directly
            connectionLogger.info("🔗 No auth required, testing connection directly")
            _ = try await APIClient.shared.getSessions()
            connectionManager.isConnected = true
            ServerProfile.updateLastConnected(for: profile.id, in: userDefaults)
            loadProfiles()
            connectionLogger.info("🔗 ✅ Connection successful (no auth)")
            return
        }

        // Authentication required - attempt auto-login
        connectionLogger.info("🔗 Authentication required, attempting auto-login")
        do {
            try await authService.attemptAutoLogin(profile: profile)
            connectionLogger.info("🔗 ✅ Auto-login successful")

            // Auto-login successful, test connection
            _ = try await APIClient.shared.getSessions()
            connectionManager.isConnected = true
            ServerProfile.updateLastConnected(for: profile.id, in: userDefaults)
            loadProfiles()
            connectionLogger.info("🔗 ✅ Connection fully established")
            connectionLogger.debug(
                "🔗 📊 ConnectionManager state: isConnected=\(connectionManager.isConnected), serverConfig=\(connectionManager.serverConfig != nil ? "✅" : "❌")"
            )
        } catch let authError as AuthenticationError {
            // Auto-login failed, show login view
            authLogger.warning("🔗 ⚠️ Auto-login failed: \(authError.localizedDescription)")

            // If profile says no auth required but server requires it, update profile
            if !profile.requiresAuth {
                switch authError {
                case .credentialsNotFound:
                    authLogger.info("🔗 📝 Updating profile to require authentication")
                    var updatedProfile = profile
                    updatedProfile.requiresAuth = true
                    updatedProfile.username = "admin" // Default username
                    ServerProfile.save(updatedProfile, to: userDefaults)
                    loadProfiles()
                default:
                    break
                }
            }

            showLoginView = true
            // Don't throw - UI will handle login modal
        }
    }

    func testConnection(for profile: ServerProfile) async -> Bool {
        let password = profile.requiresAuth ? getPassword(for: profile) : nil
        guard let config = profile.toServerConfig(password: password) else {
            return false
        }

        // Save the config temporarily to test using injected connection manager
        connectionManager.saveConnection(config)

        do {
            _ = try await APIClient.shared.getSessions()
            return true
        } catch {
            return false
        }
    }

    /// Initiate connection to a profile (replaces View logic)
    func initiateConnectionToProfile(_ profile: ServerProfile) async {
        guard networkMonitor.isConnected else {
            errorMessage = "No internet connection available"
            return
        }

        // Store the current profile for potential login callback
        currentConnectingProfile = profile

        do {
            try await connectToProfile(profile)
            // Connection successful - auto-login worked or no auth required
        } catch {
            // Network, server, or other non-auth errors
            errorMessage = "Failed to connect: \(error.localizedDescription)"
        }
    }

    /// Handle successful login and save credentials
    func handleLoginSuccess(username: String, password: String) async throws {
        guard let profile = currentConnectingProfile else {
            credentialsLogger.warning("⚠️ No current connecting profile found")
            throw AuthenticationError.invalidCredentials
        }

        credentialsLogger.info("💾 Saving credentials after successful login for profile: \(profile.name)")
        credentialsLogger.debug("💾 Username: \(username), Password length: \(password.count)")

        // Save password to keychain with profile ID
        if !password.isEmpty {
            try keychainService.savePassword(password, for: profile.id)
            credentialsLogger.info("💾 Password saved to keychain successfully")
        }

        // Update profile with correct username and auth requirement
        var updatedProfile = profile
        updatedProfile.requiresAuth = true
        updatedProfile.username = username
        ServerProfile.save(updatedProfile, to: userDefaults)
        credentialsLogger.info("💾 Profile updated with username: \(username)")

        // Mark connection as successful
        connectionManager.isConnected = true

        // Reload profiles to reflect changes
        loadProfiles()
    }

    func connectToServer(config: ServerConfig) async {
        guard networkMonitor.isConnected else {
            errorMessage = "No internet connection available"
            return
        }

        isLoading = true
        defer { isLoading = false }

        // Save connection temporarily
        connectionManager.saveConnection(config)

        do {
            // Try to get sessions to check if auth is required
            _ = try await APIClient.shared.getSessions()
            // Success - no auth required
            connectionManager.isConnected = true
        } catch {
            if case APIError.serverError(401, _) = error {
                // Authentication required
                // Authentication service is already set by saveConnection
                showLoginView = true
            } else {
                // Other error
                errorMessage = "Failed to connect: \(error.localizedDescription)"
            }
        }
    }
}

// MARK: - Profile Creation

extension ServerListViewModel {
    func createProfileFromURL(_ urlString: String) -> ServerProfile? {
        // Clean up the URL
        var cleanURL = urlString.trimmingCharacters(in: .whitespacesAndNewlines)

        // Add http:// if no scheme is present
        if !cleanURL.contains("://") {
            cleanURL = "http://\(cleanURL)"
        }

        // Validate URL
        guard let url = URL(string: cleanURL),
              let _ = url.host
        else {
            return nil
        }

        // Generate suggested name
        let suggestedName = ServerProfile.suggestedName(for: cleanURL)

        return ServerProfile(
            name: suggestedName,
            url: cleanURL,
            requiresAuth: false
        )
    }
}
