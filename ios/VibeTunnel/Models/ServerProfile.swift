import Foundation

/// A saved server configuration profile.
/// Stores persistent server connection details with metadata for easy management.
struct ServerProfile: Identifiable, Codable, Equatable {
    let id: UUID
    var name: String
    var url: String
    var requiresAuth: Bool
    var username: String?
    var lastConnected: Date?
    var iconSymbol: String
    var createdAt: Date
    var updatedAt: Date

    init(
        id: UUID = UUID(),
        name: String,
        url: String,
        requiresAuth: Bool = false,
        username: String? = nil,
        lastConnected: Date? = nil,
        iconSymbol: String = "server.rack",
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.name = name
        self.url = url
        self.requiresAuth = requiresAuth
        self.username = username
        self.lastConnected = lastConnected
        self.iconSymbol = iconSymbol
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    /// Create a ServerConfig from this profile
    func toServerConfig(password: String? = nil) -> ServerConfig? {
        guard let urlComponents = URLComponents(string: url),
              let host = urlComponents.host
        else {
            return nil
        }

        // Clean up the host - remove brackets from IPv6 addresses
        // URLComponents includes brackets in the host for IPv6, but we want clean IPs
        var cleanHost = host
        if cleanHost.hasPrefix("[") && cleanHost.hasSuffix("]") {
            cleanHost = String(cleanHost.dropFirst().dropLast())
        }

        // Determine default port based on scheme
        let defaultPort: Int = if let scheme = urlComponents.scheme?.lowercased() {
            scheme == "https" ? 443 : 80
        } else {
            80
        }

        let port = urlComponents.port ?? defaultPort

        return ServerConfig(
            host: cleanHost,
            port: port,
            name: name
        )
    }
}

// MARK: - Storage

extension ServerProfile {
    static let storageKey = "savedServerProfiles"

    /// Load all saved profiles from UserDefaults
    static func loadAll(from userDefaults: UserDefaults = .standard) -> [ServerProfile] {
        guard let data = userDefaults.data(forKey: storageKey),
              let profiles = try? JSONDecoder().decode([ServerProfile].self, from: data)
        else {
            return []
        }
        return profiles
    }

    /// Save profiles to UserDefaults
    static func saveAll(_ profiles: [ServerProfile], to userDefaults: UserDefaults = .standard) {
        if let data = try? JSONEncoder().encode(profiles) {
            userDefaults.set(data, forKey: storageKey)
        }
    }

    /// Add or update a profile
    static func save(_ profile: ServerProfile, to userDefaults: UserDefaults = .standard) {
        var profiles = loadAll(from: userDefaults)
        if let index = profiles.firstIndex(where: { $0.id == profile.id }) {
            profiles[index] = profile
        } else {
            profiles.append(profile)
        }
        saveAll(profiles, to: userDefaults)
    }

    /// Delete a profile
    static func delete(_ profile: ServerProfile, from userDefaults: UserDefaults = .standard) {
        var profiles = loadAll(from: userDefaults)
        profiles.removeAll { $0.id == profile.id }
        saveAll(profiles, to: userDefaults)
    }

    /// Update last connected time
    static func updateLastConnected(for profileId: UUID, in userDefaults: UserDefaults = .standard) {
        var profiles = loadAll(from: userDefaults)
        if let index = profiles.firstIndex(where: { $0.id == profileId }) {
            profiles[index].lastConnected = Date()
            profiles[index].updatedAt = Date()
            saveAll(profiles, to: userDefaults)
        }
    }
}

// MARK: - Common Server Templates

extension ServerProfile {
    static let commonPorts = ["3000", "8080", "8000", "5000", "3001", "4000"]

    static func suggestedName(for url: String) -> String {
        if let urlComponents = URLComponents(string: url),
           let host = urlComponents.host
        {
            // Remove common suffixes
            let cleanHost = host
                .replacingOccurrences(of: ".local", with: "")
                .replacingOccurrences(of: ".com", with: "")
                .replacingOccurrences(of: ".dev", with: "")

            // Capitalize first letter
            return cleanHost.prefix(1).uppercased() + cleanHost.dropFirst()
        }
        return "Server"
    }
}
