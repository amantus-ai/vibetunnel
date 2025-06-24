import Foundation
import UserNotifications
import AppKit
import SwiftUI
import os

/// Manages system notifications for important events
@MainActor
final class NotificationManager: NSObject {
    static let shared = NotificationManager()
    
    private var hasRequestedPermission = false
    
    // Notification preferences
    @AppStorage("notificationsEnabled") private var notificationsEnabled = true
    @AppStorage("notifyOnSessionExit") private var notifyOnSessionExit = true
    @AppStorage("notifyOnSessionExitOnlyOnError") private var notifyOnSessionExitOnlyOnError = false
    @AppStorage("notifyOnConnectionChange") private var notifyOnConnectionChange = true
    @AppStorage("notifyOnErrors") private var notifyOnErrors = true
    @AppStorage("playNotificationSound") private var playNotificationSound = true
    @AppStorage("showNotificationsInForeground") private var showNotificationsInForeground = false
    
    private override init() {
        super.init()
        setupNotifications()
    }
    
    private func setupNotifications() {
        UNUserNotificationCenter.current().delegate = self
    }
    
    /// Request notification permissions
    func requestPermissionIfNeeded() async {
        guard !hasRequestedPermission else { return }
        hasRequestedPermission = true
        
        do {
            let granted = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
            Logger.app.info("Notification permission granted: \(granted)")
        } catch {
            Logger.logError(Logger.app, "Failed to request notification permission", error: error)
        }
    }
    
    /// Show a notification for session completion
    func notifySessionCompleted(_ session: Session) async {
        // Check if notifications are enabled
        guard notificationsEnabled && notifyOnSessionExit else { return }
        
        // Check if we should only notify on error
        if notifyOnSessionExitOnlyOnError {
            guard let exitCode = session.exitCode, exitCode != 0 else { return }
        }
        
        // Check if app is in background (unless foreground notifications are enabled)
        guard showNotificationsInForeground || NSApp.isActive == false else { return }
        
        let content = UNMutableNotificationContent()
        content.title = "Session Completed"
        content.body = session.displayName
        content.sound = playNotificationSound ? .default : nil
        
        if let exitCode = session.exitCode {
            content.subtitle = exitCode == 0 ? "Successfully" : "Exit code: \(exitCode)"
        }
        
        // Add session ID to open it when clicked
        content.userInfo = ["sessionId": session.id]
        
        let request = UNNotificationRequest(
            identifier: "session-\(session.id)",
            content: content,
            trigger: nil
        )
        
        do {
            try await UNUserNotificationCenter.current().add(request)
        } catch {
            Logger.logError(Logger.app, "Failed to show notification", error: error)
        }
    }
    
    /// Show a notification for connection status
    func notifyConnectionStatus(connected: Bool, serverURL: URL?) async {
        // Check if notifications are enabled
        guard notificationsEnabled && notifyOnConnectionChange else { return }
        
        // Check if app is in background (unless foreground notifications are enabled)
        guard showNotificationsInForeground || NSApp.isActive == false else { return }
        
        let content = UNMutableNotificationContent()
        content.title = connected ? "Connected to Server" : "Disconnected from Server"
        
        if let serverURL = serverURL {
            content.body = serverURL.host ?? serverURL.absoluteString
        }
        
        if playNotificationSound {
            content.sound = connected ? .default : .defaultCritical
        }
        
        let request = UNNotificationRequest(
            identifier: "connection-status",
            content: content,
            trigger: nil
        )
        
        do {
            try await UNUserNotificationCenter.current().add(request)
        } catch {
            Logger.logError(Logger.app, "Failed to show notification", error: error)
        }
    }
    
    /// Show a generic notification
    nonisolated func showNotification(title: String, body: String, sound: UNNotificationSound? = .default) async {
        // Capture sound value before MainActor
        let isErrorSound = sound == .defaultCritical
        
        // Check preferences on MainActor
        let shouldShowNotification = await MainActor.run {
            guard notificationsEnabled else { return false }
            
            // If this is an error notification, check error preference
            if isErrorSound && !notifyOnErrors { return false }
            
            // Check if app is in background (unless foreground notifications are enabled)
            return showNotificationsInForeground || NSApp.isActive == false
        }
        
        guard shouldShowNotification else { return }
        
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        
        // Check sound preference on MainActor
        let shouldPlaySound = await MainActor.run { playNotificationSound }
        if shouldPlaySound, let sound = sound {
            content.sound = sound
        }
        
        let request = UNNotificationRequest(
            identifier: UUID().uuidString,
            content: content,
            trigger: nil
        )
        
        do {
            try await UNUserNotificationCenter.current().add(request)
        } catch {
            Logger.logError(Logger.app, "Failed to show notification", error: error)
        }
    }
}

// MARK: - UNUserNotificationCenterDelegate

extension NotificationManager: UNUserNotificationCenterDelegate {
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        // Check if we should show notifications in foreground
        let shouldShow = await MainActor.run { showNotificationsInForeground }
        
        if shouldShow {
            return [.banner, .sound]
        } else {
            return []
        }
    }
    
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        // Handle notification tap
        let userInfo = response.notification.request.content.userInfo
        
        if let sessionId = userInfo["sessionId"] as? String {
            // Open the session window
            await MainActor.run {
                if NSApp.keyWindow != nil {
                    // Try to navigate to the session
                    NotificationCenter.default.post(
                        name: .openSession,
                        object: nil,
                        userInfo: ["sessionId": sessionId]
                    )
                }
            }
        }
    }
}

// MARK: - Notification Names

extension Notification.Name {
    static let openSession = Notification.Name("openSession")
}