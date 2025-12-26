import Foundation
import Observation
import OSLog

/// Service for managing Quick Keys layout via server API
/// Handles loading, saving (with debouncing), and preset management
@MainActor
@Observable
final class QuickKeysService {
    static let shared = QuickKeysService()

    private let logger = Logger(subsystem: BundleIdentifiers.loggerSubsystem, category: "QuickKeysService")
    private var serverManager: ServerManager { ServerManager.shared }
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

    // MARK: - API Response Types

    private struct ConfigResponse: Decodable {
        let quickKeysLayout: [[String]]?
    }

    // MARK: - Public API

    /// Load layout from server
    func load() async {
        guard !isLoading else { return }

        isLoading = true
        error = nil

        defer { isLoading = false }

        do {
            let response: ConfigResponse = try await serverManager.performRequest(
                endpoint: APIEndpoints.config,
                method: "GET",
                responseType: ConfigResponse.self)

            if let serverLayout = response.quickKeysLayout, !serverLayout.isEmpty {
                layout = serverLayout
                logger.info("Loaded quick keys layout from server: \(serverLayout.count) rows")
            } else {
                layout = QuickKeysData.defaultLayout
                logger.info("No quick keys layout on server, using defaults")
            }
        } catch {
            self.error = error
            logger.error("Failed to load quick keys layout: \(error.localizedDescription)")
        }
    }

    /// Save layout to server (debounced to prevent excessive API calls during drag operations)
    func save(_ newLayout: [[String]]) {
        layout = newLayout

        // Cancel any pending save
        saveTask?.cancel()

        // Debounce saves by 300ms
        saveTask = Task {
            do {
                try await Task.sleep(for: .milliseconds(300))
            } catch {
                return // Cancelled
            }

            guard !Task.isCancelled else { return }

            await performSave(newLayout)
        }
    }

    /// Perform immediate save (internal)
    private func performSave(_ layoutToSave: [[String]]) async {
        isSaving = true
        defer { isSaving = false }

        do {
            // Wrap the layout array in a struct for encoding
            let body = QuickKeysLayoutBody(layout: layoutToSave)
            try await serverManager.performVoidRequest(
                endpoint: APIEndpoints.quickKeysLayout,
                method: "PUT",
                body: body)
            logger.info("Saved quick keys layout: \(layoutToSave.count) rows")
            error = nil
        } catch {
            self.error = error
            logger.error("Failed to save quick keys layout: \(error.localizedDescription)")
        }
    }

    /// Reset to default layout
    func resetToDefaults() {
        save(QuickKeysData.defaultLayout)
    }

    /// Apply a preset
    func applyPreset(_ preset: QuickKeysPreset) {
        save(preset.layout)
    }

    /// Get hidden keys (keys not in current layout)
    func hiddenKeys() -> [QuickKeyDefinition] {
        let usedKeys = Set(layout.flatMap { $0 })
        return QuickKeysData.allKeys.filter { !usedKeys.contains($0.key) }
    }
}

// MARK: - Request Body Wrapper

/// Wrapper to encode the layout array directly as JSON array
/// The server expects the body to be just the array: [["Escape", ...], ...]
private struct QuickKeysLayoutBody: Encodable {
    let layout: [[String]]

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(layout)
    }
}
