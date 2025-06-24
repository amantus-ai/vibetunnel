import Foundation

struct User: Codable, Equatable {
    let username: String
    let avatarUrl: String?
    let createdAt: Date
}

struct AuthResponse: Codable {
    let token: String
    let user: User
}

struct SSHKey: Codable, Identifiable {
    let id: String
    let name: String
    let fingerprint: String
    let type: String
    
    var displayName: String {
        name.isEmpty ? fingerprint : name
    }
}

enum AuthMethod: String, CaseIterable {
    case password = "password"
    case sshKey = "ssh"
    case none = "none"
    
    var displayName: String {
        switch self {
        case .password: return "Password"
        case .sshKey: return "SSH Key"
        case .none: return "No Authentication"
        }
    }
}

struct AuthConfig: Codable {
    let requiresAuth: Bool
    let methods: [String]
    let noAuthForLocalhost: Bool?
}

struct AuthChallenge: Codable {
    let challengeId: String
    let challenge: String
    let expiresAt: TimeInterval
}