import Foundation
import Testing
import UserNotifications
@testable import VibeTunnel

@Suite("NotificationService - Claude Turn")
struct NotificationServiceClaudeTurnTests {
    @Test("Should have claude turn preference enabled by default")
    @MainActor
    func claudeTurnDefaultPreference() async throws {
        // Given
        let preferences = NotificationService.NotificationPreferences()

        // Then
        #expect(preferences.claudeTurn == true)
    }

    @Test("Should respect claude turn notification preference")
    @MainActor
    func claudeTurnPreferenceRespected() async throws {
        // Given
        let notificationService = NotificationService.shared
        var preferences = NotificationService.NotificationPreferences()
        preferences.claudeTurn = false
        notificationService.updatePreferences(preferences)

        // Then - verify preference is saved
        let defaults = UserDefaults.standard
        #expect(defaults.bool(forKey: "notifications.claudeTurn") == false)
    }

    @Test("Claude turn preference can be toggled")
    @MainActor
    func claudeTurnPreferenceToggle() async throws {
        // Given
        let notificationService = NotificationService.shared

        // When - enable claude turn notifications
        var preferences = NotificationService.NotificationPreferences()
        preferences.claudeTurn = true
        notificationService.updatePreferences(preferences)

        // Then
        #expect(UserDefaults.standard.bool(forKey: "notifications.claudeTurn") == true)

        // When - disable claude turn notifications
        preferences.claudeTurn = false
        notificationService.updatePreferences(preferences)

        // Then
        #expect(UserDefaults.standard.bool(forKey: "notifications.claudeTurn") == false)
    }

    @Test("Claude turn is included in preference structure")
    func claudeTurnInPreferences() async throws {
        // Given
        var preferences = NotificationService.NotificationPreferences()

        // When
        preferences.claudeTurn = true
        preferences.save()

        // Then - verify it's saved to UserDefaults
        let defaults = UserDefaults.standard
        #expect(defaults.bool(forKey: "notifications.claudeTurn") == true)

        // When - create new preferences instance
        let loadedPreferences = NotificationService.NotificationPreferences()

        // Then - verify it loads the saved value
        #expect(loadedPreferences.claudeTurn == true)
    }
}
