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
            await self?.handleMessage(data)
            return nil // No response needed for notifications
        }
        
        logger.info("NotificationControlHandler initialized")
    }
    
    // MARK: - Message Handling
    
    @discardableResult
    private func handleMessage(_ data: Data) async -> Data? {
        do {
            let message = try JSONDecoder().decode(NotificationMessage.self, from: data)
            
            switch message.action {
            case .show:
                handleShowNotification(message.payload)
            }
        } catch {
            logger.error("Failed to decode notification message: \(error)")
        }
        
        return nil
    }
    
    private func handleShowNotification(_ payload: NotificationPayload) {
        logger.info("Received notification: \(payload.title) - \(payload.body) (type: \(payload.type?.rawValue ?? "generic"))")
        
        // Check notification type and send appropriate notification
        if let type = payload.type {
            switch type {
            case .sessionStart:
                notificationService.sendSessionStartNotification(
                    sessionName: payload.sessionName ?? "New Session"
                )
            case .sessionExit:
                notificationService.sendSessionExitNotification(
                    sessionName: payload.sessionName ?? "Session",
                    exitCode: payload.exitCode ?? 0
                )
            case .yourTurn:
                // For "your turn" notifications, use command completion notification
                notificationService.sendCommandCompletionNotification(
                    command: payload.sessionName ?? "Command",
                    duration: payload.duration ?? 0
                )
            }
        } else {
            // Fallback to generic notification
            notificationService.sendGenericNotification(
                title: payload.title,
                body: payload.body
            )
        }
    }
}

// MARK: - Supporting Types

private struct NotificationMessage: Codable {
    let action: NotificationAction
    let payload: NotificationPayload
}

private enum NotificationAction: String, Codable {
    case show
}

private struct NotificationPayload: Codable {
    let title: String
    let body: String
    let type: NotificationType?
    let sessionId: String?
    let sessionName: String?
    let exitCode: Int?
    let duration: Int?
}

private enum NotificationType: String, Codable {
    case sessionStart = "session-start"
    case sessionExit = "session-exit"
    case yourTurn = "your-turn"
} 
