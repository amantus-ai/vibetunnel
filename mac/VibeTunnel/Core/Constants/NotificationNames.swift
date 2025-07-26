import Foundation

/// Centralized notification names
extension Notification.Name {
    // MARK: - Settings

    static let showSettings = Notification.Name("sh.vibetunnel.vibetunnel.showSettings")

    // MARK: - Updates

    static let checkForUpdates = Notification.Name("checkForUpdates")

    // MARK: - Welcome

    static let showWelcomeScreen = Notification.Name("showWelcomeScreen")
}

/// Notification categories
enum NotificationCategories {
    static let updateReminder = "UPDATE_REMINDER"
}
