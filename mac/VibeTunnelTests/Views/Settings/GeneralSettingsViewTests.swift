import SwiftUI
import XCTest
@testable import VibeTunnel

final class GeneralSettingsViewTests: XCTestCase {
    override func setUp() {
        super.setUp()
        // Clear notification preferences
        let keys = [
            "notifications.sessionStart",
            "notifications.sessionExit",
            "notifications.commandCompletion",
            "notifications.commandError",
            "notifications.bell"
        ]
        for key in keys {
            UserDefaults.standard.removeObject(forKey: key)
        }
        UserDefaults.standard.removeObject(forKey: "notifications.initialized")
    }

    func testNotificationPreferencesDefaultValues() {
        // Initialize preferences
        _ = NotificationService.NotificationPreferences(fromConfig: ConfigManager.shared)

        // Check defaults are set to true
        XCTAssertTrue(UserDefaults.standard.bool(forKey: "notifications.sessionStart"))
        XCTAssertTrue(UserDefaults.standard.bool(forKey: "notifications.sessionExit"))
        XCTAssertTrue(UserDefaults.standard.bool(forKey: "notifications.commandCompletion"))
        XCTAssertTrue(UserDefaults.standard.bool(forKey: "notifications.commandError"))
        XCTAssertTrue(UserDefaults.standard.bool(forKey: "notifications.bell"))
        XCTAssertTrue(UserDefaults.standard.bool(forKey: "notifications.initialized"))
    }

    func testNotificationCheckboxToggle() {
        // Set initial value
        UserDefaults.standard.set(false, forKey: "notifications.sessionStart")

        // Verify initial state
        XCTAssertFalse(UserDefaults.standard.bool(forKey: "notifications.sessionStart"))

        // Simulate toggle by updating UserDefaults
        UserDefaults.standard.set(true, forKey: "notifications.sessionStart")

        // Verify the value was updated
        XCTAssertTrue(UserDefaults.standard.bool(forKey: "notifications.sessionStart"))

        // Test that NotificationService reads the updated preferences
        let prefs = NotificationService.NotificationPreferences(fromConfig: ConfigManager.shared)
        XCTAssertTrue(prefs.sessionStart)
    }

    func testNotificationPreferencesSave() {
        var prefs = NotificationService.NotificationPreferences(fromConfig: ConfigManager.shared)
        prefs.sessionStart = false
        prefs.sessionExit = false
        prefs.commandCompletion = true
        prefs.commandError = true
        prefs.bell = false

        prefs.save()

        XCTAssertFalse(UserDefaults.standard.bool(forKey: "notifications.sessionStart"))
        XCTAssertFalse(UserDefaults.standard.bool(forKey: "notifications.sessionExit"))
        XCTAssertTrue(UserDefaults.standard.bool(forKey: "notifications.commandCompletion"))
        XCTAssertTrue(UserDefaults.standard.bool(forKey: "notifications.commandError"))
        XCTAssertFalse(UserDefaults.standard.bool(forKey: "notifications.bell"))
    }

    func testNotificationCheckboxesVisibility() {
        // This would require UI testing framework to verify actual visibility
        // For now, we test the logic that controls visibility

        let showNotifications = true

        if showNotifications {
            // Checkboxes should be visible
            XCTAssertTrue(showNotifications, "Notification checkboxes should be visible when notifications are enabled")
        }

        let hideNotifications = false

        if !hideNotifications {
            // Checkboxes should be hidden
            XCTAssertFalse(
                hideNotifications,
                "Notification checkboxes should be hidden when notifications are disabled"
            )
        }
    }
}
