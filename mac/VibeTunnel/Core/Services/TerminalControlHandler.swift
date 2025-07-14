import Foundation
import OSLog

/// Handles terminal control messages via the unified control socket
@MainActor
final class TerminalControlHandler {
    private let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "TerminalControl")

    // MARK: - Singleton

    static let shared = TerminalControlHandler()

    // MARK: - Initialization

    private init() {
        // Register handler with the shared socket manager
        SharedUnixSocketManager.shared.registerControlHandler(for: .terminal) { [weak self] data in
            await self?.handleMessage(data)
        }

        logger.info("🚀 Terminal control handler initialized")
    }

    // MARK: - Message Handling

    private func handleMessage(_ data: Data) async -> Data? {
        do {
            // Try to decode as terminal spawn request first
            if let spawnRequest = try? ControlProtocol.decodeTerminalSpawnRequest(data) {
                logger.info("📥 Terminal spawn request for session: \(spawnRequest.payload?.sessionId ?? "unknown")")
                let response = await handleSpawnRequest(spawnRequest)
                return try ControlProtocol.encode(response)
            }
            
            // Could add other terminal message types here
            
            logger.warning("Unknown terminal message format")
            return nil
            
        } catch {
            logger.error("Failed to process terminal message: \(error)")
            return nil
        }
    }

    private func handleSpawnRequest(_ message: ControlProtocol.TerminalSpawnRequestMessage) async -> ControlProtocol.TerminalSpawnResponseMessage {
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
}
