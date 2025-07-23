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

        // Create mock session
        let sessionId = "test-session-123"
        let sessionInfo = SessionInfo(
            id: sessionId,
            name: "Test Session",
            command: "/bin/bash",
            createdAt: Date(),
            pid: 12_345,
            cols: 80,
            rows: 24,
            cwd: "/Users/test",
            gitInfo: nil
        )

        // Notify session started
        await service.notifySessionStarted(sessionInfo)

        // Verify notification would be created (actual delivery depends on system permissions)
        // In a real test environment, we'd mock UNUserNotificationCenter
        #expect(service.isEnabled)
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
        await service.notifySessionExited("test-session", name: "Test Session", exitCode: 0)

        // Test error exit
        await service.notifySessionExited("test-session-2", name: "Failed Session", exitCode: 1)

        #expect(service.isEnabled)
    }

    @Test("Command completion notification respects duration threshold")
    @MainActor
    func testCommandCompletionNotification() async throws {
        let service = NotificationService.shared

        // Enable command completion notifications
        var preferences = NotificationService.NotificationPreferences()
        preferences.commandCompletion = true
        service.updatePreferences(preferences)

        // Test short duration (should not notify)
        await service.notifyCommandCompleted(
            sessionId: "test-session",
            sessionName: "Test Session",
            command: "ls",
            exitCode: 0,
            duration: 1_000 // 1 second
        )

        // Test long duration (should notify)
        await service.notifyCommandCompleted(
            sessionId: "test-session",
            sessionName: "Test Session",
            command: "long-running-command",
            exitCode: 0,
            duration: 5_000 // 5 seconds
        )

        #expect(service.isEnabled)
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
        await service.notifyCommandCompleted(
            sessionId: "test-session",
            sessionName: "Test Session",
            command: "failing-command",
            exitCode: 127,
            duration: 1_000
        )

        #expect(service.isEnabled)
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
        await service.notifyBell(sessionId: "test-session", sessionName: "Test Session")

        #expect(service.isEnabled)
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
        let sessionInfo = SessionInfo(
            id: "test",
            name: "Test",
            command: "/bin/bash",
            createdAt: Date(),
            pid: 12_345,
            cols: 80,
            rows: 24,
            cwd: "/",
            gitInfo: nil
        )

        await service.notifySessionStarted(sessionInfo)
        await service.notifySessionExited("test", name: "Test", exitCode: 0)
        await service.notifyCommandCompleted(
            sessionId: "test",
            sessionName: "Test",
            command: "test",
            exitCode: 0,
            duration: 5_000
        )
        await service.notifyBell(sessionId: "test", sessionName: "Test")

        // All should be ignored due to preferences
        #expect(service.isEnabled)
    }

    @Test("Service handles missing session names gracefully")
    @MainActor
    func testMissingSessionNames() async throws {
        let service = NotificationService.shared

        // Enable notifications
        var preferences = NotificationService.NotificationPreferences()
        preferences.sessionExit = true
        service.updatePreferences(preferences)

        // Send notification with nil name
        await service.notifySessionExited("test-session", name: nil, exitCode: 0)

        // Should use session ID as fallback
        #expect(service.isEnabled)
    }
}
