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

        let type = payload["type"] as? String
        let sessionName = payload["sessionName"] as? String

        logger.info("Received notification: \(title) - \(body) (type: \(type ?? "unknown"))")

        // Check notification type and send appropriate notification
        switch type {
        case "session-start":
            await notificationService.sendSessionStartNotification(
                sessionName: sessionName ?? "New Session"
            )
        case "session-exit":
            await notificationService.sendSessionExitNotification(
                sessionName: sessionName ?? "Session",
                exitCode: 0
            )
        case "your-turn":
            // For "your turn" notifications, use command completion notification
            await notificationService.sendCommandCompletionNotification(
                command: sessionName ?? "Command",
                duration: 0
            )
        default:
            // Fallback to generic notification
            await notificationService.sendGenericNotification(
                title: title,
                body: body
            )
        }

        return nil
    }
}

// MARK: - Supporting Types

private struct NotificationPayload: Codable {
    let title: String
    let body: String
    let type: String?
    let sessionId: String?
    let sessionName: String?
}
