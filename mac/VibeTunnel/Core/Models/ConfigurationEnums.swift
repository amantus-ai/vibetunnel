import Foundation

/// Shared configuration enums used across the application

// MARK: - Authentication Mode

enum AuthenticationMode: String, CaseIterable {
    case none = "none"
    case osAuth = "os"
    case sshKeys = "ssh"
    case both = "both"
    
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

enum TitleMode: String, CaseIterable {
    case none = "none"
    case filter = "filter"
    case `static` = "static"
    case dynamic = "dynamic"
    
    var displayName: String {
        switch self {
        case .none: "None"
        case .filter: "Filter"
        case .static: "Static"
        case .dynamic: "Dynamic"
        }
    }
}