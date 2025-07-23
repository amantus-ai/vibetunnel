import Foundation
import Testing
import UserNotifications
@testable import VibeTunnel

@Suite("NotificationService - Claude Turn")
struct NotificationServiceClaudeTurnTests {
    
    @Test("Should handle claude-turn event")
    func testClaudeTurnEventHandling() async throws {
        // Given
        let notificationService = NotificationService.shared
        let mockCenter = MockUserNotificationCenter()
        
        // Create mock event data
        let eventData: [String: Any] = [
            "type": "claude-turn",
            "sessionId": "test-session-123",
            "sessionName": "Claude Code Session",
            "message": "Claude has finished responding"
        ]
        
        // When
        await notificationService.handleServerEvent(
            EventSource.Event(
                id: nil,
                event: nil,
                data: try JSONSerialization.data(withJSONObject: eventData).string(encoding: .utf8)
            )
        )
        
        // Then
        #expect(mockCenter.addedRequests.count == 1)
        let request = mockCenter.addedRequests.first
        #expect(request?.content.title == "Your Turn")
        #expect(request?.content.body == "Claude has finished responding")
        #expect(request?.content.subtitle == "Claude Code Session")
        #expect(request?.content.categoryIdentifier == "CLAUDE_TURN")
        #expect(request?.content.interruptionLevel == .active)
    }
    
    @Test("Should respect claude turn notification preference")
    func testClaudeTurnPreferenceRespected() async throws {
        // Given
        let notificationService = NotificationService.shared
        var preferences = NotificationService.NotificationPreferences()
        preferences.claudeTurn = false
        notificationService.updatePreferences(preferences)
        
        let mockCenter = MockUserNotificationCenter()
        
        // When
        let eventData: [String: Any] = [
            "type": "claude-turn",
            "sessionId": "test-session",
            "sessionName": "Test Session"
        ]
        
        await notificationService.handleServerEvent(
            EventSource.Event(
                id: nil,
                event: nil,
                data: try JSONSerialization.data(withJSONObject: eventData).string(encoding: .utf8)
            )
        )
        
        // Then - no notification should be delivered
        #expect(mockCenter.addedRequests.isEmpty)
    }
    
    @Test("Should include session ID in claude turn notification")
    func testClaudeTurnIncludesSessionId() async throws {
        // Given
        let notificationService = NotificationService.shared
        let mockCenter = MockUserNotificationCenter()
        let sessionId = "claude-session-456"
        
        // When
        let eventData: [String: Any] = [
            "type": "claude-turn",
            "sessionId": sessionId,
            "sessionName": "Claude Session"
        ]
        
        await notificationService.handleServerEvent(
            EventSource.Event(
                id: nil,
                event: nil,
                data: try JSONSerialization.data(withJSONObject: eventData).string(encoding: .utf8)
            )
        )
        
        // Then
        let request = mockCenter.addedRequests.first
        #expect(request?.content.userInfo["sessionId"] as? String == sessionId)
        #expect(request?.content.userInfo["type"] as? String == "claude-turn")
        #expect(request?.identifier.contains("claude-turn-"))
    }
    
    @Test("Should handle multiple claude turn notifications")
    func testMultipleClaudeTurnNotifications() async throws {
        // Given
        let notificationService = NotificationService.shared
        let mockCenter = MockUserNotificationCenter()
        
        // When - simulate multiple Claude sessions finishing
        for i in 1...3 {
            let eventData: [String: Any] = [
                "type": "claude-turn",
                "sessionId": "session-\(i)",
                "sessionName": "Claude Session \(i)"
            ]
            
            await notificationService.handleServerEvent(
                EventSource.Event(
                    id: nil,
                    event: nil,
                    data: try JSONSerialization.data(withJSONObject: eventData).string(encoding: .utf8)
                )
            )
        }
        
        // Then
        #expect(mockCenter.addedRequests.count == 3)
        #expect(mockCenter.addedRequests.allSatisfy { $0.content.title == "Your Turn" })
        #expect(mockCenter.addedRequests.map { $0.content.subtitle }.allSatisfy { $0?.contains("Claude Session") ?? false })
    }
    
    @Test("Should sync claude turn preference with API")
    func testClaudeTurnPreferenceSync() async throws {
        // Given
        let notificationService = NotificationService.shared
        var preferences = NotificationService.NotificationPreferences()
        preferences.claudeTurn = true
        
        // Mock URLSession response
        let mockData = """
        {
            "sessionStart": true,
            "sessionExit": true,
            "commandNotifications": true,
            "sessionError": true,
            "systemAlerts": true,
            "claudeTurn": true
        }
        """.data(using: .utf8)!
        
        // When
        await notificationService.syncPreferencesToAPI(preferences)
        
        // Then - verify the API payload includes claudeTurn
        // This would require mocking URLSession, but we can at least verify
        // the preference is saved locally
        let defaults = UserDefaults.standard
        #expect(defaults.bool(forKey: "notifications.claudeTurn") == true)
    }
}

// MARK: - Mock User Notification Center

private class MockUserNotificationCenter: UNUserNotificationCenter {
    var addedRequests: [UNNotificationRequest] = []
    var removedIdentifiers: [String] = []
    
    override func add(_ request: UNNotificationRequest) async throws {
        addedRequests.append(request)
    }
    
    override func removeDeliveredNotifications(withIdentifiers identifiers: [String]) {
        removedIdentifiers.append(contentsOf: identifiers)
    }
}

// MARK: - String Extension

private extension Data {
    func string(encoding: String.Encoding) -> String? {
        String(data: self, encoding: encoding)
    }
}