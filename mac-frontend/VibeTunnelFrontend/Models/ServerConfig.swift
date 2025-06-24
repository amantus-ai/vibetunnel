import Foundation

struct ServerConfig: Codable, Equatable {
    let url: URL
    let authHeader: String?
    
    init(url: URL, authHeader: String? = nil) {
        self.url = url
        self.authHeader = authHeader
    }
    
    var displayName: String {
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.password = nil // Hide password in display
        return components?.string ?? url.absoluteString
    }
    
    var isSecure: Bool {
        url.scheme == "https" || url.scheme == "wss"
    }
}
