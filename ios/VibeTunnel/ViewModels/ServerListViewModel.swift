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
        userDefaults: UserDefaults = .standard)
    {
        self.connectionManager = connectionManager
        self.networkMonitor = networkMonitor
        self.keychainService = keychainService
        self.userDefaults = userDefaults
        self.loadProfiles()
    }

    func loadProfiles() {
        self.profiles = ServerProfile.loadAll(from: self.userDefaults).sorted { profile1, profile2 in
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
        self.loadProfiles()

        // Check health of all profiles in background
        Task {
            await self.checkAndUpdateAllProfiles()
        }
    }

    func addProfile(_ profile: ServerProfile, password: String? = nil) async throws {
        ServerProfile.save(profile, to: self.userDefaults)

        // Save password to keychain if provided
        if let password, !password.isEmpty {
            try self.keychainService.savePassword(password, for: profile.id)
        }

        self.loadProfiles()
    }

    func updateProfile(_ profile: ServerProfile, password: String? = nil) async throws {
        var updatedProfile = profile
        updatedProfile.updatedAt = Date()
        ServerProfile.save(updatedProfile, to: self.userDefaults)

        // Handle password updates based on auth requirement
        if !profile.requiresAuth {
            // If profile doesn't require auth, remove any stored password
            try? self.keychainService.deletePassword(for: profile.id)
        } else if let password {
            if password.isEmpty {
                // Delete password if empty string provided
                try self.keychainService.deletePassword(for: profile.id)
            } else {
                // Save new password
                try self.keychainService.savePassword(password, for: profile.id)
            }
        }
        // If password is nil and profile requires auth, leave existing password unchanged

        self.loadProfiles()
    }

    func deleteProfile(_ profile: ServerProfile) async throws {
        ServerProfile.delete(profile, from: self.userDefaults)

        // Delete password from keychain
        try self.keychainService.deletePassword(for: profile.id)

        self.loadProfiles()
    }

    func getPassword(for profile: ServerProfile) -> String? {
        do {
            return try self.keychainService.getPassword(for: profile.id)
        } catch {
            // Password not found or error occurred
            return nil
        }
    }

    func connectToProfile(_ profile: ServerProfile) async throws {
        // connectionLogger.info("🔗 Starting connection to profile: \(profile.name) (id: \(profile.id))")
        self.connectionLogger
            .debug("🔗 Profile details: requiresAuth=\(profile.requiresAuth), username=\(profile.username ?? "nil")")

        // Log profile URL and connection details
        // connectionLogger.info("🔗 Profile URL: \(profile.url)")
        // connectionLogger.info("🔗 HTTPS Available: \(profile.httpsAvailable), Prefer SSL: \(profile.preferSSL)")
        // connectionLogger.info("🔗 Tailscale Hostname: \(profile.tailscaleHostname ?? "nil")")

        self.isLoading = true
        self.errorMessage = nil
        self.showLoginView = false
        defer { isLoading = false }

        // Create server config
        guard var config = profile.toServerConfig() else {
            self.connectionLogger.error("🔗 ❌ Failed to create server config")
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
            self.connectionManager.saveConnection(config)
            self.connectionLogger.debug("🔗 ✅ Saved connection to manager")

            // Get auth service
            guard let authService = connectionManager.authenticationService else {
                self.connectionLogger.error("🔗 ❌ No authentication service available")
                throw APIError.noServerConfigured
            }
            self.connectionLogger.debug("🔗 ✅ Got authentication service")

            // Check if server requires authentication
            let authConfig = try await authService.getAuthConfig()
            self.connectionLogger
                .debug("🔗 Auth config: noAuth=\(authConfig.noAuth), tailscaleAuth=\(authConfig.tailscaleAuth ?? false)")

            if authConfig.noAuth {
                // No auth required, test connection directly
                // connectionLogger.info("🔗 No auth required, testing connection directly")
                _ = try await APIClient.shared.getSessions()
                self.connectionManager.isConnected = true
                ServerProfile.updateLastConnected(for: profile.id, in: self.userDefaults)
                self.loadProfiles()
                // connectionLogger.info("🔗 ✅ Connection successful (no auth)")
                return
            }

            // Check for Tailscale identity authentication (via Tailscale Serve headers)
            if authConfig.tailscaleAuth == true, let user = authConfig.authenticatedUser {
                self.connectionLogger.info("🔗 Tailscale identity auth available for user: \(user)")
                try await authService.authenticateWithTailscale(user: user)
                self.connectionLogger.info("🔗 ✅ Tailscale auth successful")
            } else {
                // Standard authentication - attempt auto-login with stored credentials
                try await authService.attemptAutoLogin(profile: profile)
            }
            // connectionLogger.info("🔗 ✅ Auto-login successful")

            // Auto-login successful, test connection
            _ = try await APIClient.shared.getSessions()
            self.connectionManager.isConnected = true
            ServerProfile.updateLastConnected(for: profile.id, in: self.userDefaults)
            self.loadProfiles()
            // connectionLogger.info("🔗 ✅ Connection fully established")
            self.connectionLogger.debug(
                "🔗 📊 ConnectionManager state: isConnected=\(self.connectionManager.isConnected), serverConfig=\(self.connectionManager.serverConfig != nil ? "✅" : "❌")")
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
            self.connectionLogger.error("🔗 ❌ Initial connection failed: \(error)")
            // connectionLogger.info("🔗 Error type: \(String(describing: type(of: error)))")

            // Only attempt fallback for Tailscale servers that were using HTTPS
            if profile.isTailscaleEnabled, config.httpsAvailable, config.preferSSL, !fallbackAttempted {
                self.connectionLogger
                    .warning("🔗 ⚠️ HTTPS connection failed, trying HTTP fallback on port \(profile.port ?? 4020)")

                self.connectionStatusMessage = "HTTPS unavailable, switching to HTTP..."
                fallbackAttempted = true

                // Build an HTTP fallback config directly — do NOT save profile changes
                // during fallback. The profile's stored flags (from discovery) remain authoritative.
                var httpConfig = ServerConfig(
                    host: config.tailscaleIP ?? config.tailscaleHostname ?? config.host,
                    port: profile.port ?? 4020,
                    name: config.name,
                    tailscaleHostname: config.tailscaleHostname,
                    tailscaleIP: config.tailscaleIP,
                    isTailscaleEnabled: true,
                    preferTailscale: true,
                    httpsAvailable: false,
                    isPublic: false,
                    preferSSL: false)

                self.connectionManager.saveConnection(httpConfig)

                do {
                    guard let authService = connectionManager.authenticationService else {
                        throw APIError.noServerConfigured
                    }

                    let authConfig = try await authService.getAuthConfig()

                    if authConfig.noAuth {
                        _ = try await APIClient.shared.getSessions()
                        self.connectionManager.isConnected = true
                        ServerProfile.updateLastConnected(for: profile.id, in: self.userDefaults)
                        self.loadProfiles()
                        self.connectionStatusMessage = nil
                        return
                    } else if authConfig.tailscaleAuth == true, let user = authConfig.authenticatedUser {
                        try await authService.authenticateWithTailscale(user: user)
                        _ = try await APIClient.shared.getSessions()
                        self.connectionManager.isConnected = true
                        ServerProfile.updateLastConnected(for: profile.id, in: self.userDefaults)
                        self.loadProfiles()
                        self.connectionStatusMessage = nil
                        return
                    } else {
                        try await authService.attemptAutoLogin(profile: profile)
                        _ = try await APIClient.shared.getSessions()
                        self.connectionManager.isConnected = true
                        ServerProfile.updateLastConnected(for: profile.id, in: self.userDefaults)
                        self.loadProfiles()
                        self.connectionStatusMessage = nil
                        return
                    }
                } catch {
                    self.connectionLogger.error("🔗 ❌ HTTP fallback also failed: \(error)")
                }
            }

            // Clear status message
            self.connectionStatusMessage = nil

            // Handle specific error types for user feedback
            if let apiError = error as? APIError {
                switch apiError {
                case .serverError(401, _):
                    // Authentication required but no auto-login available
                    self.showLoginView = true
                    return
                case .networkError:
                    self.errorMessage = "Cannot connect to server. Please check the server is running and accessible."
                    self.connectionLogger.error("🔗 ❌ Network error: Server not accessible")
                    // Don't throw - let user see error but don't block UI
                    return
                default:
                    self.errorMessage = "Connection failed. The server may have switched between public and private mode. Please tap refresh and try again."
                    // Don't throw - let user see error but don't block UI
                    return
                }
            } else {
                self.errorMessage = "Connection failed: \(error.localizedDescription)"
                // Don't throw - let user see error but don't block UI
                return
            }
        }
    }

    func testConnection(for profile: ServerProfile) async -> Bool {
        let password = profile.requiresAuth ? self.getPassword(for: profile) : nil
        guard let config = profile.toServerConfig(password: password) else {
            return false
        }

        // Save the config temporarily to test using injected connection manager
        self.connectionManager.saveConnection(config)

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

        for profile in self.profiles {
            // Only check health for Tailscale-enabled servers
            guard profile.isTailscaleEnabled else {
                // connectionLogger.info("🔍 Skipping non-Tailscale profile: \(profile.name)")
                updatedProfiles.append(profile)
                continue
            }

            self.connectionLogger
                .info(
                    "🔍 Checking Tailscale profile: \(profile.name), current HTTPS: \(profile.httpsAvailable), Public: \(profile.isPublic)")

            // Check each Tailscale profile's server health
            if let updatedProfile = await checkServerHealth(for: profile) {
                self.connectionLogger
                    .info(
                        "🔍 Health check result for \(profile.name): HTTPS: \(updatedProfile.httpsAvailable), Public: \(updatedProfile.isPublic)")

                if updatedProfile.httpsAvailable != profile.httpsAvailable ||
                    updatedProfile.isPublic != profile.isPublic ||
                    updatedProfile.preferSSL != profile.preferSSL
                {
                    hasChanges = true
                    self.connectionLogger
                        .info(
                            "🔍 Profile \(profile.name) updated - HTTPS: \(updatedProfile.httpsAvailable), Public: \(updatedProfile.isPublic), PreferSSL: \(updatedProfile.preferSSL)")
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
                ServerProfile.save(profile, to: self.userDefaults)
            }
            // Reload to refresh UI
            await MainActor.run {
                // connectionLogger.info("🔍 Reloading profiles to refresh UI")
                self.loadProfiles()
            }
        } else {
            // connectionLogger.info("🔍 No changes detected in any profiles")
        }
    }

    /// Check server health and return updated profile
    private func checkServerHealth(for profile: ServerProfile) async -> ServerProfile? {
        let probeHost = profile.host ?? URL(string: profile.url)?.host
        guard let probeHost else {
            self.connectionLogger.error("🔍 No host found for profile \(profile.name)")
            return nil
        }

        let httpUrl = "http://\(probeHost):\(profile.port ?? 4020)/api/health"
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
                        // Check for Tailscale info
                        if let tailscale = connections.tailscale {
                            let healthHTTPS = tailscale.httpsAvailable ?? false
                            let healthPublic = tailscale.isPublic ?? false

                            // For Tailscale profiles: the health endpoint (HTTP on port 4020)
                            // may not know about Tailscale Serve proxying HTTPS on 443.
                            // Only upgrade HTTPS flags (false→true), never downgrade flags
                            // that were set by discovery (which actually probed HTTPS).
                            if healthHTTPS || !profile.isTailscaleEnabled {
                                updatedProfile.httpsAvailable = healthHTTPS
                                updatedProfile.preferSSL = healthHTTPS
                            }
                            // Always update public/funnel status — server knows about this
                            updatedProfile.isPublic = healthPublic

                            return updatedProfile
                        }

                        // No Tailscale section in health response — for Tailscale profiles,
                        // preserve existing HTTPS flags (discovery is authoritative)
                        if profile.isTailscaleEnabled {
                            // Only update isPublic from general info if available
                            updatedProfile.isPublic = connections.isPublic ?? profile.isPublic
                            return updatedProfile
                        }

                        // For non-Tailscale profiles, use general connection info
                        let httpsAvailable = connections.sslAvailable ?? false
                        let isPublic = connections.isPublic ?? false

                        self.connectionLogger
                            .info("🔍 General connection data - HTTPS: \(httpsAvailable), Public: \(isPublic)")

                        updatedProfile.httpsAvailable = httpsAvailable
                        updatedProfile.isPublic = isPublic
                        updatedProfile.preferSSL = httpsAvailable

                        return updatedProfile
                    }
                }
            }
        } catch {
            self.connectionLogger.debug("🔍 Health check failed for \(profile.name): \(error.localizedDescription)")
        }

        return nil
    }

    /// Probe server capabilities and update profile if needed
    private func probeAndUpdateServerCapabilities(_ profile: ServerProfile) async -> ServerProfile? {
        // connectionLogger.info("🔍 Probing server capabilities for: \(profile.name)")

        // Try to probe using the stored Tailscale hostname if available
        let probeHost = profile.tailscaleHostname ?? profile.host ?? URL(string: profile.url)?.host
        guard let probeHost else {
            self.connectionLogger.error("🔍 ❌ Cannot determine host for probing")
            return nil
        }

        // First try HTTP health check (always available)
        let httpUrl = "http://\(probeHost):\(profile.port ?? 4020)/api/health"
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
                    self.connectionLogger.debug("🔍 Probing HTTP: \(url.absoluteString)")
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
                self.connectionLogger.warning("🔍 ⚠️ Probe attempt \(attempt) failed: \(error.localizedDescription)")
                // Continue to next attempt
            }
        }

        // After all attempts, handle failure case
        if !probeSuccess {
            self.connectionLogger.warning("🔍 ⚠️ All probe attempts failed")

            // For Tailscale profiles, preserve HTTPS flags from discovery even if
            // the HTTP health probe fails (server may only be reachable via Tailscale Serve)
            if profile.isTailscaleEnabled {
                self.connectionLogger.info("🔍 Probe failed but preserving Tailscale profile flags")
                return profile
            }

            // For non-Tailscale profiles, clear flags when probe fails
            httpsAvailable = false
            isPublic = false

            if updatedProfile.httpsAvailable || updatedProfile.isPublic {
                updatedProfile.httpsAvailable = false
                updatedProfile.isPublic = false
                updatedProfile.preferSSL = false

                ServerProfile.save(updatedProfile, to: self.userDefaults)
                self.loadProfiles()

                return updatedProfile
            }
        }

        // Update profile if capabilities changed
        // For Tailscale profiles, only upgrade HTTPS flags (never downgrade)
        let shouldUpdateHTTPS = if profile.isTailscaleEnabled {
            httpsAvailable && !updatedProfile.httpsAvailable // only false→true
        } else {
            updatedProfile.httpsAvailable != httpsAvailable
        }

        if shouldUpdateHTTPS || updatedProfile.isPublic != isPublic {
            if shouldUpdateHTTPS {
                updatedProfile.httpsAvailable = httpsAvailable
                updatedProfile.preferSSL = httpsAvailable
            }
            updatedProfile.isPublic = isPublic

            ServerProfile.save(updatedProfile, to: self.userDefaults)
            self.loadProfiles()

            return updatedProfile
        }

        return profile
    }

    /// Initiate connection to a profile (replaces View logic)
    func initiateConnectionToProfile(_ profile: ServerProfile) async {
        // connectionLogger.info("🔗 initiateConnectionToProfile called for: \(profile.name)")
        self.connectionLogger
            .info(
                "🔗 Profile details - URL: \(profile.url), HTTPS: \(profile.httpsAvailable), SSL: \(profile.preferSSL)")

        guard self.networkMonitor.isConnected else {
            self.connectionLogger.error("🔗 ❌ No network connection")
            self.errorMessage = "No internet connection available"
            return
        }
        // connectionLogger.info("🔗 Network connection available")

        // Store the current profile for potential login callback
        self.currentConnectingProfile = profile

        // Try to connect with the current profile settings
        // connectionLogger.info("🔗 Attempting connection with current profile settings")

        do {
            // connectionLogger.info("🔗 Calling connectToProfile...")
            try await self.connectToProfile(profile)
            // connectionLogger.info("🔗 ✅ Connection successful")
            // Connection successful - clear any error
            self.errorMessage = nil
        } catch {
            self.connectionLogger.error("🔗 ❌ Connection failed: \(error)")

            // If it was an auth error, show login view
            // Otherwise, show error to user
            if error is AuthenticationError {
                // connectionLogger.info("🔗 🔐 Authentication error detected, showing login view")
                self.showLoginView = true
                self.currentConnectingProfile = profile
            } else {
                self.errorMessage = "Failed to connect to \(profile.name). The server may have changed its connection mode. Please tap the refresh button and try again."
            }
        }
    }

    /// Handle successful login and save credentials
    func handleLoginSuccess(username: String, password: String) async throws {
        guard let profile = currentConnectingProfile else {
            self.credentialsLogger.warning("⚠️ No current connecting profile found")
            throw AuthenticationError.invalidCredentials
        }

        self.credentialsLogger.info("💾 Saving credentials after successful login for profile: \(profile.name)")
        self.credentialsLogger.debug("💾 Username: \(username), Password length: \(password.count)")

        // Save password to keychain with profile ID
        if !password.isEmpty {
            try self.keychainService.savePassword(password, for: profile.id)
            self.credentialsLogger.info("💾 Password saved to keychain successfully")
        }

        // Update profile with correct username and auth requirement
        var updatedProfile = profile
        updatedProfile.requiresAuth = true
        updatedProfile.username = username
        ServerProfile.save(updatedProfile, to: self.userDefaults)
        self.credentialsLogger.info("💾 Profile updated with username: \(username)")

        // Mark connection as successful
        self.connectionManager.isConnected = true

        // Reload profiles to reflect changes
        self.loadProfiles()
    }

    func connectToServer(config: ServerConfig) async {
        guard self.networkMonitor.isConnected else {
            self.errorMessage = "No internet connection available"
            return
        }

        self.isLoading = true
        defer { isLoading = false }

        // Save connection temporarily
        self.connectionManager.saveConnection(config)

        do {
            // Try to get sessions to check if auth is required
            _ = try await APIClient.shared.getSessions()
            // Success - no auth required
            self.connectionManager.isConnected = true
        } catch {
            if case APIError.serverError(401, _) = error {
                // Authentication required
                // Authentication service is already set by saveConnection
                self.showLoginView = true
            } else {
                // Other error
                self.errorMessage = "Failed to connect: \(error.localizedDescription)"
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
            requiresAuth: false)
    }
}
