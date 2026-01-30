import Foundation

/// Configuration for connecting to a VibeTunnel server.
///
/// ServerConfig stores all necessary information to establish
/// a connection to a VibeTunnel server, including host, port,
/// optional authentication, display name, and Tailscale configuration.
struct ServerConfig: Codable, Equatable {
    let host: String
    let port: Int
    let name: String?

    // Tailscale properties
    var tailscaleHostname: String?
    var tailscaleIP: String?
    var isTailscaleEnabled: Bool = false
    var preferTailscale: Bool = false

    // Connection type properties
    var httpsAvailable: Bool = false
    var isPublic: Bool = false
    var preferSSL: Bool = true

    init(
        host: String,
        port: Int,
        name: String? = nil,
        tailscaleHostname: String? = nil,
        tailscaleIP: String? = nil,
        isTailscaleEnabled: Bool = false,
        preferTailscale: Bool = false,
        httpsAvailable: Bool = false,
        isPublic: Bool = false,
        preferSSL: Bool = true
    ) {
        self.host = host
        self.port = port
        self.name = name
        self.tailscaleHostname = tailscaleHostname
        self.tailscaleIP = tailscaleIP
        self.isTailscaleEnabled = isTailscaleEnabled
        self.preferTailscale = preferTailscale
        self.httpsAvailable = httpsAvailable
        self.isPublic = isPublic
        self.preferSSL = preferSSL
    }

    /// Constructs the base URL for API requests.
    ///
    /// - Returns: A URL constructed from the host and port.
    ///
    /// The URL uses HTTP protocol. If URL construction fails
    /// (which should not happen with valid host/port), returns
    /// a file URL as fallback to ensure non-nil return.
    var baseURL: URL {
        // Handle IPv6 addresses by wrapping in brackets
        var formattedHost = host

        // First, strip any existing brackets to normalize
        if formattedHost.hasPrefix("[") && formattedHost.hasSuffix("]") {
            formattedHost = String(formattedHost.dropFirst().dropLast())
        }

        // Check if this is an IPv6 address
        // IPv6 addresses must:
        // 1. Contain at least 2 colons
        // 2. Only contain valid IPv6 characters (hex digits, colons, and optionally dots for IPv4-mapped addresses)
        // 3. Not be a hostname with colons (which would contain other characters)
        let colonCount = formattedHost.count { $0 == ":" }
        let validIPv6Chars = CharacterSet(charactersIn: "0123456789abcdefABCDEF:.%")
        let isIPv6 = colonCount >= 2 && formattedHost.unicodeScalars.allSatisfy { validIPv6Chars.contains($0) }

        // Add brackets for IPv6 addresses
        if isIPv6 {
            formattedHost = "[\(formattedHost)]"
        }

        // This should always succeed with valid host and port
        // Fallback ensures we always have a valid URL
        return URL(string: "http://\(formattedHost):\(port)") ?? URL(fileURLWithPath: "/")
    }

    /// User-friendly display name for the server.
    ///
    /// Returns the custom name if set, otherwise formats
    /// the host and port as "host:port".
    var displayName: String {
        name ?? "\(host):\(port)"
    }

    /// Creates a URL for an API endpoint path.
    ///
    /// - Parameter path: The API path (e.g., "/api/sessions")
    /// - Returns: A complete URL for the API endpoint
    func apiURL(path: String) -> URL {
        connectionURL().appendingPathComponent(path)
    }

    /// Unique identifier for this server configuration.
    ///
    /// Used for keychain storage and identifying server instances.
    var id: String {
        "\(host):\(port)"
    }

    /// Connection type available for this server
    enum ConnectionType: String, Codable {
        case local
        case tailscale
        case both
    }

    /// Determines available connection types based on configuration
    var availableConnectionTypes: ConnectionType {
        if isTailscaleEnabled && tailscaleHostname != nil {
            .both
        } else if tailscaleHostname != nil {
            .tailscale
        } else {
            .local
        }
    }

    /// Gets the appropriate URL based on connection preferences and availability
    /// - Parameter useTailscale: Force use of Tailscale connection if available
    /// - Returns: The best URL for connecting to the server
    func connectionURL(useTailscale: Bool? = nil) -> URL {
        let shouldUseTailscale = useTailscale ?? preferTailscale

        if shouldUseTailscale && isTailscaleEnabled {
            // For Tailscale connections with HTTPS available
            if httpsAvailable && preferSSL && tailscaleHostname != nil {
                // Use HTTPS via Tailscale hostname (port 443 is implicit)
                if let tailscaleHostname,
                   let url = URL(string: "https://\(tailscaleHostname)")
                {
                    return url
                }
            }

            // Try regular HTTP Tailscale connection
            if let tailscaleIP {
                // Prefer IP for better compatibility on iOS
                if let url = URL(string: "http://\(tailscaleIP):\(port)") {
                    return url
                }
            } else if let tailscaleHostname {
                if let url = URL(string: "http://\(tailscaleHostname):\(port)") {
                    return url
                }
            }
        }

        // Fall back to regular connection
        return baseURL
    }

    /// Display name with connection type indicator
    var displayNameWithConnectionType: String {
        let baseName = displayName
        var indicators: [String] = []

        // Add connection security indicator
        if httpsAvailable && preferSSL {
            indicators.append("🔒") // HTTPS/SSL connection
        }

        // Add public/private indicator
        if isPublic {
            indicators.append("🌐") // Public (Funnel)
        }

        // Add Tailscale indicator if using Tailscale but not HTTPS
        if isTailscaleEnabled && !(httpsAvailable && preferSSL) {
            indicators.append("🔗") // Tailscale network
        }

        if indicators.isEmpty {
            return baseName
        } else {
            return "\(baseName) \(indicators.joined(separator: " "))"
        }
    }
}
