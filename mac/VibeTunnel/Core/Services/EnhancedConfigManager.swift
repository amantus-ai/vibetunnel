import Combine
import Foundation
import OSLog

/// Enhanced configuration manager that provides a comprehensive configuration system
/// This manager extends the basic ConfigManager to support all app settings while
/// maintaining backward compatibility with the existing config.json format
@MainActor
class EnhancedConfigManager: ObservableObject {
    static let shared = EnhancedConfigManager()
    
    private let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "EnhancedConfigManager")
    private let configDir: URL
    private let configPath: URL
    private var fileMonitor: DispatchSourceFileSystemObject?
    
    // MARK: - Published Configuration
    
    @Published private(set) var configuration: VibeTunnelConfiguration
    
    // Convenience publishers for commonly accessed values
    @Published var quickStartCommands: [QuickStartCommand] = []
    @Published var repositoryBasePath: String = "~/"
    
    // Server settings
    @Published var serverPort: Int = 4020
    @Published var dashboardAccessMode: String = "network"
    @Published var cleanupOnStartup: Bool = true
    @Published var authenticationMode: String = "os"
    
    // Development settings
    @Published var debugMode: Bool = false
    @Published var useDevServer: Bool = false
    @Published var devServerPath: String = ""
    @Published var logLevel: String = "info"
    
    // Preferences
    @Published var preferredGitApp: String?
    @Published var preferredTerminal: String?
    @Published var updateChannel: String = "stable"
    @Published var showInDock: Bool = false
    @Published var preventSleepWhenRunning: Bool = true
    
    // Remote access
    @Published var ngrokEnabled: Bool = false
    @Published var ngrokTokenPresent: Bool = false
    
    // Session defaults
    @Published var sessionCommand: String = "zsh"
    @Published var sessionWorkingDirectory: String = "~/"
    @Published var sessionSpawnWindow: Bool = true
    @Published var sessionTitleMode: String = "dynamic"
    
    // MARK: - Migration support
    
    /// Track which settings have been migrated from UserDefaults
    private var migratedSettings = Set<String>()
    
    private init() {
        let homeDir = FileManager.default.homeDirectoryForCurrentUser
        self.configDir = homeDir.appendingPathComponent(".vibetunnel")
        self.configPath = configDir.appendingPathComponent("config.json")
        
        // Initialize with default configuration
        self.configuration = VibeTunnelConfiguration()
        
        // Load configuration
        loadConfiguration()
        
        // Migrate settings from UserDefaults if needed
        migrateFromUserDefaults()
        
        // Update published values
        updatePublishedValues()
        
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
                self.configuration = try JSONDecoder().decode(VibeTunnelConfiguration.self, from: data)
                logger.info("Loaded enhanced configuration from disk")
            } catch {
                logger.error("Failed to load config: \(error.localizedDescription)")
                // Try to load as basic config for backward compatibility
                loadBasicConfiguration()
            }
        } else {
            logger.info("No config file found, creating with defaults")
            saveConfiguration()
        }
    }
    
    private func loadBasicConfiguration() {
        do {
            let data = try Data(contentsOf: configPath)
            
            // Try to decode just the basic structure
            if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
               let version = json["version"] as? Int,
               let commandsData = try? JSONSerialization.data(withJSONObject: json["quickStartCommands"] ?? []) {
                
                // Create a new configuration with the basic data
                self.configuration = VibeTunnelConfiguration()
                self.configuration.version = version
                self.configuration.quickStartCommands = (try? JSONDecoder().decode([QuickStartCommand].self, from: commandsData)) ?? QuickStartCommand.defaults
                self.configuration.repositoryBasePath = json["repositoryBasePath"] as? String ?? "~/"
                
                logger.info("Loaded basic configuration and upgraded to enhanced format")
                saveConfiguration() // Save the enhanced version
            }
        } catch {
            logger.error("Failed to load basic config: \(error.localizedDescription)")
            self.configuration = VibeTunnelConfiguration()
            saveConfiguration()
        }
    }
    
    // MARK: - Migration from UserDefaults
    
    private func migrateFromUserDefaults() {
        let defaults = UserDefaults.standard
        var needsSave = false
        
        // Migrate server settings
        if let port = defaults.object(forKey: AppConstants.UserDefaultsKeys.serverPort) as? Int,
           configuration.server?.port != port {
            configuration.server?.port = port
            migratedSettings.insert("serverPort")
            needsSave = true
        }
        
        if let mode = defaults.string(forKey: AppConstants.UserDefaultsKeys.dashboardAccessMode),
           configuration.server?.dashboardAccessMode != mode {
            configuration.server?.dashboardAccessMode = mode
            migratedSettings.insert("dashboardAccessMode")
            needsSave = true
        }
        
        // Migrate development settings
        if defaults.object(forKey: AppConstants.UserDefaultsKeys.debugMode) != nil {
            configuration.development?.debugMode = defaults.bool(forKey: AppConstants.UserDefaultsKeys.debugMode)
            migratedSettings.insert("debugMode")
            needsSave = true
        }
        
        if defaults.object(forKey: AppConstants.UserDefaultsKeys.useDevServer) != nil {
            configuration.development?.useDevServer = defaults.bool(forKey: AppConstants.UserDefaultsKeys.useDevServer)
            migratedSettings.insert("useDevServer")
            needsSave = true
        }
        
        // Migrate preferences
        if let gitApp = defaults.string(forKey: AppConstants.UserDefaultsKeys.preferredGitApp) {
            configuration.preferences?.preferredGitApp = gitApp
            migratedSettings.insert("preferredGitApp")
            needsSave = true
        }
        
        if defaults.object(forKey: AppConstants.UserDefaultsKeys.preventSleepWhenRunning) != nil {
            configuration.preferences?.preventSleepWhenRunning = defaults.bool(forKey: AppConstants.UserDefaultsKeys.preventSleepWhenRunning)
            migratedSettings.insert("preventSleepWhenRunning")
            needsSave = true
        }
        
        // Migrate ngrok settings
        if defaults.object(forKey: "ngrokEnabled") != nil {
            configuration.remoteAccess?.ngrokEnabled = defaults.bool(forKey: "ngrokEnabled")
            migratedSettings.insert("ngrokEnabled")
            needsSave = true
        }
        
        // Migrate session defaults
        if let command = defaults.string(forKey: AppConstants.UserDefaultsKeys.newSessionCommand) {
            configuration.sessionDefaults?.command = command
            migratedSettings.insert("newSessionCommand")
            needsSave = true
        }
        
        if let workingDir = defaults.string(forKey: AppConstants.UserDefaultsKeys.newSessionWorkingDirectory) {
            configuration.sessionDefaults?.workingDirectory = workingDir
            migratedSettings.insert("newSessionWorkingDirectory")
            needsSave = true
        }
        
        if needsSave {
            logger.info("Migrated \(migratedSettings.count) settings from UserDefaults")
            saveConfiguration()
            
            // Clean up migrated settings from UserDefaults
            cleanupMigratedSettings()
        }
    }
    
    private func cleanupMigratedSettings() {
        let defaults = UserDefaults.standard
        
        // Remove migrated settings from UserDefaults
        if migratedSettings.contains("serverPort") {
            defaults.removeObject(forKey: AppConstants.UserDefaultsKeys.serverPort)
        }
        if migratedSettings.contains("dashboardAccessMode") {
            defaults.removeObject(forKey: AppConstants.UserDefaultsKeys.dashboardAccessMode)
        }
        // Add more cleanup as needed
        
        defaults.synchronize()
        logger.info("Cleaned up migrated settings from UserDefaults")
    }
    
    // MARK: - Published Value Updates
    
    private func updatePublishedValues() {
        // Update all published values from configuration
        quickStartCommands = configuration.quickStartCommands
        repositoryBasePath = configuration.repositoryBasePath ?? "~/"
        
        // Server settings
        serverPort = configuration.server?.port ?? 4020
        dashboardAccessMode = configuration.server?.dashboardAccessMode ?? "network"
        cleanupOnStartup = configuration.server?.cleanupOnStartup ?? true
        authenticationMode = configuration.server?.authenticationMode ?? "os"
        
        // Development settings
        debugMode = configuration.development?.debugMode ?? false
        useDevServer = configuration.development?.useDevServer ?? false
        devServerPath = configuration.development?.devServerPath ?? ""
        logLevel = configuration.development?.logLevel ?? "info"
        
        // Preferences
        preferredGitApp = configuration.preferences?.preferredGitApp
        preferredTerminal = configuration.preferences?.preferredTerminal
        updateChannel = configuration.preferences?.updateChannel ?? "stable"
        showInDock = configuration.preferences?.showInDock ?? false
        preventSleepWhenRunning = configuration.preferences?.preventSleepWhenRunning ?? true
        
        // Remote access
        ngrokEnabled = configuration.remoteAccess?.ngrokEnabled ?? false
        ngrokTokenPresent = configuration.remoteAccess?.ngrokTokenPresent ?? false
        
        // Session defaults
        sessionCommand = configuration.sessionDefaults?.command ?? "zsh"
        sessionWorkingDirectory = configuration.sessionDefaults?.workingDirectory ?? "~/"
        sessionSpawnWindow = configuration.sessionDefaults?.spawnWindow ?? true
        sessionTitleMode = configuration.sessionDefaults?.titleMode ?? "dynamic"
    }
    
    // MARK: - Configuration Saving
    
    private func saveConfiguration() {
        do {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            let data = try encoder.encode(configuration)
            
            // Ensure directory exists
            try FileManager.default.createDirectory(at: configDir, withIntermediateDirectories: true)
            
            // Write atomically to prevent corruption
            try data.write(to: configPath, options: .atomic)
            logger.info("Saved enhanced configuration to disk")
        } catch {
            logger.error("Failed to save config: \(error.localizedDescription)")
        }
    }
    
    // MARK: - File Monitoring
    
    private func startFileMonitoring() {
        // Implementation similar to ConfigManager
        // ... (copy from ConfigManager with appropriate modifications)
    }
    
    private func stopFileMonitoring() {
        fileMonitor?.cancel()
        fileMonitor = nil
    }
    
    // MARK: - Public API for Updates
    
    /// Update server configuration
    func updateServerConfiguration(_ update: (inout ServerConfiguration) -> Void) {
        if configuration.server == nil {
            configuration.server = ServerConfiguration()
        }
        update(&configuration.server!)
        updatePublishedValues()
        saveConfiguration()
    }
    
    /// Update development configuration
    func updateDevelopmentConfiguration(_ update: (inout DevelopmentConfiguration) -> Void) {
        if configuration.development == nil {
            configuration.development = DevelopmentConfiguration()
        }
        update(&configuration.development!)
        updatePublishedValues()
        saveConfiguration()
    }
    
    /// Update preferences
    func updatePreferences(_ update: (inout PreferencesConfiguration) -> Void) {
        if configuration.preferences == nil {
            configuration.preferences = PreferencesConfiguration()
        }
        update(&configuration.preferences!)
        updatePublishedValues()
        saveConfiguration()
    }
    
    /// Update remote access configuration
    func updateRemoteAccess(_ update: (inout RemoteAccessConfiguration) -> Void) {
        if configuration.remoteAccess == nil {
            configuration.remoteAccess = RemoteAccessConfiguration()
        }
        update(&configuration.remoteAccess!)
        updatePublishedValues()
        saveConfiguration()
    }
    
    /// Update session defaults
    func updateSessionDefaults(_ update: (inout SessionDefaultsConfiguration) -> Void) {
        if configuration.sessionDefaults == nil {
            configuration.sessionDefaults = SessionDefaultsConfiguration()
        }
        update(&configuration.sessionDefaults!)
        updatePublishedValues()
        saveConfiguration()
    }
    
    // MARK: - Quick Start Commands (for compatibility)
    
    func updateQuickStartCommands(_ commands: [QuickStartCommand]) {
        guard commands != configuration.quickStartCommands else { return }
        
        configuration.quickStartCommands = commands
        updatePublishedValues()
        saveConfiguration()
        logger.info("Updated quick start commands: \(commands.count) items")
    }
    
    func updateRepositoryBasePath(_ path: String) {
        guard path != configuration.repositoryBasePath else { return }
        
        configuration.repositoryBasePath = path
        updatePublishedValues()
        saveConfiguration()
        logger.info("Updated repository base path to: \(path)")
    }
    
    // MARK: - Backward Compatibility
    
    /// Check if we should use EnhancedConfigManager or fall back to basic ConfigManager
    static func shouldUseEnhanced() -> Bool {
        // Check config file version or other criteria
        let homeDir = FileManager.default.homeDirectoryForCurrentUser
        let configPath = homeDir.appendingPathComponent(".vibetunnel/config.json")
        
        if let data = try? Data(contentsOf: configPath),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let version = json["version"] as? Int {
            return version >= 2
        }
        
        return true // Default to enhanced for new installations
    }
    
    /// Get the configuration file path for debugging
    var configurationPath: String {
        configPath.path
    }
    
    deinit {
        stopFileMonitoring()
    }
}