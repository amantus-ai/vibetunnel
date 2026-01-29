import Foundation

// Shared configuration enums used across the application

// MARK: - Authentication Mode

/// Represents the available authentication modes for dashboard access
enum AuthenticationMode: String, CaseIterable {
    case none
    case osAuth = "os"
    case sshKeys = "ssh"
    case both

    var displayName: String {
        switch self {
        case .none: "None"
        case .osAuth: "macOS"
        case .sshKeys: "SSH Keys"
        case .both: "macOS + SSH Keys"
        }
    }

    var description: String {
        switch self {
        case .none: "Anyone can access the dashboard (not recommended)"
        case .osAuth: "Use your macOS username and password"
        case .sshKeys: "Use SSH keys from ~/.ssh/authorized_keys"
        case .both: "Allow both authentication methods"
        }
    }
}

// MARK: - Title Mode

/// Represents the terminal window title display modes
enum TitleMode: String, CaseIterable {
    case none
    case filter
    case `static`

    var displayName: String {
        switch self {
        case .none: "None"
        case .filter: "Filter"
        case .static: "Static"
        }
    }
}
