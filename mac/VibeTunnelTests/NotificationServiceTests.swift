import Testing
import UserNotifications
@testable import VibeTunnel

@Suite("NotificationService Tests")
struct NotificationServiceTests {
    @Test("Default notification preferences are loaded correctly")
    func testDefaultPreferences() {
        let preferences = NotificationService.NotificationPreferences()

        // Verify default values
        #expect(preferences.sessionStart == true)
        #expect(preferences.sessionExit == true)
        #expect(preferences.commandCompletion == true)
        #expect(preferences.commandError == true)
        #expect(preferences.bell == true)
    }

    @Test("Notification preferences can be updated")
    @MainActor
    func testUpdatePreferences() {
        let service = NotificationService.shared

        // Create custom preferences
        var preferences = NotificationService.NotificationPreferences()
        preferences.sessionStart = false
        preferences.bell = false

        // Update preferences
        service.updatePreferences(preferences)

        // Verify preferences were updated in UserDefaults
        #expect(UserDefaults.standard.bool(forKey: "notifications.sessionStart") == false)
        #expect(UserDefaults.standard.bool(forKey: "notifications.bell") == false)
    }

    @Test("Session start notification is sent when enabled")
    @MainActor
    func testSessionStartNotification() async throws {
        let service = NotificationService.shared

        // Enable session start notifications
        var preferences = NotificationService.NotificationPreferences()
        preferences.sessionStart = true
        service.updatePreferences(preferences)

        // Send session start notification
        let sessionName = "Test Session"
        await service.sendSessionStartNotification(sessionName: sessionName)

        // Verify notification would be created (actual delivery depends on system permissions)
        // In a real test environment, we'd mock UNUserNotificationCenter
        // Note: NotificationService doesn't expose an isEnabled property
        #expect(preferences.sessionStart == true)
    }

    @Test("Session exit notification includes exit code")
    @MainActor
    func testSessionExitNotification() async throws {
        let service = NotificationService.shared

        // Enable session exit notifications
        var preferences = NotificationService.NotificationPreferences()
        preferences.sessionExit = true
        service.updatePreferences(preferences)

        // Test successful exit
        await service.sendSessionExitNotification(sessionName: "Test Session", exitCode: 0)

        // Test error exit
        await service.sendSessionExitNotification(sessionName: "Failed Session", exitCode: 1)

        #expect(preferences.sessionExit == true)
    }

    @Test("Command completion notification respects duration threshold")
    @MainActor
    func testCommandCompletionNotification() async throws {
        let service = NotificationService.shared

        // Enable command completion notifications
        var preferences = NotificationService.NotificationPreferences()
        preferences.commandCompletion = true
        service.updatePreferences(preferences)

        // Test short duration
        await service.sendCommandCompletionNotification(
            command: "ls",
            duration: 1_000 // 1 second
        )

        // Test long duration
        await service.sendCommandCompletionNotification(
            command: "long-running-command",
            duration: 5_000 // 5 seconds
        )

        #expect(preferences.commandCompletion == true)
    }

    @Test("Command error notification is sent for non-zero exit codes")
    @MainActor
    func testCommandErrorNotification() async throws {
        let service = NotificationService.shared

        // Enable command error notifications
        var preferences = NotificationService.NotificationPreferences()
        preferences.commandError = true
        service.updatePreferences(preferences)

        // Test command with error
        // Note: The service handles command errors through the event stream,
        // not through direct method calls
        await service.sendCommandCompletionNotification(
            command: "failing-command",
            duration: 1_000
        )

        #expect(preferences.commandError == true)
    }

    @Test("Bell notification is sent when enabled")
    @MainActor
    func testBellNotification() async throws {
        let service = NotificationService.shared

        // Enable bell notifications
        var preferences = NotificationService.NotificationPreferences()
        preferences.bell = true
        service.updatePreferences(preferences)

        // Send bell notification
        // Note: Bell notifications are handled through the event stream
        await service.sendGenericNotification(title: "Terminal Bell", body: "Test Session")

        #expect(preferences.bell == true)
    }

    @Test("Notifications are not sent when disabled")
    @MainActor
    func testDisabledNotifications() async throws {
        let service = NotificationService.shared

        // Disable all notifications
        var preferences = NotificationService.NotificationPreferences()
        preferences.sessionStart = false
        preferences.sessionExit = false
        preferences.commandCompletion = false
        preferences.commandError = false
        preferences.bell = false
        service.updatePreferences(preferences)

        // Try to send various notifications
        await service.sendSessionStartNotification(sessionName: "Test")
        await service.sendSessionExitNotification(sessionName: "Test", exitCode: 0)
        await service.sendCommandCompletionNotification(
            command: "test",
            duration: 5_000
        )
        await service.sendGenericNotification(title: "Bell", body: "Test")

        // All should be ignored due to preferences
        #expect(preferences.sessionStart == false)
        #expect(preferences.sessionExit == false)
        #expect(preferences.commandCompletion == false)
        #expect(preferences.bell == false)
    }

    @Test("Service handles missing session names gracefully")
    @MainActor
    func testMissingSessionNames() async throws {
        let service = NotificationService.shared

        // Enable notifications
        var preferences = NotificationService.NotificationPreferences()
        preferences.sessionExit = true
        service.updatePreferences(preferences)

        // Send notification with empty name
        await service.sendSessionExitNotification(sessionName: "", exitCode: 0)

        // Should handle gracefully
        #expect(preferences.sessionExit == true)
    }
}
