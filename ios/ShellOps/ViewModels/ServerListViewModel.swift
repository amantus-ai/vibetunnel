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
    var connectionStatusMessage: String?

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

    func loadProfilesAndCheckHealth() {
        loadProfiles()

        // Check health of all profiles in background
        Task {
            await checkAndUpdateAllProfiles()
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
        // connectionLogger.info("🔗 Starting connection to profile: \(profile.name) (id: \(profile.id))")
        connectionLogger
            .debug("🔗 Profile details: requiresAuth=\(profile.requiresAuth), username=\(profile.username ?? "nil")")

        // Log profile URL and connection details
        // connectionLogger.info("🔗 Profile URL: \(profile.url)")
        // connectionLogger.info("🔗 HTTPS Available: \(profile.httpsAvailable), Prefer SSL: \(profile.preferSSL)")
        // connectionLogger.info("🔗 Tailscale Hostname: \(profile.tailscaleHostname ?? "nil")")

        isLoading = true
        errorMessage = nil
        showLoginView = false
        defer { isLoading = false }

        // Create server config
        guard var config = profile.toServerConfig() else {
            connectionLogger.error("🔗 ❌ Failed to create server config")
            throw APIError.invalidURL
        }
        // connectionLogger.info("🔗 ✅ Created server config:")
        // connectionLogger.info("🔗   - baseURL: \(config.baseURL)")
        // connectionLogger.info("🔗   - connectionURL: \(config.connectionURL())")
        // connectionLogger.info("🔗   - httpsAvailable: \(config.httpsAvailable)")
        // connectionLogger.info("🔗   - preferSSL: \(config.preferSSL)")
        // connectionLogger.info("🔗   - isPublic: \(config.isPublic)")
        // connectionLogger.info("🔗   - host: \(config.host)")
        // connectionLogger.info("🔗   - port: \(config.port)")

        // Try connection with current settings first
        var fallbackAttempted = false

        do {
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
                // connectionLogger.info("🔗 No auth required, testing connection directly")
                _ = try await APIClient.shared.getSessions()
                connectionManager.isConnected = true
                ServerProfile.updateLastConnected(for: profile.id, in: userDefaults)
                loadProfiles()
                // connectionLogger.info("🔗 ✅ Connection successful (no auth)")
                return
            }

            // Authentication required - attempt auto-login
            // connectionLogger.info("🔗 Authentication required, attempting auto-login")
            try await authService.attemptAutoLogin(profile: profile)
            // connectionLogger.info("🔗 ✅ Auto-login successful")

            // Auto-login successful, test connection
            _ = try await APIClient.shared.getSessions()
            connectionManager.isConnected = true
            ServerProfile.updateLastConnected(for: profile.id, in: userDefaults)
            loadProfiles()
            // connectionLogger.info("🔗 ✅ Connection fully established")
            connectionLogger.debug(
                "🔗 📊 ConnectionManager state: isConnected=\(connectionManager.isConnected), serverConfig=\(connectionManager.serverConfig != nil ? "✅" : "❌")"
            )
        } catch let authError as AuthenticationError {
            // Handle authentication errors first
            connectionLogger.error("🔗 ❌ Authentication error: \(authError)")
            // connectionLogger.info("🔗 🔐 Authentication error detected, showing login view")

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

            // Show login screen with the connecting profile
            currentConnectingProfile = profile
            showLoginView = true

            // Throw the error to be caught in initiateConnectionToProfile
            throw authError
        } catch {
            connectionLogger.error("🔗 ❌ Initial connection failed: \(error)")
            // connectionLogger.info("🔗 Error type: \(String(describing: type(of: error)))")

            // Only attempt fallback for Tailscale servers that were using HTTPS
            if profile.isTailscaleEnabled && config.httpsAvailable && config.preferSSL && !fallbackAttempted {
                connectionLogger.warning("🔗 ⚠️ HTTPS connection failed, trying HTTP fallback")
                // connectionLogger.info("🔗 Error type: \(String(describing: type(of: error)))")

                connectionStatusMessage = "HTTPS unavailable, switching to HTTP..."
                fallbackAttempted = true

                // First, do a health check to get current server state
                if let healthProfile = await checkServerHealth(for: profile) {
                    connectionLogger
                        .info(
                            "🔗 Health check result - HTTPS: \(healthProfile.httpsAvailable), Public: \(healthProfile.isPublic)"
                        )

                    // Save the updated profile from health check
                    ServerProfile.save(healthProfile, to: userDefaults)

                    // Create new config from health check results
                    guard var newConfig = healthProfile.toServerConfig() else {
                        connectionLogger.error("🔗 ❌ Failed to create config from health check")
                        throw APIError.invalidURL
                    }

                    // Force HTTP for this attempt
                    newConfig.httpsAvailable = false
                    newConfig.preferSSL = false

                    // connectionLogger.info("🔗 Retrying with HTTP: \(newConfig.connectionURL())")

                    // Save and retry with HTTP config
                    connectionManager.saveConnection(newConfig)

                    // Try connection again with updated config
                    do {
                        guard let authService = connectionManager.authenticationService else {
                            throw APIError.noServerConfigured
                        }

                        let authConfig = try await authService.getAuthConfig()

                        if authConfig.noAuth {
                            _ = try await APIClient.shared.getSessions()
                            connectionManager.isConnected = true
                            ServerProfile.updateLastConnected(for: healthProfile.id, in: userDefaults)
                            loadProfiles()
                            // connectionLogger.info("🔗 ✅ HTTP fallback successful (no auth)")
                            connectionStatusMessage = nil
                            return
                        } else {
                            try await authService.attemptAutoLogin(profile: healthProfile)
                            _ = try await APIClient.shared.getSessions()
                            connectionManager.isConnected = true
                            ServerProfile.updateLastConnected(for: healthProfile.id, in: userDefaults)
                            loadProfiles()
                            // connectionLogger.info("🔗 ✅ HTTP fallback successful (with auth)")
                            connectionStatusMessage = nil
                            return
                        }
                    } catch {
                        connectionLogger.error("🔗 ❌ HTTP fallback also failed: \(error)")
                    }
                } else {
                    connectionLogger.warning("🔗 ⚠️ Health check failed, trying blind HTTP fallback")

                    // Blind fallback without health check
                    config.httpsAvailable = false
                    config.preferSSL = false
                    config.isPublic = false

                    var updatedProfile = profile
                    updatedProfile.httpsAvailable = false
                    updatedProfile.preferSSL = false
                    updatedProfile.isPublic = false
                    ServerProfile.save(updatedProfile, to: userDefaults)

                    connectionManager.saveConnection(config)

                    // Try one more time with HTTP
                    do {
                        guard let authService = connectionManager.authenticationService else {
                            throw APIError.noServerConfigured
                        }

                        let authConfig = try await authService.getAuthConfig()

                        if authConfig.noAuth {
                            _ = try await APIClient.shared.getSessions()
                            connectionManager.isConnected = true
                            ServerProfile.updateLastConnected(for: updatedProfile.id, in: userDefaults)
                            loadProfiles()
                            // connectionLogger.info("🔗 ✅ Blind HTTP fallback successful")
                            connectionStatusMessage = nil
                            return
                        } else {
                            try await authService.attemptAutoLogin(profile: updatedProfile)
                            _ = try await APIClient.shared.getSessions()
                            connectionManager.isConnected = true
                            ServerProfile.updateLastConnected(for: updatedProfile.id, in: userDefaults)
                            loadProfiles()
                            // connectionLogger.info("🔗 ✅ Blind HTTP fallback successful (with auth)")
                            connectionStatusMessage = nil
                            return
                        }
                    } catch {
                        connectionLogger.error("🔗 ❌ Blind HTTP fallback also failed: \(error)")
                    }
                }
            }

            // Only update Tailscale servers after failure (they might have switched modes)
            if profile.isTailscaleEnabled {
                // connectionLogger.info("🔗 📊 Updating Tailscale server UI after connection failure")
                if let healthProfile = await checkServerHealth(for: profile) {
                    connectionLogger
                        .info(
                            "🔗 📊 Server actual state - HTTPS: \(healthProfile.httpsAvailable), Public: \(healthProfile.isPublic)"
                        )
                    connectionLogger
                        .info("🔗 📊 Profile was - HTTPS: \(profile.httpsAvailable), Public: \(profile.isPublic)")

                    // Save the actual server state to update UI
                    ServerProfile.save(healthProfile, to: userDefaults)

                    // Force UI refresh to show correct lock/unlock icons
                    await MainActor.run {
                        loadProfiles()
                    }

                    // connectionLogger.info("🔗 ✅ UI updated to reflect server state change")
                } else {
                    connectionLogger.warning("🔗 ⚠️ Could not determine server state, updating profile to HTTP-only")
                    // If we can't reach the server, assume HTTP only
                    var fallbackProfile = profile
                    fallbackProfile.httpsAvailable = false
                    fallbackProfile.preferSSL = false
                    fallbackProfile.isPublic = false
                    ServerProfile.save(fallbackProfile, to: userDefaults)
                    await MainActor.run {
                        loadProfiles()
                    }
                }
            }

            // Clear status message
            connectionStatusMessage = nil

            // Handle specific error types for user feedback
            if let apiError = error as? APIError {
                switch apiError {
                case .serverError(401, _):
                    // Authentication required but no auto-login available
                    showLoginView = true
                    return
                case .networkError:
                    errorMessage = "Cannot connect to server. Please check the server is running and accessible."
                    connectionLogger.error("🔗 ❌ Network error: Server not accessible")
                    // Don't throw - let user see error but don't block UI
                    return
                default:
                    errorMessage = "Connection failed. The server may have switched between public and private mode. Please tap refresh and try again."
                    // Don't throw - let user see error but don't block UI
                    return
                }
            } else {
                errorMessage = "Connection failed: \(error.localizedDescription)"
                // Don't throw - let user see error but don't block UI
                return
            }
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

    /// Check and update all saved profiles with current server state
    func checkAndUpdateAllProfiles() async {
        // connectionLogger.info("🔍 Checking health of all saved profiles")

        var updatedProfiles: [ServerProfile] = []
        var hasChanges = false

        for profile in profiles {
            // Only check health for Tailscale-enabled servers
            guard profile.isTailscaleEnabled else {
                // connectionLogger.info("🔍 Skipping non-Tailscale profile: \(profile.name)")
                updatedProfiles.append(profile)
                continue
            }

            connectionLogger
                .info(
                    "🔍 Checking Tailscale profile: \(profile.name), current HTTPS: \(profile.httpsAvailable), Public: \(profile.isPublic)"
                )

            // Check each Tailscale profile's server health
            if let updatedProfile = await checkServerHealth(for: profile) {
                connectionLogger
                    .info(
                        "🔍 Health check result for \(profile.name): HTTPS: \(updatedProfile.httpsAvailable), Public: \(updatedProfile.isPublic)"
                    )

                if updatedProfile.httpsAvailable != profile.httpsAvailable ||
                    updatedProfile.isPublic != profile.isPublic ||
                    updatedProfile.preferSSL != profile.preferSSL
                {
                    hasChanges = true
                    connectionLogger
                        .info(
                            "🔍 Profile \(profile.name) updated - HTTPS: \(updatedProfile.httpsAvailable), Public: \(updatedProfile.isPublic), PreferSSL: \(updatedProfile.preferSSL)"
                        )
                } else {
                    // connectionLogger.info("🔍 Profile \(profile.name) unchanged")
                }
                updatedProfiles.append(updatedProfile)
            } else {
                // connectionLogger.info("🔍 Health check failed for \(profile.name), keeping original")
                // Keep original if probe fails
                updatedProfiles.append(profile)
            }
        }

        // Update profiles if any changes detected
        if hasChanges {
            // connectionLogger.info("🔍 Saving \(updatedProfiles.count) updated profiles")
            for profile in updatedProfiles {
                ServerProfile.save(profile, to: userDefaults)
            }
            // Reload to refresh UI
            await MainActor.run {
                // connectionLogger.info("🔍 Reloading profiles to refresh UI")
                loadProfiles()
            }
        } else {
            // connectionLogger.info("🔍 No changes detected in any profiles")
        }
    }

    /// Check server health and return updated profile
    private func checkServerHealth(for profile: ServerProfile) async -> ServerProfile? {
        let probeHost = profile.host ?? URL(string: profile.url)?.host
        guard let probeHost else {
            connectionLogger.error("🔍 No host found for profile \(profile.name)")
            return nil
        }

        let httpUrl = "http://\(probeHost):\(profile.port ?? 4_020)/api/health"
        var updatedProfile = profile

        // connectionLogger.info("🔍 Probing health at: \(httpUrl)")

        do {
            let configuration = URLSessionConfiguration.default
            configuration.timeoutIntervalForRequest = 2.0 // Quick timeout
            let session = URLSession(configuration: configuration)

            if let url = URL(string: httpUrl) {
                let (data, response) = try await session.data(from: url)

                if let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 {
                    // connectionLogger.info("🔍 Health endpoint responded with 200")

                    // Parse health response
                    if let health = try? JSONDecoder().decode(HealthResponse.self, from: data),
                       let connections = health.connections
                    {
                        // connectionLogger.info("🔍 Health data connections: \(connections)")

                        // Check for Tailscale info
                        if let tailscale = connections.tailscale {
                            let httpsAvailable = tailscale.httpsAvailable ?? false
                            let isPublic = tailscale.isPublic ?? false

                            // connectionLogger.info("🔍 Tailscale data - HTTPS: \(httpsAvailable), Public: \(isPublic)")

                            updatedProfile.httpsAvailable = httpsAvailable
                            updatedProfile.isPublic = isPublic
                            updatedProfile.preferSSL = httpsAvailable

                            return updatedProfile
                        }

                        // Fallback to general connection info
                        let httpsAvailable = connections.sslAvailable ?? false
                        let isPublic = connections.isPublic ?? false

                        connectionLogger
                            .info("🔍 General connection data - HTTPS: \(httpsAvailable), Public: \(isPublic)")

                        updatedProfile.httpsAvailable = httpsAvailable
                        updatedProfile.isPublic = isPublic
                        updatedProfile.preferSSL = httpsAvailable

                        return updatedProfile
                    }
                }
            }
        } catch {
            connectionLogger.debug("🔍 Health check failed for \(profile.name): \(error.localizedDescription)")
        }

        return nil
    }

    /// Probe server capabilities and update profile if needed
    private func probeAndUpdateServerCapabilities(_ profile: ServerProfile) async -> ServerProfile? {
        // connectionLogger.info("🔍 Probing server capabilities for: \(profile.name)")

        // Try to probe using the stored Tailscale hostname if available
        let probeHost = profile.tailscaleHostname ?? profile.host ?? URL(string: profile.url)?.host
        guard let probeHost else {
            connectionLogger.error("🔍 ❌ Cannot determine host for probing")
            return nil
        }

        // First try HTTP health check (always available)
        let httpUrl = "http://\(probeHost):\(profile.port ?? 4_020)/api/health"
        var updatedProfile = profile
        var httpsAvailable = false
        var isPublic = false

        // Retry logic for probe - server might be transitioning
        var probeSuccess = false

        for attempt in 1...2 {
            if attempt > 1 {
                // connectionLogger.info("🔍 Retry probe attempt \(attempt)")
                try? await Task.sleep(nanoseconds: 1_000_000_000) // 1 second delay
            }

            do {
                let configuration = URLSessionConfiguration.default
                configuration.timeoutIntervalForRequest = 3.0 // Shorter timeout for faster retries
                let session = URLSession(configuration: configuration)

                if let url = URL(string: httpUrl) {
                    connectionLogger.debug("🔍 Probing HTTP: \(url.absoluteString)")
                    let (data, response) = try await session.data(from: url)

                    if let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 {
                        probeSuccess = true
                        // Parse health response for Tailscale info
                        if let health = try? JSONDecoder().decode(HealthResponse.self, from: data) {
                            if health.tailscaleUrl != nil {
                                httpsAvailable = true
                                // connectionLogger.info("🔍 Found Tailscale HTTPS URL: \(tailscaleUrl)")
                            }

                            if let tailscale = health.connections?.tailscale {
                                if tailscale.httpsUrl != nil {
                                    httpsAvailable = true
                                }
                                if let funnel = tailscale.funnel {
                                    isPublic = funnel
                                    // connectionLogger.info("🔍 Tailscale Funnel status: \(funnel)")
                                }
                            }
                        }
                        break // Success, exit retry loop
                    }
                }
            } catch {
                connectionLogger.warning("🔍 ⚠️ Probe attempt \(attempt) failed: \(error.localizedDescription)")
                // Continue to next attempt
            }
        }

        // After all attempts, handle failure case
        if !probeSuccess {
            connectionLogger.warning("🔍 ⚠️ All probe attempts failed")
            // If probe fails, assume server is offline or unreachable
            // ALWAYS clear HTTPS/public flags when probe fails
            httpsAvailable = false
            isPublic = false

            // Force update when probe fails - server might be transitioning
            if updatedProfile.httpsAvailable || updatedProfile.isPublic {
                // connectionLogger.info("🔍 Probe failed - clearing HTTPS/public flags")
                updatedProfile.httpsAvailable = false
                updatedProfile.isPublic = false
                updatedProfile.preferSSL = false

                // Save updated profile
                ServerProfile.save(updatedProfile, to: userDefaults)
                loadProfiles()

                return updatedProfile
            }
        }

        // Update profile if capabilities changed
        if updatedProfile.httpsAvailable != httpsAvailable || updatedProfile.isPublic != isPublic {
            // connectionLogger.info("🔍 Server capabilities changed - updating profile")
            updatedProfile.httpsAvailable = httpsAvailable
            updatedProfile.isPublic = isPublic
            updatedProfile.preferSSL = httpsAvailable // Prefer SSL if available

            // Save updated profile
            ServerProfile.save(updatedProfile, to: userDefaults)
            loadProfiles()

            return updatedProfile
        }

        return profile
    }

    /// Initiate connection to a profile (replaces View logic)
    func initiateConnectionToProfile(_ profile: ServerProfile) async {
        // connectionLogger.info("🔗 initiateConnectionToProfile called for: \(profile.name)")
        connectionLogger
            .info("🔗 Profile details - URL: \(profile.url), HTTPS: \(profile.httpsAvailable), SSL: \(profile.preferSSL)"
            )

        guard networkMonitor.isConnected else {
            connectionLogger.error("🔗 ❌ No network connection")
            errorMessage = "No internet connection available"
            return
        }
        // connectionLogger.info("🔗 Network connection available")

        // Store the current profile for potential login callback
        currentConnectingProfile = profile

        // Try to connect with the current profile settings
        // connectionLogger.info("🔗 Attempting connection with current profile settings")

        do {
            // connectionLogger.info("🔗 Calling connectToProfile...")
            try await connectToProfile(profile)
            // connectionLogger.info("🔗 ✅ Connection successful")
            // Connection successful - clear any error
            errorMessage = nil
        } catch {
            connectionLogger.error("🔗 ❌ Connection failed: \(error)")

            // If it was an auth error, show login view
            // Otherwise, show error to user
            if error is AuthenticationError {
                // connectionLogger.info("🔗 🔐 Authentication error detected, showing login view")
                showLoginView = true
                currentConnectingProfile = profile
            } else {
                errorMessage = "Failed to connect to \(profile.name). The server may have changed its connection mode. Please tap the refresh button and try again."
            }
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
              url.host != nil
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
