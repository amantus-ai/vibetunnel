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
    var serverPort: Int = 4_020
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
    var notificationClaudeTurn: Bool = false
    var notificationSoundEnabled: Bool = true
    var notificationVibrationEnabled: Bool = true

    // Remote access
    var ngrokEnabled: Bool = false
    var ngrokTokenPresent: Bool = false

    // Session defaults
    var sessionCommand: String = "zsh"
    var sessionWorkingDirectory: String = FilePathConstants.defaultRepositoryBasePath
    var sessionSpawnWindow: Bool = true
    var sessionTitleMode: TitleMode = .dynamic

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
        var claudeTurn: Bool
        var soundEnabled: Bool
        var vibrationEnabled: Bool
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
        QuickStartCommand(name: "✨ claude", command: "claude --dangerously-skip-permissions"),
        QuickStartCommand(name: "✨ gemini", command: "gemini"),
        QuickStartCommand(name: nil, command: "zsh"),
        QuickStartCommand(name: nil, command: "python3"),
        QuickStartCommand(name: nil, command: "node"),
        QuickStartCommand(name: "▶️ pnpm run dev", command: "pnpm run dev")
    ]

    private init() {
        let homeDir = FileManager.default.homeDirectoryForCurrentUser
        self.configDir = homeDir.appendingPathComponent(".vibetunnel")
        self.configPath = configDir.appendingPathComponent("config.json")

        // Load initial configuration
        loadConfiguration()

        // Start monitoring for changes
        startFileMonitoring()
    }

    // MARK: - Configuration Loading

    private func loadConfiguration() {
        // Ensure directory exists
        try? FileManager.default.createDirectory(at: configDir, withIntermediateDirectories: true)

        if FileManager.default.fileExists(atPath: configPath.path) {
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
                        self.notificationClaudeTurn = notif.claudeTurn
                        self.notificationSoundEnabled = notif.soundEnabled
                        self.notificationVibrationEnabled = notif.vibrationEnabled
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
                    self.sessionTitleMode = TitleMode(rawValue: session.titleMode) ?? .dynamic
                }

                logger.info("Loaded configuration from disk")
            } catch {
                logger.error("Failed to load config: \(error.localizedDescription)")
                useDefaults()
            }
        } else {
            logger.info("No config file found, creating with defaults")
            useDefaults()
        }
    }

    private func useDefaults() {
        self.quickStartCommands = defaultCommands
        self.repositoryBasePath = FilePathConstants.defaultRepositoryBasePath

        // Set notification defaults to match TypeScript defaults
        self.notificationsEnabled = true
        self.notificationSessionStart = true
        self.notificationSessionExit = true
        self.notificationCommandCompletion = true
        self.notificationCommandError = true
        self.notificationBell = true
        self.notificationClaudeTurn = false
        self.notificationSoundEnabled = true
        self.notificationVibrationEnabled = true

        saveConfiguration()
    }

    // MARK: - Configuration Saving

    private func saveConfiguration() {
        var config = VibeTunnelConfig(
            version: 2,
            quickStartCommands: quickStartCommands,
            repositoryBasePath: repositoryBasePath
        )

        // Server configuration
        config.server = ServerConfig(
            port: serverPort,
            dashboardAccessMode: dashboardAccessMode.rawValue,
            cleanupOnStartup: cleanupOnStartup,
            authenticationMode: authenticationMode.rawValue
        )

        // Development configuration
        config.development = DevelopmentConfig(
            debugMode: debugMode,
            useDevServer: useDevServer,
            devServerPath: devServerPath,
            logLevel: logLevel
        )

        // Preferences
        config.preferences = PreferencesConfig(
            preferredGitApp: preferredGitApp,
            preferredTerminal: preferredTerminal,
            updateChannel: updateChannel.rawValue,
            showInDock: showInDock,
            preventSleepWhenRunning: preventSleepWhenRunning,
            notifications: NotificationConfig(
                enabled: notificationsEnabled,
                sessionStart: notificationSessionStart,
                sessionExit: notificationSessionExit,
                commandCompletion: notificationCommandCompletion,
                commandError: notificationCommandError,
                bell: notificationBell,
                claudeTurn: notificationClaudeTurn,
                soundEnabled: notificationSoundEnabled,
                vibrationEnabled: notificationVibrationEnabled
            )
        )

        // Remote access
        config.remoteAccess = RemoteAccessConfig(
            ngrokEnabled: ngrokEnabled,
            ngrokTokenPresent: ngrokTokenPresent
        )

        // Session defaults
        config.sessionDefaults = SessionDefaultsConfig(
            command: sessionCommand,
            workingDirectory: sessionWorkingDirectory,
            spawnWindow: sessionSpawnWindow,
            titleMode: sessionTitleMode.rawValue
        )

        do {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            let data = try encoder.encode(config)

            // Ensure directory exists
            try FileManager.default.createDirectory(at: configDir, withIntermediateDirectories: true)

            // Write atomically to prevent corruption
            try data.write(to: configPath, options: .atomic)
            logger.info("Saved configuration to disk")
        } catch {
            logger.error("Failed to save config: \(error.localizedDescription)")
        }
    }

    // MARK: - File Monitoring

    private func startFileMonitoring() {
        // Stop any existing monitor
        stopFileMonitoring()

        // Create file descriptor
        let fileDescriptor = open(configPath.path, O_EVTONLY)
        guard fileDescriptor != -1 else {
            logger.warning("Could not open config file for monitoring")
            return
        }

        // Create dispatch source on main queue since ConfigManager is @MainActor
        let source = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: fileDescriptor,
            eventMask: [.write, .delete, .rename],
            queue: .main
        )

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

        logger.info("Started monitoring configuration file")
    }

    private func stopFileMonitoring() {
        fileMonitor?.cancel()
        fileMonitor = nil
    }

    // MARK: - Public API

    /// Update quick start commands
    func updateQuickStartCommands(_ commands: [QuickStartCommand]) {
        guard commands != quickStartCommands else { return }

        self.quickStartCommands = commands
        saveConfiguration()
        logger.info("Updated quick start commands: \(commands.count) items")
    }

    /// Reset to default commands
    func resetToDefaults() {
        updateQuickStartCommands(defaultCommands)
        logger.info("Reset quick start commands to defaults")
    }

    /// Add a new command
    func addCommand(name: String?, command: String) {
        var commands = quickStartCommands
        commands.append(QuickStartCommand(name: name, command: command))
        updateQuickStartCommands(commands)
    }

    /// Update an existing command
    func updateCommand(id: String, name: String?, command: String) {
        var commands = quickStartCommands
        if let index = commands.firstIndex(where: { $0.id == id }) {
            commands[index].name = name
            commands[index].command = command
            updateQuickStartCommands(commands)
        }
    }

    /// Delete a command
    func deleteCommand(id: String) {
        var commands = quickStartCommands
        commands.removeAll { $0.id == id }
        updateQuickStartCommands(commands)
    }

    /// Delete all commands (clear the list)
    func deleteAllCommands() {
        updateQuickStartCommands([])
        logger.info("Deleted all quick start commands")
    }

    /// Move commands for drag and drop reordering
    func moveCommands(from source: IndexSet, to destination: Int) {
        var commands = quickStartCommands
        commands.move(fromOffsets: source, toOffset: destination)
        updateQuickStartCommands(commands)
        logger.info("Reordered quick start commands")
    }

    /// Update repository base path
    func updateRepositoryBasePath(_ path: String) {
        guard path != repositoryBasePath else { return }

        self.repositoryBasePath = path
        saveConfiguration()
        logger.info("Updated repository base path to: \(path)")
    }

    /// Update notification preferences
    func updateNotificationPreferences(
        enabled: Bool? = nil,
        sessionStart: Bool? = nil,
        sessionExit: Bool? = nil,
        commandCompletion: Bool? = nil,
        commandError: Bool? = nil,
        bell: Bool? = nil,
        claudeTurn: Bool? = nil,
        soundEnabled: Bool? = nil,
        vibrationEnabled: Bool? = nil
    ) {
        // Update only the provided values
        if let enabled { self.notificationsEnabled = enabled }
        if let sessionStart { self.notificationSessionStart = sessionStart }
        if let sessionExit { self.notificationSessionExit = sessionExit }
        if let commandCompletion { self.notificationCommandCompletion = commandCompletion }
        if let commandError { self.notificationCommandError = commandError }
        if let bell { self.notificationBell = bell }
        if let claudeTurn { self.notificationClaudeTurn = claudeTurn }
        if let soundEnabled { self.notificationSoundEnabled = soundEnabled }
        if let vibrationEnabled { self.notificationVibrationEnabled = vibrationEnabled }

        saveConfiguration()
        logger.info("Updated notification preferences")
    }

    /// Get the configuration file path for debugging
    var configurationPath: String {
        configPath.path
    }

    deinit {
        // File monitoring will be cleaned up automatically
    }
}
