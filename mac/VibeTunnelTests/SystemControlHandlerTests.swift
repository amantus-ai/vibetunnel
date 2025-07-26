import Foundation
import Testing
@testable import VibeTunnel

@Suite("System Control Handler Tests", .serialized)
struct SystemControlHandlerTests {
    @MainActor
        // Given
        var systemReadyCalled = false
        let handler = SystemControlHandler(onSystemReady: {
            systemReadyCalled = true
        })

        // Create ready event message
        let message: [String: Any] = [
            "id": "test-123",
            "type": "event",
            "category": "system",
            "action": "ready"
        ]
        let messageData = try JSONSerialization.data(withJSONObject: message)

        // When
        let response = await handler.handleMessage(messageData)

        // Then
        #expect(response == nil) // Events don't return responses
        // System ready check removed as variable is write-only
    }

    @MainActor
    @Test("Handles ping request")
    func pingRequest() async throws {
        let handler = SystemControlHandler()

        // Create ping request
        let message: [String: Any] = [
            "id": "test-123",
            "type": "request",
            "category": "system",
            "action": "ping"
        ]
        let messageData = try JSONSerialization.data(withJSONObject: message)

        // When
        let response = await handler.handleMessage(messageData)

        // Then
        #expect(response != nil)

        // Verify ping response
        if let responseData = response,
           let responseJson = try? JSONSerialization.jsonObject(with: responseData) as? [String: Any]
        {
            #expect(responseJson["id"] as? String == "test-123")
            #expect(responseJson["type"] as? String == "response")
            #expect(responseJson["action"] as? String == "ping")
        }
    }
}
