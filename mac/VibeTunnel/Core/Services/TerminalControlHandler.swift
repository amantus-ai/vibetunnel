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
        SharedUnixSocketManager.shared.registerControlHandler(for: .terminal) { [weak self] message in
            await self?.handleMessage(message)
        }

        logger.info("🚀 Terminal control handler initialized")
    }

    // MARK: - Message Handling

    private func handleMessage(_ message: ControlProtocol.ControlMessage) async -> ControlProtocol.ControlMessage? {
        logger.info("📥 Terminal message: \(message.action)")

        switch message.action {
        case "spawn":
            return await handleSpawnRequest(message)

        default:
            logger.warning("Unknown terminal action: \(message.action)")
            return ControlProtocol.createResponse(
                to: message,
                error: "Unknown action: \(message.action)"
            )
        }
    }

    private func handleSpawnRequest(_ message: ControlProtocol.ControlMessage) async -> ControlProtocol.ControlMessage {
        guard let payload = message.payload else {
            return ControlProtocol.createResponse(to: message, error: "Missing payload")
        }

        // Extract spawn parameters
        let sessionId = payload["sessionId"] as? String ?? message.sessionId ?? ""
        let workingDirectory = payload["workingDirectory"] as? String ?? ""
        let command = payload["command"] as? String ?? ""
        let terminalPreference = payload["terminalPreference"] as? String

        logger.info("Spawning terminal session \(sessionId)")

        do {
            // If a specific terminal is requested, temporarily set it
            var originalTerminal: String?
            if let requestedTerminal = terminalPreference {
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
                workingDirectory: workingDirectory,
                command: command,
                sessionId: sessionId,
                vibetunnelPath: nil // Use bundled path
            )

            // Success response
            return ControlProtocol.createResponse(
                to: message,
                payload: ["success": true]
            )
        } catch {
            logger.error("Failed to spawn terminal: \(error)")
            return ControlProtocol.createResponse(
                to: message,
                payload: ["success": false],
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
