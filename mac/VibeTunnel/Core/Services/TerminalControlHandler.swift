import Foundation
import OSLog

/// Handles terminal control messages via the unified control socket
@MainActor
final class TerminalControlHandler {
    private let logger = Logger(subsystem: BundleIdentifiers.loggerSubsystem, category: "TerminalControl")

    // MARK: - Singleton

    static let shared = TerminalControlHandler()

    // MARK: - Initialization

    private init() {
        // Register handler with the shared socket manager
        // NOTE: System handlers (like SystemControlHandler) need to be registered separately
        // since they may have different lifecycle requirements
        SharedUnixSocketManager.shared.registerControlHandler(for: .terminal) { [weak self] data in
            await self?.handleMessage(data)
        }

        self.logger.info("🚀 Terminal control handler initialized")
    }

    // MARK: - Message Handling

    private func handleMessage(_ data: Data) async -> Data? {
        do {
            // First check what action this is
            if let json = JSONValue.decodeObject(from: data),
               let action = json["action"]?.string
            {
                switch action {
                case "spawn":
                    // Try to decode as terminal spawn request
                    if let spawnRequest = try? ControlProtocol.decodeTerminalSpawnRequest(data) {
                        self.logger
                            .info(
                                "📥 Terminal spawn request for session: \(spawnRequest.payload?.sessionId ?? "unknown")")
                        let response = await handleSpawnRequest(spawnRequest)
                        return try ControlProtocol.encode(response)
                    } else {
                        self.logger.error("Failed to decode terminal spawn request")
                        return self.createErrorResponse(for: data, error: "Invalid spawn request format")
                    }

                default:
                    self.logger.error("Unknown terminal action: \(action)")
                    return self.createErrorResponse(for: data, error: "Unknown terminal action: \(action)")
                }
            } else {
                self.logger.error("Invalid terminal message format")
                return self.createErrorResponse(for: data, error: "Invalid message format")
            }
        } catch {
            self.logger.error("Failed to process terminal message: \(error)")
            return self.createErrorResponse(
                for: data,
                error: "Failed to process message: \(error.localizedDescription)")
        }
    }

    private func handleSpawnRequest(_ message: ControlProtocol.TerminalSpawnRequestMessage) async -> ControlProtocol
        .TerminalSpawnResponseMessage
    {
        guard let payload = message.payload else {
            return ControlProtocol.terminalSpawnResponse(
                to: message,
                success: false,
                error: "Missing payload")
        }

        self.logger.info("Spawning terminal session \(payload.sessionId)")

        do {
            // If a specific terminal is requested, temporarily set it
            var originalTerminal: String?
            if let requestedTerminal = payload.terminalPreference {
                originalTerminal = UserDefaults.standard.string(forKey: "preferredTerminal")
                UserDefaults.standard.set(requestedTerminal, forKey: "preferredTerminal")
            }

            defer {
                // Restore original terminal preference if we changed it
                if let original = originalTerminal {
                    UserDefaults.standard.set(original, forKey: "preferredTerminal")
                }
            }

            // Launch the terminal
            try TerminalLauncher.shared.launchOptimizedTerminalSession(
                workingDirectory: payload.workingDirectory ?? "",
                command: payload.command ?? "",
                sessionId: payload.sessionId,
                vibetunnelPath: nil, // Use bundled path
            )

            // Success response with compile-time guarantees
            return ControlProtocol.terminalSpawnResponse(
                to: message,
                success: true)
        } catch {
            self.logger.error("Failed to spawn terminal: \(error)")
            return ControlProtocol.terminalSpawnResponse(
                to: message,
                success: false,
                error: error.localizedDescription)
        }
    }

    // MARK: - Public Methods

    /// Start the terminal control handler
    func start() {
        // Handler is registered in init, just log that we're ready
        self.logger.info("✅ Terminal control handler started")
    }

    /// Stop the terminal control handler
    func stop() {
        SharedUnixSocketManager.shared.unregisterControlHandler(for: .terminal)
        self.logger.info("🛑 Terminal control handler stopped")
    }

    // MARK: - Error Handling

    private func createErrorResponse(for data: Data, error: String) -> Data? {
        do {
            // Try to get request ID for proper error response
            if let json = JSONValue.decodeObject(from: data),
               let id = json["id"]?.string,
               let action = json["action"]?.string
            {
                // Create error response matching request
                let errorResponse: [String: JSONValue] = [
                    "id": .string(id),
                    "type": .string("response"),
                    "category": .string("terminal"),
                    "action": .string(action),
                    "error": .string(error),
                ]

                return try JSONEncoder().encode(errorResponse)
            }
        } catch {
            self.logger.error("Failed to create error response: \(error)")
        }

        return nil
    }
}
