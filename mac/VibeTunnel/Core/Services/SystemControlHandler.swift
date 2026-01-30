import Foundation
import OSLog

/// Handles system-level control messages
/// IMPORTANT: System:ready message handling
/// This handler specifically processes system:ready messages that were previously
/// handled inline. It ensures connection establishment acknowledgment is properly sent.
/// The handler must be registered during app initialization to handle these messages.
@MainActor
final class SystemControlHandler {
    private let logger = Logger(subsystem: BundleIdentifiers.loggerSubsystem, category: "SystemControl")

    // MARK: - Properties

    private let onSystemReady: () -> Void

    // MARK: - Initialization

    init(onSystemReady: @escaping () -> Void = {}) {
        self.onSystemReady = onSystemReady
        self.logger.info("SystemControlHandler initialized")
        // Note: Registration with SharedUnixSocketManager is handled by
        // SharedUnixSocketManager.initializeSystemHandler()
    }

    // MARK: - Message Handling

    /// Handle incoming system control messages
    func handleMessage(_ data: Data) async -> Data? {
        do {
            // First decode to get the action
            if let json = JSONValue.decodeObject(from: data),
               let action = json["action"]?.string
            {
                switch action {
                case "ready":
                    return await self.handleReadyEvent(data)
                case "ping":
                    return await self.handlePingRequest(data)
                default:
                    self.logger.error("Unknown system action: \(action)")
                    return self.createErrorResponse(for: data, error: "Unknown system action: \(action)")
                }
            } else {
                self.logger.error("Invalid system message format")
                return self.createErrorResponse(for: data, error: "Invalid message format")
            }
        } catch {
            self.logger.error("Failed to parse system message: \(error)")
            return self.createErrorResponse(for: data, error: "Failed to parse message: \(error.localizedDescription)")
        }
    }

    // MARK: - Action Handlers

    private func handleReadyEvent(_ data: Data) async -> Data? {
        do {
            _ = try ControlProtocol.decode(data, as: ControlProtocol.SystemReadyMessage.self)
            self.logger.info("System ready event received")

            // Call the ready handler
            self.onSystemReady()

            // No response needed for events
            return nil
        } catch {
            self.logger.error("Failed to decode system ready event: \(error)")
            return nil
        }
    }

    private func handlePingRequest(_ data: Data) async -> Data? {
        do {
            let request = try ControlProtocol.decodeSystemPingRequest(data)
            self.logger.debug("System ping request received")

            let response = ControlProtocol.systemPingResponse(to: request)
            return try ControlProtocol.encode(response)
        } catch {
            self.logger.error("Failed to handle ping request: \(error)")
            return self.createErrorResponse(for: data, error: "Failed to process ping: \(error.localizedDescription)")
        }
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
                    "category": .string("system"),
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
