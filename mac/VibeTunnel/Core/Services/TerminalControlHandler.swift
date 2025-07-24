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

        logger.info("🚀 Terminal control handler initialized")
    }

    // MARK: - Message Handling

    private func handleMessage(_ data: Data) async -> Data? {
        do {
            // First check what action this is
            if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
               let action = json["action"] as? String
            {
                switch action {
                case "spawn":
                    // Try to decode as terminal spawn request
                    if let spawnRequest = try? ControlProtocol.decodeTerminalSpawnRequest(data) {
                        logger
                            .info(
                                "📥 Terminal spawn request for session: \(spawnRequest.payload?.sessionId ?? "unknown")"
                            )
                        let response = await handleSpawnRequest(spawnRequest)
                        return try ControlProtocol.encode(response)
                    } else {
                        logger.error("Failed to decode terminal spawn request")
                        return createErrorResponse(for: data, error: "Invalid spawn request format")
                    }

                default:
                    logger.error("Unknown terminal action: \(action)")
                    return createErrorResponse(for: data, error: "Unknown terminal action: \(action)")
                }
            } else {
                logger.error("Invalid terminal message format")
                return createErrorResponse(for: data, error: "Invalid message format")
            }
        } catch {
            logger.error("Failed to process terminal message: \(error)")
            return createErrorResponse(for: data, error: "Failed to process message: \(error.localizedDescription)")
        }
    }

    private func handleSpawnRequest(_ message: ControlProtocol.TerminalSpawnRequestMessage) async -> ControlProtocol
        .TerminalSpawnResponseMessage
    {
        guard let payload = message.payload else {
            return ControlProtocol.terminalSpawnResponse(
                to: message,
                success: false,
                error: "Missing payload"
            )
        }

        logger.info("Spawning terminal session \(payload.sessionId)")

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
                vibetunnelPath: nil // Use bundled path
            )

            // Success response with compile-time guarantees
            return ControlProtocol.terminalSpawnResponse(
                to: message,
                success: true
            )
        } catch {
            logger.error("Failed to spawn terminal: \(error)")
            return ControlProtocol.terminalSpawnResponse(
                to: message,
                success: false,
                error: error.localizedDescription
            )
        }
    }

    // MARK: - Public Methods

    /// Start the terminal control handler
    func start() {
        // Handler is registered in init, just log that we're ready
        logger.info("✅ Terminal control handler started")
    }

    /// Stop the terminal control handler
    func stop() {
        SharedUnixSocketManager.shared.unregisterControlHandler(for: .terminal)
        logger.info("🛑 Terminal control handler stopped")
    }

    // MARK: - Error Handling

    private func createErrorResponse(for data: Data, error: String) -> Data? {
        do {
            // Try to get request ID for proper error response
            if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
               let id = json["id"] as? String,
               let action = json["action"] as? String
            {
                // Create error response matching request
                let errorResponse: [String: Any] = [
                    "id": id,
                    "type": "response",
                    "category": "terminal",
                    "action": action,
                    "error": error
                ]

                return try JSONSerialization.data(withJSONObject: errorResponse)
            }
        } catch {
            logger.error("Failed to create error response: \(error)")
        }

        return nil
    }
}
