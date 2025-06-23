import Foundation

/// A saved server configuration profile
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
              let host = urlComponents.host else {
            return nil
        }
        
        // Determine default port based on scheme
        let defaultPort: Int
        if let scheme = urlComponents.scheme?.lowercased() {
            defaultPort = scheme == "https" ? 443 : 80
        } else {
            defaultPort = 80
        }
        
        let port = urlComponents.port ?? defaultPort
        
        return ServerConfig(
            host: host,
            port: port,
            name: name,
            password: requiresAuth ? password : nil
        )
    }
}

// MARK: - Storage

extension ServerProfile {
    static let storageKey = "savedServerProfiles"

    /// Load all saved profiles from UserDefaults
    static func loadAll() -> [ServerProfile] {
        guard let data = UserDefaults.standard.data(forKey: storageKey),
              let profiles = try? JSONDecoder().decode([ServerProfile].self, from: data) else {
            return []
        }
        return profiles
    }

    /// Save profiles to UserDefaults
    static func saveAll(_ profiles: [ServerProfile]) {
        if let data = try? JSONEncoder().encode(profiles) {
            UserDefaults.standard.set(data, forKey: storageKey)
        }
    }

    /// Add or update a profile
    static func save(_ profile: ServerProfile) {
        var profiles = loadAll()
        if let index = profiles.firstIndex(where: { $0.id == profile.id }) {
            profiles[index] = profile
        } else {
            profiles.append(profile)
        }
        saveAll(profiles)
    }

    /// Delete a profile
    static func delete(_ profile: ServerProfile) {
        var profiles = loadAll()
        profiles.removeAll { $0.id == profile.id }
        saveAll(profiles)
    }

    /// Update last connected time
    static func updateLastConnected(for profileId: UUID) {
        var profiles = loadAll()
        if let index = profiles.firstIndex(where: { $0.id == profileId }) {
            profiles[index].lastConnected = Date()
            profiles[index].updatedAt = Date()
            saveAll(profiles)
        }
    }
}

// MARK: - Common Server Templates

extension ServerProfile {
    static let commonPorts = ["3000", "8080", "8000", "5000", "3001", "4000"]

    static func suggestedName(for url: String) -> String {
        if let urlComponents = URLComponents(string: url),
           let host = urlComponents.host {
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
