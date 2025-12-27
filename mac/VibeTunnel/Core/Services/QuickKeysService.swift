import Foundation
import Observation
import OSLog

/// Service for managing Quick Keys layout via ConfigManager
/// Handles loading, saving (with debouncing), and preset management
@MainActor
@Observable
final class QuickKeysService {
    static let shared = QuickKeysService()

    private let logger = Logger(subsystem: BundleIdentifiers.loggerSubsystem, category: "QuickKeysService")
    private var configManager: ConfigManager { ConfigManager.shared }
    private var saveTask: Task<Void, Never>?

    /// Current layout - array of rows, each row is array of key IDs
    private(set) var layout: [[String]] = QuickKeysData.defaultLayout

    /// Loading state
    private(set) var isLoading = false

    /// Saving state (for UI feedback)
    private(set) var isSaving = false

    /// Last error encountered
    private(set) var error: Error?

    private init() {}

    // MARK: - Public API

    /// Load layout from ConfigManager
    func load() async {
        guard !self.isLoading else { return }

        self.isLoading = true
        self.error = nil

        defer { isLoading = false }

        let configLayout = self.configManager.quickKeysLayout
        if !configLayout.isEmpty {
            self.layout = configLayout
            self.logger.info("Loaded quick keys layout from config: \(configLayout.count) rows")
        } else {
            self.layout = QuickKeysData.defaultLayout
            self.logger.info("No quick keys layout in config, using defaults")
        }
    }

    /// Save layout to ConfigManager (debounced to prevent excessive saves during drag operations)
    /// Note: Does not update `layout` property to avoid triggering UI re-renders - caller manages local state
    func save(_ newLayout: [[String]]) {
        // Cancel any pending save
        self.saveTask?.cancel()

        // Debounce saves by 500ms to batch rapid changes
        self.saveTask = Task {
            do {
                try await Task.sleep(for: .milliseconds(500))
            } catch {
                return // Cancelled
            }

            guard !Task.isCancelled else { return }

            await self.performSave(newLayout)
        }
    }

    /// Perform immediate save (internal)
    private func performSave(_ layoutToSave: [[String]]) async {
        // Only show saving indicator for longer operations
        let showIndicator = Task {
            try? await Task.sleep(for: .milliseconds(200))
            if !Task.isCancelled {
                self.isSaving = true
            }
        }

        self.configManager.updateQuickKeysLayout(layoutToSave)

        // Update internal state after save
        self.layout = layoutToSave
        self.logger.info("Saved quick keys layout: \(layoutToSave.count) rows")
        self.error = nil

        showIndicator.cancel()
        self.isSaving = false
    }

    /// Reset to default layout
    func resetToDefaults() {
        self.save(QuickKeysData.defaultLayout)
    }

    /// Apply a preset
    func applyPreset(_ preset: QuickKeysPreset) {
        self.save(preset.layout)
    }

    /// Get hidden keys (keys not in current layout)
    func hiddenKeys() -> [QuickKeyDefinition] {
        let usedKeys = Set(layout.flatMap(\.self))
        return QuickKeysData.allKeys.filter { !usedKeys.contains($0.key) }
    }
}
