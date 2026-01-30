import Foundation
import Testing
@testable import VibeTunnel

@Suite("System Control Handler Tests", .serialized)
struct SystemControlHandlerTests {
    @MainActor
    @Test("Handles system ready event")
    func systemReadyEvent() async throws {
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
            "action": "ready",
        ]
        let messageValue = JSONValue(any: message)
        let messageData = try JSONEncoder().encode(messageValue)

        // When
        let response = await handler.handleMessage(messageData)

        // Then
        #expect(response == nil) // Events don't return responses
        #expect(systemReadyCalled) // Verify the callback was called
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
            "action": "ping",
        ]
        let messageValue = JSONValue(any: message)
        let messageData = try JSONEncoder().encode(messageValue)

        // When
        let response = await handler.handleMessage(messageData)

        // Then
        #expect(response != nil)

        // Verify ping response
        if let responseData = response,
           let responseJson = JSONValue.decodeObject(from: responseData)
        {
            #expect(responseJson["id"]?.string == "test-123")
            #expect(responseJson["type"]?.string == "response")
            #expect(responseJson["action"]?.string == "ping")
        }
    }
}
