import Foundation

/// Configuration for connecting to a VibeTunnel server.
///
/// ServerConfig stores all necessary information to establish
/// a connection to a VibeTunnel server, including host, port,
/// optional authentication, and display name.
struct ServerConfig: Codable, Equatable {
    let host: String
    let port: Int
    let name: String?

    init(
        host: String,
        port: Int,
        name: String? = nil
    ) {
        self.host = host
        self.port = port
        self.name = name
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
        let colonCount = formattedHost.filter { $0 == ":" }.count
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
        baseURL.appendingPathComponent(path)
    }

    /// Unique identifier for this server configuration.
    ///
    /// Used for keychain storage and identifying server instances.
    var id: String {
        "\(host):\(port)"
    }
}
