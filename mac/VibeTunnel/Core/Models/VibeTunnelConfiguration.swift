import Foundation

/// Comprehensive configuration structure for VibeTunnel
/// This structure is designed to be compatible with the web UI while providing
/// all necessary configuration options for the Mac app
struct VibeTunnelConfiguration: Codable {
    let version: Int
    var quickStartCommands: [QuickStartCommand]
    var repositoryBasePath: String?
    
    // Extended configuration sections
    var server: ServerConfiguration?
    var development: DevelopmentConfiguration?
    var preferences: PreferencesConfiguration?
    var remoteAccess: RemoteAccessConfiguration?
    var sessionDefaults: SessionDefaultsConfiguration?
    
    /// Initialize with defaults
    init() {
        self.version = 2  // Increment version for extended structure
        self.quickStartCommands = QuickStartCommand.defaults
        self.repositoryBasePath = "~/"
        self.server = ServerConfiguration()
        self.development = DevelopmentConfiguration()
        self.preferences = PreferencesConfiguration()
        self.remoteAccess = RemoteAccessConfiguration()
        self.sessionDefaults = SessionDefaultsConfiguration()
    }
    
    /// Custom decoder to handle backward compatibility
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        
        // Required fields
        self.version = try container.decode(Int.self, forKey: .version)
        self.quickStartCommands = try container.decode([QuickStartCommand].self, forKey: .quickStartCommands)
        
        // Optional fields with defaults
        self.repositoryBasePath = try container.decodeIfPresent(String.self, forKey: .repositoryBasePath) ?? "~/"
        
        // Extended sections (optional for backward compatibility)
        self.server = try container.decodeIfPresent(ServerConfiguration.self, forKey: .server) ?? ServerConfiguration()
        self.development = try container.decodeIfPresent(DevelopmentConfiguration.self, forKey: .development) ?? DevelopmentConfiguration()
        self.preferences = try container.decodeIfPresent(PreferencesConfiguration.self, forKey: .preferences) ?? PreferencesConfiguration()
        self.remoteAccess = try container.decodeIfPresent(RemoteAccessConfiguration.self, forKey: .remoteAccess) ?? RemoteAccessConfiguration()
        self.sessionDefaults = try container.decodeIfPresent(SessionDefaultsConfiguration.self, forKey: .sessionDefaults) ?? SessionDefaultsConfiguration()
    }
}

// MARK: - Quick Start Command

struct QuickStartCommand: Identifiable, Codable, Equatable {
    var id: String
    var name: String?
    var command: String
    
    /// Display name for the UI - uses name if available, otherwise command
    var displayName: String {
        name ?? command
    }
    
    init(id: String = UUID().uuidString, name: String? = nil, command: String) {
        self.id = id
        self.name = name
        self.command = command
    }
    
    /// Custom Codable implementation to handle missing id
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try container.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        self.name = try container.decodeIfPresent(String.self, forKey: .name)
        self.command = try container.decode(String.self, forKey: .command)
    }
    
    private enum CodingKeys: String, CodingKey {
        case id
        case name
        case command
    }
    
    /// Default commands matching web/src/types/config.ts
    static let defaults = [
        QuickStartCommand(name: "✨ claude", command: "claude"),
        QuickStartCommand(name: "✨ gemini", command: "gemini"),
        QuickStartCommand(name: nil, command: "zsh"),
        QuickStartCommand(name: nil, command: "python3"),
        QuickStartCommand(name: nil, command: "node"),
        QuickStartCommand(name: "▶️ pnpm run dev", command: "pnpm run dev")
    ]
}

// MARK: - Server Configuration

struct ServerConfiguration: Codable, Equatable {
    var port: Int
    var dashboardAccessMode: String
    var cleanupOnStartup: Bool
    var authenticationMode: String
    
    init() {
        self.port = 4020
        self.dashboardAccessMode = "network"
        self.cleanupOnStartup = true
        self.authenticationMode = "os"
    }
}

// MARK: - Development Configuration

struct DevelopmentConfiguration: Codable, Equatable {
    var debugMode: Bool
    var useDevServer: Bool
    var devServerPath: String
    var logLevel: String
    
    init() {
        self.debugMode = false
        self.useDevServer = false
        self.devServerPath = ""
        self.logLevel = "info"
    }
}

// MARK: - Preferences Configuration

struct PreferencesConfiguration: Codable, Equatable {
    var preferredGitApp: String?
    var preferredTerminal: String?
    var updateChannel: String
    var showInDock: Bool
    var preventSleepWhenRunning: Bool
    
    init() {
        self.preferredGitApp = nil
        self.preferredTerminal = nil
        self.updateChannel = "stable"
        self.showInDock = false
        self.preventSleepWhenRunning = true
    }
}

// MARK: - Remote Access Configuration

struct RemoteAccessConfiguration: Codable, Equatable {
    var ngrokEnabled: Bool
    var ngrokTokenPresent: Bool
    
    init() {
        self.ngrokEnabled = false
        self.ngrokTokenPresent = false
    }
}

// MARK: - Session Defaults Configuration

struct SessionDefaultsConfiguration: Codable, Equatable {
    var command: String
    var workingDirectory: String
    var spawnWindow: Bool
    var titleMode: String
    
    init() {
        self.command = "zsh"
        self.workingDirectory = "~/"
        self.spawnWindow = true
        self.titleMode = "dynamic"
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

// MARK: - Dashboard Access Mode

enum DashboardAccessMode: String, CaseIterable {
    case localhost = "localhost"
    case network = "network"
    
    var displayName: String {
        switch self {
        case .localhost: "Localhost Only"
        case .network: "Network Access"
        }
    }
}

// MARK: - Authentication Mode

enum AuthenticationMode: String, CaseIterable {
    case none = "none"
    case os = "os"
    case ssh = "ssh"
    case both = "both"
    
    var displayName: String {
        switch self {
        case .none: "No Authentication"
        case .os: "OS Authentication"
        case .ssh: "SSH Keys Only"
        case .both: "OS + SSH Keys"
        }
    }
}

// MARK: - Update Channel

enum UpdateChannel: String, CaseIterable {
    case stable = "stable"
    case beta = "beta"
    case nightly = "nightly"
    
    var displayName: String {
        switch self {
        case .stable: "Stable"
        case .beta: "Beta"
        case .nightly: "Nightly"
        }
    }
}