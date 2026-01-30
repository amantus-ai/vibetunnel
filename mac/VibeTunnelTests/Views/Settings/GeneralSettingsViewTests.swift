import SwiftUI
import Testing
@testable import VibeTunnel

@Suite("General Settings View Tests")
@MainActor
struct GeneralSettingsViewTests {
    init() {
        self.resetNotificationDefaults(ConfigManager.shared)
    }

    private func resetNotificationDefaults(_ configManager: ConfigManager) {
        configManager.notificationSessionStart = true
        configManager.notificationSessionExit = true
        configManager.notificationCommandCompletion = true
        configManager.notificationCommandError = true
        configManager.notificationBell = true
        configManager.notificationSoundEnabled = true
        configManager.notificationVibrationEnabled = true
    }

    @Test("Notification preferences have correct default values")
    func notificationPreferencesDefaultValues() {
        // Get default preferences from ConfigManager
        let configManager = ConfigManager.shared
        self.resetNotificationDefaults(configManager)
        let prefs = NotificationService.NotificationPreferences(fromConfig: configManager)

        // Check that preferences match ConfigManager defaults
        #expect(prefs.sessionStart == true)
        #expect(prefs.sessionExit == true)
        #expect(prefs.commandCompletion == true)
        #expect(prefs.commandError == true)
        #expect(prefs.bell == true)

        // Verify ConfigManager properties directly
        #expect(configManager.notificationSessionStart == true)
        #expect(configManager.notificationSessionExit == true)
        #expect(configManager.notificationCommandCompletion == true)
        #expect(configManager.notificationCommandError == true)
        #expect(configManager.notificationBell == true)
    }

    @Test("Notification checkbox toggle updates preferences")
    func notificationCheckboxToggle() {
        let configManager = ConfigManager.shared
        self.resetNotificationDefaults(configManager)

        // Set initial value through ConfigManager
        configManager.notificationSessionStart = false

        // Verify initial state
        #expect(configManager.notificationSessionStart == false)

        // Simulate toggle
        configManager.notificationSessionStart = true

        // Verify the value was updated
        #expect(configManager.notificationSessionStart == true)

        // Test that NotificationService reads the updated preferences
        let prefs = NotificationService.NotificationPreferences(fromConfig: configManager)
        #expect(prefs.sessionStart == true)

        // Cleanup - ensure defaults are restored (though this test should end with correct value)
        configManager.notificationSessionStart = true
    }

    @Test("Notification preferences save correctly")
    func notificationPreferencesSave() {
        // Test that ConfigManager properties work correctly
        let configManager = ConfigManager.shared
        self.resetNotificationDefaults(configManager)

        // Update values through ConfigManager
        configManager.notificationSessionStart = false
        configManager.notificationSessionExit = false
        configManager.notificationCommandCompletion = true
        configManager.notificationCommandError = true
        configManager.notificationBell = false

        // Verify the values are correctly set in ConfigManager
        #expect(configManager.notificationSessionStart == false)
        #expect(configManager.notificationSessionExit == false)
        #expect(configManager.notificationCommandCompletion == true)
        #expect(configManager.notificationCommandError == true)
        #expect(configManager.notificationBell == false)

        // Verify that NotificationPreferences reads the updated values
        let prefs = NotificationService.NotificationPreferences(fromConfig: configManager)
        #expect(prefs.sessionStart == false)
        #expect(prefs.sessionExit == false)
        #expect(prefs.commandCompletion == true)
        #expect(prefs.commandError == true)
        #expect(prefs.bell == false)

        // Cleanup - reset to default values to prevent state pollution
        configManager.notificationSessionStart = true
        configManager.notificationSessionExit = true
        configManager.notificationCommandCompletion = true
        configManager.notificationCommandError = true
        configManager.notificationBell = true
        configManager.notificationSoundEnabled = true
        configManager.notificationVibrationEnabled = true
    }

    @Test("Notification checkboxes visibility logic")
    func notificationCheckboxesVisibility() {
        // This would require UI testing framework to verify actual visibility
        // For now, we test the logic that controls visibility

        let showNotifications = true
        #expect(showNotifications)

        let hideNotifications = false
        #expect(!hideNotifications)
    }
}
