import Foundation
import SwiftUI

/// View model for managing server profiles
@MainActor
@Observable
class ServerProfilesViewModel {
    var profiles: [ServerProfile] = []
    var isLoading = false
    var errorMessage: String?

    init() {
        loadProfiles()
    }

    func loadProfiles() {
        profiles = ServerProfile.loadAll().sorted { profile1, profile2 in
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
        ServerProfile.save(profile)

        // Save password to keychain if provided
        if let password, !password.isEmpty {
            try KeychainService.savePassword(password, for: profile.id)
        }

        loadProfiles()
    }

    func updateProfile(_ profile: ServerProfile, password: String? = nil) async throws {
        var updatedProfile = profile
        updatedProfile.updatedAt = Date()
        ServerProfile.save(updatedProfile)

        // Update password if provided
        if let password {
            if password.isEmpty {
                // Delete password if empty
                try KeychainService.deletePassword(for: profile.id)
            } else {
                // Save new password
                try KeychainService.savePassword(password, for: profile.id)
            }
        }

        loadProfiles()
    }

    func deleteProfile(_ profile: ServerProfile) async throws {
        ServerProfile.delete(profile)

        // Delete password from keychain
        try KeychainService.deletePassword(for: profile.id)

        loadProfiles()
    }

    func getPassword(for profile: ServerProfile) -> String? {
        do {
            return try KeychainService.getPassword(for: profile.id)
        } catch {
            // Password not found or error occurred
            return nil
        }
    }

    func connectToProfile(_ profile: ServerProfile, connectionManager: ConnectionManager) async throws {
        isLoading = true
        errorMessage = nil

        defer { isLoading = false }

        // Get password from keychain if needed
        let password = profile.requiresAuth ? getPassword(for: profile) : nil

        // Create server config
        guard let config = profile.toServerConfig(password: password) else {
            throw APIError.invalidURL
        }

        // Save connection - this sets up the AuthenticationService
        connectionManager.saveConnection(config)

        // Check if server requires authentication
        do {
            let authConfig = try await connectionManager.authenticationService?.getAuthConfig()
            
            guard authConfig?.noAuth == true else {
                // Authentication required - connection config is saved, 
                // the UI will handle showing the login view
                // Don't mark as connected yet - that happens after successful authentication
                return
            }
            
            // No auth required, test connection directly
            _ = try await APIClient.shared.getSessions()
            connectionManager.isConnected = true
            
            // Update last connected time
            ServerProfile.updateLastConnected(for: profile.id)
            loadProfiles()
        } catch {
            Task {
                await connectionManager.disconnect()
            }
            throw error
        }
    }

    func testConnection(for profile: ServerProfile) async -> Bool {
        let password = profile.requiresAuth ? getPassword(for: profile) : nil
        guard let config = profile.toServerConfig(password: password) else {
            return false
        }

        // Save the config temporarily to test
        let connectionManager = ConnectionManager()
        connectionManager.saveConnection(config)

        do {
            _ = try await APIClient.shared.getSessions()
            return true
        } catch {
            return false
        }
    }
}

// MARK: - Profile Creation

extension ServerProfilesViewModel {
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
