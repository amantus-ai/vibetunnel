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

    // Tailscale properties
    var host: String?
    var port: Int?
    var tailscaleHostname: String?
    var tailscaleIP: String?
    var isTailscaleEnabled: Bool
    var preferTailscale: Bool

    // Connection type properties
    var httpsAvailable: Bool
    var isPublic: Bool
    var preferSSL: Bool

    init(
        id: UUID = UUID(),
        name: String,
        url: String? = nil,
        host: String? = nil,
        port: Int? = nil,
        requiresAuth: Bool = false,
        username: String? = nil,
        lastConnected: Date? = nil,
        iconSymbol: String = "server.rack",
        createdAt: Date = Date(),
        updatedAt: Date = Date(),
        tailscaleHostname: String? = nil,
        tailscaleIP: String? = nil,
        isTailscaleEnabled: Bool = false,
        preferTailscale: Bool = false,
        httpsAvailable: Bool = false,
        isPublic: Bool = false,
        preferSSL: Bool = true)
    {
        self.id = id
        self.name = name

        // If url is provided, use it; otherwise construct from host and port
        if let url {
            self.url = url
            // Extract host and port from URL if not provided
            if host == nil || port == nil {
                if let urlComponents = URLComponents(string: url) {
                    self.host = host ?? urlComponents.host
                    self.port = port ?? (urlComponents.port ?? 4020)
                } else {
                    self.host = host
                    self.port = port ?? 4020
                }
            } else {
                self.host = host
                self.port = port
            }
        } else if let host {
            let port = port ?? 4020
            self.host = host
            self.port = port
            self.url = "http://\(host):\(port)"
        } else {
            // Fallback to localhost
            self.url = "http://localhost:4020"
            self.host = "localhost"
            self.port = 4020
        }

        self.requiresAuth = requiresAuth
        self.username = username
        self.lastConnected = lastConnected
        self.iconSymbol = iconSymbol
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.tailscaleHostname = tailscaleHostname
        self.tailscaleIP = tailscaleIP
        self.isTailscaleEnabled = isTailscaleEnabled
        self.preferTailscale = preferTailscale
        self.httpsAvailable = httpsAvailable
        self.isPublic = isPublic
        self.preferSSL = preferSSL
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
        if cleanHost.hasPrefix("["), cleanHost.hasSuffix("]") {
            cleanHost = String(cleanHost.dropFirst().dropLast())
        }

        // Use the stored port (set during profile creation/discovery) which reflects
        // the actual VibeTunnel server port (typically 4020). Fall back to explicit URL
        // port, then 4020. Do NOT derive from URL scheme — an HTTPS URL like
        // https://hostname.ts.net uses Tailscale Serve on 443 but the underlying
        // server port is still 4020.
        let port = self.port ?? urlComponents.port ?? 4020

        return ServerConfig(
            host: cleanHost,
            port: port,
            name: self.name,
            tailscaleHostname: self.tailscaleHostname,
            tailscaleIP: self.tailscaleIP,
            isTailscaleEnabled: self.isTailscaleEnabled,
            preferTailscale: self.preferTailscale,
            httpsAvailable: self.httpsAvailable,
            isPublic: self.isPublic,
            preferSSL: self.preferSSL)
    }
}

// MARK: - Storage

extension ServerProfile {
    static let storageKey = "savedServerProfiles"

    /// Load all saved profiles from UserDefaults
    static func loadAll(from userDefaults: UserDefaults = .standard) -> [ServerProfile] {
        guard let data = userDefaults.data(forKey: storageKey),
              var profiles = try? JSONDecoder().decode([ServerProfile].self, from: data)
        else {
            return []
        }

        // Migration: fix Tailscale profiles that have port 443 or 80 from old URL-scheme
        // derivation bug. The actual VibeTunnel server port is always 4020.
        var needsSave = false
        for i in profiles.indices where profiles[i].isTailscaleEnabled {
            if profiles[i].port == 443 || profiles[i].port == 80 || profiles[i].port == nil {
                profiles[i].port = 4020
                needsSave = true
            }
        }
        if needsSave {
            self.saveAll(profiles, to: userDefaults)
        }

        return profiles
    }

    /// Save profiles to UserDefaults
    static func saveAll(_ profiles: [ServerProfile], to userDefaults: UserDefaults = .standard) {
        if let data = try? JSONEncoder().encode(profiles) {
            userDefaults.set(data, forKey: self.storageKey)
        }
    }

    /// Add or update a profile
    static func save(_ profile: ServerProfile, to userDefaults: UserDefaults = .standard) {
        var profiles = self.loadAll(from: userDefaults)
        if let index = profiles.firstIndex(where: { $0.id == profile.id }) {
            profiles[index] = profile
        } else {
            profiles.append(profile)
        }
        self.saveAll(profiles, to: userDefaults)
    }

    /// Delete a profile
    static func delete(_ profile: ServerProfile, from userDefaults: UserDefaults = .standard) {
        var profiles = self.loadAll(from: userDefaults)
        profiles.removeAll { $0.id == profile.id }
        self.saveAll(profiles, to: userDefaults)
    }

    /// Update last connected time
    static func updateLastConnected(for profileId: UUID, in userDefaults: UserDefaults = .standard) {
        var profiles = self.loadAll(from: userDefaults)
        if let index = profiles.firstIndex(where: { $0.id == profileId }) {
            profiles[index].lastConnected = Date()
            profiles[index].updatedAt = Date()
            self.saveAll(profiles, to: userDefaults)
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
