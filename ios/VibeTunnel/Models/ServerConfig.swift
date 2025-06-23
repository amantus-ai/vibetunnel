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
    let password: String?

    init(
        host: String,
        port: Int,
        name: String? = nil,
        password: String? = nil
    ) {
        self.host = host
        self.port = port
        self.name = name
        self.password = password
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
        let formattedHost = host.contains(":") && !host.hasPrefix("[") ? "[\(host)]" : host
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

    /// Indicates whether the server requires authentication.
    ///
    /// - Returns: true if a password is configured, false otherwise.
    var requiresAuthentication: Bool {
        if let password {
            return !password.isEmpty
        }
        return false
    }

    /// Generates the Authorization header value if a password is configured.
    ///
    /// - Returns: A Basic auth header string using "admin" as username,
    ///   or nil if no password is configured.
    var authorizationHeader: String? {
        guard let password, !password.isEmpty else { return nil }
        let credentials = "admin:\(password)"
        guard let data = credentials.data(using: .utf8) else { return nil }
        let base64 = data.base64EncodedString()
        return "Basic \(base64)"
    }
}
