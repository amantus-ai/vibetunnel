import AppKit
import Foundation
import os.log
@preconcurrency import Sparkle
import UserNotifications

/// Delegate for Sparkle's standard user driver that implements gentle update reminders
/// using local notifications for background apps.
@MainActor
final class SparkleUserDriverDelegate: NSObject, @preconcurrency SPUStandardUserDriverDelegate {
    private let logger = os.Logger(
        subsystem: BundleIdentifiers.loggerSubsystem,
        category: "SparkleUserDriver")

    private var pendingUpdate: SUAppcastItem?
    private var reminderTimer: Timer?
    private var lastReminderDate: Date?
    private var notificationIdentifier: String?

    // Configuration
    private let initialReminderDelay: TimeInterval = 60 * 60 * 24 // 24 hours
    private let subsequentReminderInterval: TimeInterval = 60 * 60 * 24 * 3 // 3 days

    override init() {
        super.init()
        self.setupNotificationCategories()
    }

    // MARK: - SPUStandardUserDriverDelegate

    /// Required to eliminate the "no user driver delegate" warning for background apps
    var supportsGentleScheduledUpdateReminders: Bool {
        true
    }

    /// Called to determine if Sparkle should handle showing the update
    func standardUserDriverShouldHandleShowingScheduledUpdate(
        _ update: SUAppcastItem,
        andInImmediateFocus immediateFocus: Bool)
        -> Bool
    {
        self.logger.info("Should handle showing update: \(update.displayVersionString), immediate: \(immediateFocus)")

        // Store the pending update for reminders
        self.pendingUpdate = update

        // If it's not immediate focus and we have a pending update, schedule a reminder
        if !immediateFocus {
            self.scheduleGentleReminder(for: update)
        }

        // Let Sparkle handle showing the update UI
        return true
    }

    /// Called before an update is shown
    func standardUserDriverWillHandleShowingUpdate(
        _ handleShowingUpdate: Bool,
        forUpdate update: SUAppcastItem,
        state: SPUUserUpdateState)
    {
        self.logger.info("Will show update: \(update.displayVersionString), userInitiated: \(state.userInitiated)")

        // If this is a user-initiated check or the update is being shown, cancel reminders
        if state.userInitiated || handleShowingUpdate {
            self.cancelReminders()
        }
    }

    /// Called when user first interacts with the update
    func standardUserDriverDidReceiveUserAttention(forUpdate update: SUAppcastItem) {
        self.logger.info("User gave attention to update: \(update.displayVersionString)")

        // Cancel any pending reminders since user has seen the update
        self.cancelReminders()

        // Remove any existing notifications
        if let identifier = notificationIdentifier {
            UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [identifier])
        }
    }

    /// Called when update session ends
    func standardUserDriverWillFinishUpdateSession() {
        self.logger.info("Update session ending")

        // Clean up
        self.pendingUpdate = nil
        self.cancelReminders()
    }

    /// Called before showing a modal alert
    func standardUserDriverWillShowModalAlert() {
        self.logger.debug("Will show modal alert")
    }

    /// Called after showing a modal alert
    func standardUserDriverDidShowModalAlert() {
        self.logger.debug("Did show modal alert")
    }

    // MARK: - Gentle Reminders

    private func setupNotificationCategories() {
        let updateAction = UNNotificationAction(
            identifier: "UPDATE_ACTION",
            title: "Update Now",
            options: [.foreground])

        let laterAction = UNNotificationAction(
            identifier: "LATER_ACTION",
            title: "Remind Me Later",
            options: [])

        let category = UNNotificationCategory(
            identifier: "UPDATE_REMINDER",
            actions: [updateAction, laterAction],
            intentIdentifiers: [],
            options: [])

        UNUserNotificationCenter.current().setNotificationCategories([category])
    }

    private func scheduleGentleReminder(for update: SUAppcastItem) {
        // Cancel any existing reminder
        self.reminderTimer?.invalidate()

        // Determine the delay for the next reminder
        let delay: TimeInterval = if self.lastReminderDate == nil {
            // First reminder
            self.initialReminderDelay
        } else {
            // Subsequent reminders
            self.subsequentReminderInterval
        }

        self.logger
            .info("Scheduling gentle reminder in \(delay / 3600) hours for version \(update.displayVersionString)")

        // Schedule the reminder
        let versionString = update.displayVersionString
        self.reminderTimer = Timer.scheduledTimer(withTimeInterval: delay, repeats: false) { [weak self] _ in
            Task { @MainActor in
                self?.showReminderNotificationForVersion(versionString)
            }
        }
    }

    private func showReminderNotificationForVersion(_ versionString: String) {
        self.lastReminderDate = Date()

        // Create notification content
        let content = UNMutableNotificationContent()
        content.title = "Update Available"
        content.body = "VibeTunnel \(versionString) is ready to install."
        content.sound = .default
        content.categoryIdentifier = "UPDATE_REMINDER"

        // Add action button
        content.userInfo = ["updateVersion": versionString]

        // Create unique identifier
        let timestamp = Date().timeIntervalSince1970
        let identifier = "vibetunnel-update-\(versionString)-\(timestamp)"
        self.notificationIdentifier = identifier

        // Create the request
        let request = UNNotificationRequest(
            identifier: identifier,
            content: content,
            trigger: nil, // Show immediately
        )

        // Schedule the notification
        UNUserNotificationCenter.current().add(request) { [weak self] error in
            if let error {
                self?.logger.error("Failed to schedule notification: \(error)")
            } else {
                self?.logger.info("Scheduled reminder notification for version \(versionString)")

                // Schedule the next reminder if we still have a pending update
                Task { @MainActor in
                    if let pendingUpdate = self?.pendingUpdate {
                        self?.scheduleGentleReminder(for: pendingUpdate)
                    }
                }
            }
        }
    }

    private func cancelReminders() {
        self.reminderTimer?.invalidate()
        self.reminderTimer = nil
        self.lastReminderDate = nil
    }

    // MARK: - Notification Handling

    func handleNotificationAction(_ action: String, userInfo: [AnyHashable: Any]) {
        switch action {
        case "UPDATE_ACTION":
            self.logger.info("User tapped 'Update Now' in notification")
            // Bring app to foreground and trigger update check
            NSApp.activate(ignoringOtherApps: true)
            // The SparkleUpdaterManager will handle the actual update check
            SparkleUpdaterManager.shared.checkForUpdates()

        case "LATER_ACTION":
            self.logger.info("User tapped 'Remind Me Later' in notification")
        // The next reminder is already scheduled

        default:
            break
        }
    }
}
