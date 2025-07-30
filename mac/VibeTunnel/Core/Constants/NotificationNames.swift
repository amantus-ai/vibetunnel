import Foundation

/// Centralized notification names
extension Notification.Name {
    // MARK: - Settings

    static let showSettings = Notification.Name("\(BundleIdentifiers.vibeTunnel).showSettings")

    // MARK: - Updates

    static let checkForUpdates = Notification.Name("checkForUpdates")

    // MARK: - Welcome

    static let showWelcomeScreen = Notification.Name("showWelcomeScreen")

    // MARK: - Services

    static let notificationServiceConnectionChanged = Notification.Name("notificationServiceConnectionChanged")
}

/// Notification categories for user notifications.
///
/// Contains category identifiers used when registering and handling
/// notifications in the Notification Center.
enum NotificationCategories {
    static let updateReminder = "UPDATE_REMINDER"
}
