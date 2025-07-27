import Foundation
import OSLog
import UserNotifications

/// Handles notification control messages via the unified control socket
@MainActor
final class NotificationControlHandler {
    private let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "NotificationControl")

    // MARK: - Singleton

    static let shared = NotificationControlHandler()

    // MARK: - Properties

    private let notificationService = NotificationService.shared

    // MARK: - Initialization

    private init() {
        // Register handler with the shared socket manager
        SharedUnixSocketManager.shared.registerControlHandler(for: .notification) { [weak self] data in
            _ = await self?.handleMessage(data)
            return nil // No response needed for notifications
        }

        logger.info("NotificationControlHandler initialized")
    }

    // MARK: - Message Handling

    private func handleMessage(_ data: Data) async -> Data? {
        do {
            // First decode just to get the action
            if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
               let action = json["action"] as? String
            {
                switch action {
                case "show":
                    return await handleShowNotification(json)
                default:
                    logger.warning("Unknown notification action: \(action)")
                }
            }
        } catch {
            logger.error("Failed to decode notification message: \(error)")
        }

        return nil
    }

    private func handleShowNotification(_ json: [String: Any]) async -> Data? {
        guard let payload = json["payload"] as? [String: Any],
              let title = payload["title"] as? String,
              let body = payload["body"] as? String
        else {
            logger.error("Notification message missing required fields")
            return nil
        }

        // Try to parse as ServerEvent-compatible structure
        let typeString = payload["type"] as? String
        let sessionId = payload["sessionId"] as? String
        let sessionName = payload["sessionName"] as? String
        let exitCode = payload["exitCode"] as? Int
        let duration = payload["duration"] as? Int
        let command = payload["command"] as? String

        logger.info("Received notification: \(title) - \(body) (type: \(typeString ?? "unknown"))")

        // Map type string to ServerEventType and create ServerEvent
        if let typeString = typeString,
           let eventType = ServerEventType(rawValue: typeString) {
            
            let serverEvent = ServerEvent(
                type: eventType,
                sessionId: sessionId,
                sessionName: sessionName ?? title,
                command: command,
                exitCode: exitCode,
                duration: duration,
                message: body
            )
            
            // Use the consolidated notification method
            await notificationService.sendNotification(for: serverEvent)
        } else {
            // Unknown event type - log and ignore
            logger.warning("Unknown event type '\(typeString ?? "nil")' - ignoring notification request")
        }

        return nil
    }
}

// MARK: - Supporting Types

/// Notification payload that can be converted to ServerEvent
private struct NotificationPayload: Codable {
    let title: String
    let body: String
    let type: String?
    let sessionId: String?
    let sessionName: String?
    let command: String?
    let exitCode: Int?
    let duration: Int?
}
