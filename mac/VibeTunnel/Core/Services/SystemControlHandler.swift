import Foundation
import OSLog

/// Handles system-level control messages
/// IMPORTANT: System:ready message handling
/// This handler specifically processes system:ready messages that were previously
/// handled inline. It ensures connection establishment acknowledgment is properly sent.
/// The handler must be registered during app initialization to handle these messages.
@MainActor
final class SystemControlHandler {
    private let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "SystemControl")

    // MARK: - Properties

    private let onSystemReady: () -> Void

    // MARK: - Initialization

    init(onSystemReady: @escaping () -> Void = {}) {
        self.onSystemReady = onSystemReady
        logger.info("SystemControlHandler initialized")
        // Note: Registration with SharedUnixSocketManager is handled by
        // SharedUnixSocketManager.initializeSystemHandler()
    }

    // MARK: - Message Handling

    /// Handle incoming system control messages
    func handleMessage(_ data: Data) async -> Data? {
        do {
            // First decode to get the action
            if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
               let action = json["action"] as? String
            {
                switch action {
                case "ready":
                    return await handleReadyEvent(data)
                case "ping":
                    return await handlePingRequest(data)
                case "repository-path-update":
                    return await handleRepositoryPathUpdate(data)
                default:
                    logger.error("Unknown system action: \(action)")
                    return createErrorResponse(for: data, error: "Unknown system action: \(action)")
                }
            } else {
                logger.error("Invalid system message format")
                return createErrorResponse(for: data, error: "Invalid message format")
            }
        } catch {
            logger.error("Failed to parse system message: \(error)")
            return createErrorResponse(for: data, error: "Failed to parse message: \(error.localizedDescription)")
        }
    }

    // MARK: - Action Handlers

    private func handleReadyEvent(_ data: Data) async -> Data? {
        do {
            _ = try ControlProtocol.decode(data, as: ControlProtocol.SystemReadyMessage.self)
            logger.info("System ready event received")

            // Call the ready handler
            onSystemReady()

            // No response needed for events
            return nil
        } catch {
            logger.error("Failed to decode system ready event: \(error)")
            return nil
        }
    }

    private func handlePingRequest(_ data: Data) async -> Data? {
        do {
            let request = try ControlProtocol.decodeSystemPingRequest(data)
            logger.debug("System ping request received")

            let response = ControlProtocol.systemPingResponse(to: request)
            return try ControlProtocol.encode(response)
        } catch {
            logger.error("Failed to handle ping request: \(error)")
            return createErrorResponse(for: data, error: "Failed to process ping: \(error.localizedDescription)")
        }
    }

    private func handleRepositoryPathUpdate(_ data: Data) async -> Data? {
        do {
            // Decode the message to get the path and source
            if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
               let id = json["id"] as? String,
               let payload = json["payload"] as? [String: Any],
               let newPath = payload["path"] as? String,
               let source = payload["source"] as? String
            {
                logger.info("Repository path update from \(source): \(newPath)")

                // Only process if it's from web
                if source == "web" {
                    // Get current path
                    let currentPath = UserDefaults.standard
                        .string(forKey: AppConstants.UserDefaultsKeys.repositoryBasePath)

                    // Only update if different
                    if currentPath != newPath {
                        // Update UserDefaults
                        UserDefaults.standard.set(newPath, forKey: AppConstants.UserDefaultsKeys.repositoryBasePath)

                        // Post notification to temporarily disable sync to prevent loop
                        NotificationCenter.default.post(name: .disablePathSync, object: nil)

                        // Re-enable sync after a delay
                        Task {
                            try await Task.sleep(nanoseconds: 500_000_000) // 0.5 seconds
                            NotificationCenter.default.post(name: .enablePathSync, object: nil)
                        }

                        logger.info("✅ Updated repository path from web: \(newPath)")
                    }
                }

                // Create success response
                let responsePayload: [String: Any] = [
                    "success": true,
                    "path": newPath
                ]

                let response: [String: Any] = [
                    "id": id,
                    "type": "response",
                    "category": "system",
                    "action": "repository-path-update",
                    "payload": responsePayload
                ]

                return try JSONSerialization.data(withJSONObject: response)
            } else {
                logger.error("Invalid repository path update format")
                return createErrorResponse(for: data, error: "Invalid repository path update format")
            }
        } catch {
            logger.error("Failed to handle repository path update: \(error)")
            return createErrorResponse(
                for: data,
                error: "Failed to process repository path update: \(error.localizedDescription)"
            )
        }
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
                    "category": "system",
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
