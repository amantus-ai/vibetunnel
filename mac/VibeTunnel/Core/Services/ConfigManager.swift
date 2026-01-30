import Foundation
import Observation
import OSLog

/// Manager for VibeTunnel configuration stored in ~/.vibetunnel/config.json
/// Provides centralized configuration management for all app settings
@MainActor
@Observable
final class ConfigManager {
    static let shared = ConfigManager()

    private let logger = Logger(subsystem: BundleIdentifiers.loggerSubsystem, category: "ConfigManager")
    private let configDir: URL
    private let configPath: URL
    private var fileMonitor: DispatchSourceFileSystemObject?

    // Core configuration
    private(set) var quickStartCommands: [QuickStartCommand] = []
    var repositoryBasePath: String = FilePathConstants.defaultRepositoryBasePath

    // Server settings
    var serverPort: Int = 4020
    var dashboardAccessMode: DashboardAccessMode = .network
    var cleanupOnStartup: Bool = true
    var authenticationMode: AuthenticationMode = .osAuth

    // Development settings
    var debugMode: Bool = false
    var useDevServer: Bool = false
    var devServerPath: String = ""
    var logLevel: String = "info"

    // Application preferences
    var preferredGitApp: String?
    var preferredTerminal: String?
    var updateChannel: UpdateChannel = .stable
    var showInDock: Bool = false
    var preventSleepWhenRunning: Bool = true

    // Notification preferences
    var notificationsEnabled: Bool = true
    var notificationSessionStart: Bool = true
    var notificationSessionExit: Bool = true
    var notificationCommandCompletion: Bool = true
    var notificationCommandError: Bool = true
    var notificationBell: Bool = true
    var notificationSoundEnabled: Bool = true
    var notificationVibrationEnabled: Bool = true
    var showInNotificationCenter: Bool = true

    // Remote access
    var ngrokEnabled: Bool = false
    var ngrokTokenPresent: Bool = false

    // Session defaults
    var sessionCommand: String = "zsh"
    var sessionWorkingDirectory: String = FilePathConstants.defaultRepositoryBasePath
    var sessionSpawnWindow: Bool = true
    var sessionTitleMode: TitleMode = .static

    /// Comprehensive configuration structure
    private struct VibeTunnelConfig: Codable {
        let version: Int
        var quickStartCommands: [QuickStartCommand]
        var repositoryBasePath: String?

        // Extended configuration sections
        var server: ServerConfig?
        var development: DevelopmentConfig?
        var preferences: PreferencesConfig?
        var remoteAccess: RemoteAccessConfig?
        var sessionDefaults: SessionDefaultsConfig?
    }

    // MARK: - Configuration Sub-structures

    private struct ServerConfig: Codable {
        var port: Int
        var dashboardAccessMode: String
        var cleanupOnStartup: Bool
        var authenticationMode: String
    }

    private struct DevelopmentConfig: Codable {
        var debugMode: Bool
        var useDevServer: Bool
        var devServerPath: String
        var logLevel: String
    }

    private struct PreferencesConfig: Codable {
        var preferredGitApp: String?
        var preferredTerminal: String?
        var updateChannel: String
        var showInDock: Bool
        var preventSleepWhenRunning: Bool
        var notifications: NotificationConfig?
    }

    private struct NotificationConfig: Codable {
        var enabled: Bool
        var sessionStart: Bool
        var sessionExit: Bool
        var commandCompletion: Bool
        var commandError: Bool
        var bell: Bool
        var soundEnabled: Bool
        var vibrationEnabled: Bool
        var showInNotificationCenter: Bool?
    }

    private struct RemoteAccessConfig: Codable {
        var ngrokEnabled: Bool
        var ngrokTokenPresent: Bool
    }

    private struct SessionDefaultsConfig: Codable {
        var command: String
        var workingDirectory: String
        var spawnWindow: Bool
        var titleMode: String
    }

    /// Default commands matching web/src/types/config.ts
    private let defaultCommands = [
        QuickStartCommand(name: "✨ codex", command: "codex"),
        QuickStartCommand(name: "✨ claude", command: "claude"),
        QuickStartCommand(name: nil, command: "gemini3"),
        QuickStartCommand(name: nil, command: "opencode 4"),
        QuickStartCommand(name: nil, command: "zsh"),
        QuickStartCommand(name: nil, command: "node"),
    ]

    private init() {
        let homeDir = FileManager.default.homeDirectoryForCurrentUser
        self.configDir = homeDir.appendingPathComponent(".vibetunnel")
        self.configPath = self.configDir.appendingPathComponent("config.json")

        // Load initial configuration
        self.loadConfiguration()

        // Start monitoring for changes
        self.startFileMonitoring()
    }

    // MARK: - Configuration Loading

    private func loadConfiguration() {
        // Ensure directory exists
        try? FileManager.default.createDirectory(at: self.configDir, withIntermediateDirectories: true)

        if FileManager.default.fileExists(atPath: self.configPath.path) {
            do {
                let data = try Data(contentsOf: configPath)
                let config = try JSONDecoder().decode(VibeTunnelConfig.self, from: data)

                // Load all configuration values
                self.quickStartCommands = config.quickStartCommands
                self.repositoryBasePath = config.repositoryBasePath ?? FilePathConstants.defaultRepositoryBasePath

                // Server settings
                if let server = config.server {
                    self.serverPort = server.port
                    self.dashboardAccessMode = DashboardAccessMode(rawValue: server.dashboardAccessMode) ?? .network
                    self.cleanupOnStartup = server.cleanupOnStartup
                    self.authenticationMode = AuthenticationMode(rawValue: server.authenticationMode) ?? .osAuth
                }

                // Development settings
                if let dev = config.development {
                    self.debugMode = dev.debugMode
                    self.useDevServer = dev.useDevServer
                    self.devServerPath = dev.devServerPath
                    self.logLevel = dev.logLevel
                }

                // Preferences
                if let prefs = config.preferences {
                    self.preferredGitApp = prefs.preferredGitApp
                    self.preferredTerminal = prefs.preferredTerminal
                    self.updateChannel = UpdateChannel(rawValue: prefs.updateChannel) ?? .stable
                    self.showInDock = prefs.showInDock
                    self.preventSleepWhenRunning = prefs.preventSleepWhenRunning

                    // Notification preferences
                    if let notif = prefs.notifications {
                        self.notificationsEnabled = notif.enabled
                        self.notificationSessionStart = notif.sessionStart
                        self.notificationSessionExit = notif.sessionExit
                        self.notificationCommandCompletion = notif.commandCompletion
                        self.notificationCommandError = notif.commandError
                        self.notificationBell = notif.bell
                        self.notificationSoundEnabled = notif.soundEnabled
                        self.notificationVibrationEnabled = notif.vibrationEnabled
                        if let showInCenter = notif.showInNotificationCenter {
                            self.showInNotificationCenter = showInCenter
                        }
                    }
                }

                // Remote access
                if let remote = config.remoteAccess {
                    self.ngrokEnabled = remote.ngrokEnabled
                    self.ngrokTokenPresent = remote.ngrokTokenPresent
                }

                // Session defaults
                if let session = config.sessionDefaults {
                    self.sessionCommand = session.command
                    self.sessionWorkingDirectory = session.workingDirectory
                    self.sessionSpawnWindow = session.spawnWindow
                    self.sessionTitleMode = TitleMode(rawValue: session.titleMode) ?? .static
                }

                self.logger.info("Loaded configuration from disk")
            } catch {
                self.logger.error("Failed to load config: \(error.localizedDescription)")
                self.useDefaults()
            }
        } else {
            self.logger.info("No config file found, creating with defaults")
            self.useDefaults()
        }
    }

    private func useDefaults() {
        self.quickStartCommands = self.defaultCommands
        self.repositoryBasePath = FilePathConstants.defaultRepositoryBasePath

        // Set notification defaults to match TypeScript defaults
        // Master switch is OFF by default, but individual preferences are set to true
        self.notificationsEnabled = false // Changed from true to match web defaults
        self.notificationSessionStart = true
        self.notificationSessionExit = true
        self.notificationCommandCompletion = true
        self.notificationCommandError = true
        self.notificationBell = true
        self.notificationSoundEnabled = true
        self.notificationVibrationEnabled = true
        self.showInNotificationCenter = true

        self.saveConfiguration()
    }

    // MARK: - Configuration Saving

    private func saveConfiguration() {
        var config = VibeTunnelConfig(
            version: 2,
            quickStartCommands: quickStartCommands,
            repositoryBasePath: repositoryBasePath)

        // Server configuration
        config.server = ServerConfig(
            port: self.serverPort,
            dashboardAccessMode: self.dashboardAccessMode.rawValue,
            cleanupOnStartup: self.cleanupOnStartup,
            authenticationMode: self.authenticationMode.rawValue)

        // Development configuration
        config.development = DevelopmentConfig(
            debugMode: self.debugMode,
            useDevServer: self.useDevServer,
            devServerPath: self.devServerPath,
            logLevel: self.logLevel)

        // Preferences
        config.preferences = PreferencesConfig(
            preferredGitApp: self.preferredGitApp,
            preferredTerminal: self.preferredTerminal,
            updateChannel: self.updateChannel.rawValue,
            showInDock: self.showInDock,
            preventSleepWhenRunning: self.preventSleepWhenRunning,
            notifications: NotificationConfig(
                enabled: self.notificationsEnabled,
                sessionStart: self.notificationSessionStart,
                sessionExit: self.notificationSessionExit,
                commandCompletion: self.notificationCommandCompletion,
                commandError: self.notificationCommandError,
                bell: self.notificationBell,
                soundEnabled: self.notificationSoundEnabled,
                vibrationEnabled: self.notificationVibrationEnabled,
                showInNotificationCenter: self.showInNotificationCenter))

        // Remote access
        config.remoteAccess = RemoteAccessConfig(
            ngrokEnabled: self.ngrokEnabled,
            ngrokTokenPresent: self.ngrokTokenPresent)

        // Session defaults
        config.sessionDefaults = SessionDefaultsConfig(
            command: self.sessionCommand,
            workingDirectory: self.sessionWorkingDirectory,
            spawnWindow: self.sessionSpawnWindow,
            titleMode: self.sessionTitleMode.rawValue)

        do {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            let data = try encoder.encode(config)

            // Ensure directory exists
            try FileManager.default.createDirectory(at: self.configDir, withIntermediateDirectories: true)

            // Write atomically to prevent corruption
            try data.write(to: self.configPath, options: .atomic)
            self.logger.info("Saved configuration to disk")
        } catch {
            self.logger.error("Failed to save config: \(error.localizedDescription)")
        }
    }

    // MARK: - File Monitoring

    private func startFileMonitoring() {
        // Stop any existing monitor
        self.stopFileMonitoring()

        // Create file descriptor
        let fileDescriptor = open(configPath.path, O_EVTONLY)
        guard fileDescriptor != -1 else {
            self.logger.warning("Could not open config file for monitoring")
            return
        }

        // Create dispatch source on main queue since ConfigManager is @MainActor
        let source = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: fileDescriptor,
            eventMask: [.write, .delete, .rename],
            queue: .main)

        source.setEventHandler { [weak self] in
            guard let self else { return }

            // Debounce rapid changes
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
                guard let self else { return }

                self.logger.info("Configuration file changed, reloading...")
                let oldCommands = self.quickStartCommands
                self.loadConfiguration()

                // Only log if commands actually changed
                if oldCommands != self.quickStartCommands {
                    self.logger.info("Quick start commands updated")
                }
            }
        }

        source.setCancelHandler {
            close(fileDescriptor)
        }

        source.resume()
        self.fileMonitor = source

        self.logger.info("Started monitoring configuration file")
    }

    private func stopFileMonitoring() {
        self.fileMonitor?.cancel()
        self.fileMonitor = nil
    }

    // MARK: - Public API

    /// Update quick start commands
    func updateQuickStartCommands(_ commands: [QuickStartCommand]) {
        guard commands != self.quickStartCommands else { return }

        self.quickStartCommands = commands
        self.saveConfiguration()
        self.logger.info("Updated quick start commands: \(commands.count) items")
    }

    /// Reset to default commands
    func resetToDefaults() {
        self.updateQuickStartCommands(self.defaultCommands)
        self.logger.info("Reset quick start commands to defaults")
    }

    /// Add a new command
    func addCommand(name: String?, command: String) {
        var commands = self.quickStartCommands
        commands.append(QuickStartCommand(name: name, command: command))
        self.updateQuickStartCommands(commands)
    }

    /// Update an existing command
    func updateCommand(id: String, name: String?, command: String) {
        var commands = self.quickStartCommands
        if let index = commands.firstIndex(where: { $0.id == id }) {
            commands[index].name = name
            commands[index].command = command
            self.updateQuickStartCommands(commands)
        }
    }

    /// Delete a command
    func deleteCommand(id: String) {
        var commands = self.quickStartCommands
        commands.removeAll { $0.id == id }
        self.updateQuickStartCommands(commands)
    }

    /// Delete all commands (clear the list)
    func deleteAllCommands() {
        self.updateQuickStartCommands([])
        self.logger.info("Deleted all quick start commands")
    }

    /// Move commands for drag and drop reordering
    func moveCommands(from source: IndexSet, to destination: Int) {
        var commands = self.quickStartCommands
        commands.move(fromOffsets: source, toOffset: destination)
        self.updateQuickStartCommands(commands)
        self.logger.info("Reordered quick start commands")
    }

    /// Update repository base path
    func updateRepositoryBasePath(_ path: String) {
        guard path != self.repositoryBasePath else { return }

        self.repositoryBasePath = path
        self.saveConfiguration()
        self.logger.info("Updated repository base path to: \(path)")
    }

    /// Update notification preferences
    func updateNotificationPreferences(
        enabled: Bool? = nil,
        sessionStart: Bool? = nil,
        sessionExit: Bool? = nil,
        commandCompletion: Bool? = nil,
        commandError: Bool? = nil,
        bell: Bool? = nil,
        soundEnabled: Bool? = nil,
        vibrationEnabled: Bool? = nil)
    {
        // Update only the provided values
        if let enabled { self.notificationsEnabled = enabled }
        if let sessionStart { self.notificationSessionStart = sessionStart }
        if let sessionExit { self.notificationSessionExit = sessionExit }
        if let commandCompletion { self.notificationCommandCompletion = commandCompletion }
        if let commandError { self.notificationCommandError = commandError }
        if let bell { self.notificationBell = bell }
        if let soundEnabled { self.notificationSoundEnabled = soundEnabled }
        if let vibrationEnabled { self.notificationVibrationEnabled = vibrationEnabled }

        self.saveConfiguration()
        self.logger.info("Updated notification preferences")
    }

    /// Get the configuration file path for debugging
    var configurationPath: String {
        self.configPath.path
    }

    deinit {
        // File monitoring will be cleaned up automatically
    }
}
