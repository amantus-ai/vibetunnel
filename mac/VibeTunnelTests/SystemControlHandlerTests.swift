import Foundation
import Testing
@testable import VibeTunnel

@Suite("System Control Handler Tests", .serialized)
struct SystemControlHandlerTests {
    @MainActor
    @Test("Handles repository path update from web correctly")
    func repositoryPathUpdateFromWeb() async throws {
        // Given - Store original and set test value
        let originalPath = UserDefaults.standard.string(forKey: AppConstants.UserDefaultsKeys.repositoryBasePath)
        defer {
            // Restore original value
            if let original = originalPath {
                UserDefaults.standard.set(original, forKey: AppConstants.UserDefaultsKeys.repositoryBasePath)
            } else {
                UserDefaults.standard.removeObject(forKey: AppConstants.UserDefaultsKeys.repositoryBasePath)
            }
        }

        let initialPath = "~/Projects"
        UserDefaults.standard.set(initialPath, forKey: AppConstants.UserDefaultsKeys.repositoryBasePath)
        UserDefaults.standard.synchronize()

        var systemReadyCalled = false
        let handler = SystemControlHandler(onSystemReady: {
            systemReadyCalled = true
        })

        // Create test message
        let testPath = "/Users/test/Documents/Code"
        let message: [String: Any] = [
            "id": "test-123",
            "type": "request",
            "category": "system",
            "action": "repository-path-update",
            "payload": ["path": testPath, "source": "web"]
        ]
        let messageData = try JSONSerialization.data(withJSONObject: message)

        // When
        let response = await handler.handleMessage(messageData)

        // Then
        #expect(response != nil)

        // Verify response format
        if let responseData = response,
           let responseJson = try? JSONSerialization.jsonObject(with: responseData) as? [String: Any]
        {
            #expect(responseJson["id"] as? String == "test-123")
            #expect(responseJson["type"] as? String == "response")
            #expect(responseJson["category"] as? String == "system")
            #expect(responseJson["action"] as? String == "repository-path-update")

            if let payload = responseJson["payload"] as? [String: Any] {
                #expect(payload["success"] as? Bool == true)
                #expect(payload["path"] as? String == testPath)
            }
        }

        // Allow time for async UserDefaults update
        try await Task.sleep(for: .milliseconds(200))

        // Verify UserDefaults was updated
        let updatedPath = UserDefaults.standard.string(forKey: AppConstants.UserDefaultsKeys.repositoryBasePath)
        #expect(updatedPath == testPath)
    }

    @MainActor
    @Test("Ignores repository path update from non-web sources")
    func ignoresNonWebPathUpdates() async throws {
        // Given - Store original and set test value
        let originalPath = UserDefaults.standard.string(forKey: AppConstants.UserDefaultsKeys.repositoryBasePath)
        defer {
            // Restore original value
            if let original = originalPath {
                UserDefaults.standard.set(original, forKey: AppConstants.UserDefaultsKeys.repositoryBasePath)
            } else {
                UserDefaults.standard.removeObject(forKey: AppConstants.UserDefaultsKeys.repositoryBasePath)
            }
        }

        let initialPath = "~/Projects"
        UserDefaults.standard.set(initialPath, forKey: AppConstants.UserDefaultsKeys.repositoryBasePath)
        UserDefaults.standard.synchronize()

        let handler = SystemControlHandler()

        // Create test message from Mac source
        let testPath = "/Users/test/Documents/Code"
        let message: [String: Any] = [
            "id": "test-123",
            "type": "request",
            "category": "system",
            "action": "repository-path-update",
            "payload": ["path": testPath, "source": "mac"]
        ]
        let messageData = try JSONSerialization.data(withJSONObject: message)

        // When
        let response = await handler.handleMessage(messageData)

        // Then - Should still respond with success
        #expect(response != nil)

        // Allow time for any potential UserDefaults update
        try await Task.sleep(for: .milliseconds(200))

        // Verify UserDefaults was NOT updated
        let currentPath = UserDefaults.standard.string(forKey: AppConstants.UserDefaultsKeys.repositoryBasePath)
        #expect(currentPath == initialPath)
    }

    @MainActor
    @Test("Handles invalid repository path update format")
    func invalidPathUpdateFormat() async throws {
        let handler = SystemControlHandler()

        // Create invalid message (missing path)
        let message: [String: Any] = [
            "id": "test-123",
            "type": "request",
            "category": "system",
            "action": "repository-path-update",
            "payload": ["source": "web"]
        ]
        let messageData = try JSONSerialization.data(withJSONObject: message)

        // When
        let response = await handler.handleMessage(messageData)

        // Then
        #expect(response != nil)

        // Verify error response
        if let responseData = response,
           let responseJson = try? JSONSerialization.jsonObject(with: responseData) as? [String: Any]
        {
            #expect(responseJson["error"] != nil)
        }
    }

    @MainActor
    @Test("Posts notifications for loop prevention")
    func loopPreventionNotifications() async throws {
        // Given - Clean state first
        UserDefaults.standard.removeObject(forKey: AppConstants.UserDefaultsKeys.repositoryBasePath)
        UserDefaults.standard.synchronize()

        var disableNotificationPosted = false
        var enableNotificationPosted = false

        // Observe notifications
        let disableObserver = NotificationCenter.default.addObserver(
            forName: .disablePathSync,
            object: nil,
            queue: .main
        ) { _ in
            disableNotificationPosted = true
        }

        let enableObserver = NotificationCenter.default.addObserver(
            forName: .enablePathSync,
            object: nil,
            queue: .main
        ) { _ in
            enableNotificationPosted = true
        }

        defer {
            NotificationCenter.default.removeObserver(disableObserver)
            NotificationCenter.default.removeObserver(enableObserver)
        }

        let handler = SystemControlHandler()

        // Create test message
        let message: [String: Any] = [
            "id": "test-123",
            "type": "request",
            "category": "system",
            "action": "repository-path-update",
            "payload": ["path": "/test/path", "source": "web"]
        ]
        let messageData = try JSONSerialization.data(withJSONObject: message)

        // When
        _ = await handler.handleMessage(messageData)

        // Then - Disable notification should be posted immediately
        #expect(disableNotificationPosted == true)

        // Wait for re-enable
        try await Task.sleep(for: .milliseconds(600))

        // Enable notification should be posted after delay
        #expect(enableNotificationPosted == true)
    }

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
            "action": "ready"
        ]
        let messageData = try JSONSerialization.data(withJSONObject: message)

        // When
        let response = await handler.handleMessage(messageData)

        // Then
        #expect(response == nil) // Events don't return responses
        #expect(systemReadyCalled == true)
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
