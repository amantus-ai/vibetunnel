import Combine
import Foundation
import OSLog

/// Manager for VibeTunnel configuration stored in ~/.vibetunnel/config.json
/// This ensures quick start commands are synchronized between Mac app and web UI
@MainActor
class ConfigManager: ObservableObject {
    static let shared = ConfigManager()

    private let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "ConfigManager")
    private let configDir: URL
    private let configPath: URL
    private var fileMonitor: DispatchSourceFileSystemObject?

    @Published private(set) var quickStartCommands: [QuickStartCommand] = []

    /// Quick start command structure matching the web interface
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
    }

    /// Configuration structure matching web/src/types/config.ts
    private struct VibeTunnelConfig: Codable {
        let version: Int
        var quickStartCommands: [QuickStartCommand]
    }

    /// Default commands matching web/src/types/config.ts
    private let defaultCommands = [
        QuickStartCommand(name: "✨ claude", command: "claude"),
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

                // Validate config structure
                if config.version > 0 && !config.quickStartCommands.isEmpty {
                    self.quickStartCommands = config.quickStartCommands
                    logger.info("Loaded configuration from disk with \(config.quickStartCommands.count) commands")
                } else {
                    logger.warning("Invalid config structure, using defaults")
                    useDefaults()
                }
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
        saveConfiguration()
    }

    // MARK: - Configuration Saving

    private func saveConfiguration() {
        let config = VibeTunnelConfig(version: 1, quickStartCommands: quickStartCommands)

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

    /// Get the configuration file path for debugging
    var configurationPath: String {
        configPath.path
    }

    deinit {
        // File monitoring will be cleaned up automatically
    }
}
