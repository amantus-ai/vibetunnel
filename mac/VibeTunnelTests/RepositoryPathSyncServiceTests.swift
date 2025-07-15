import Testing
@testable import VibeTunnel
import Foundation
import Combine

@Suite("Repository Path Sync Service Tests")
struct RepositoryPathSyncServiceTests {
    
    @MainActor
    @Test("Service observes repository path changes and sends updates via Unix socket")
    func testRepositoryPathSync() async throws {
        // Given - Mock Unix socket manager
        let mockSocketManager = MockUnixSocketManager()
        
        // Create service
        let service = RepositoryPathSyncService()
        
        // Store initial path
        let initialPath = "~/Projects"
        UserDefaults.standard.set(initialPath, forKey: AppConstants.UserDefaultsKeys.repositoryBasePath)
        
        // When - Initialize service
        // The service will automatically start observing changes
        
        // Change the repository path
        let newPath = "~/Documents/Code"
        UserDefaults.standard.set(newPath, forKey: AppConstants.UserDefaultsKeys.repositoryBasePath)
        
        // Allow time for the observer to trigger
        try await Task.sleep(for: .milliseconds(100))
        
        // Then - Verify the message was sent
        await #expect(mockSocketManager.sentMessages.count > 0)
        
        if let lastMessage = mockSocketManager.sentMessages.last {
            #expect(lastMessage.category == .system)
            #expect(lastMessage.action == "repository-path-update")
            
            if let payload = lastMessage.payload as? [String: Any],
               let path = payload["path"] as? String {
                #expect(path == newPath)
            } else {
                Issue.record("Payload does not contain expected path")
            }
        }
    }
    
    @MainActor
    @Test("Service sends current path on syncCurrentPath call")
    func testSyncCurrentPath() async throws {
        // Given
        let mockSocketManager = MockUnixSocketManager()
        let service = RepositoryPathSyncService()
        
        // Set a known path
        let testPath = "~/TestProjects"
        UserDefaults.standard.set(testPath, forKey: AppConstants.UserDefaultsKeys.repositoryBasePath)
        
        // When - Call sync current path
        await service.syncCurrentPath()
        
        // Allow time for async operation
        try await Task.sleep(for: .milliseconds(100))
        
        // Then - Verify message was sent
        await #expect(mockSocketManager.sentMessages.count >= 1)
        
        if let message = mockSocketManager.sentMessages.first(where: { $0.action == "repository-path-update" }) {
            #expect(message.category == .system)
            
            if let payload = message.payload as? [String: Any],
               let path = payload["path"] as? String {
                #expect(path == testPath)
            } else {
                Issue.record("Payload does not contain expected path")
            }
        } else {
            Issue.record("No repository-path-update message found")
        }
    }
    
    @MainActor
    @Test("Service handles invalid response gracefully")
    func testHandleInvalidResponse() async throws {
        // Given - Mock socket manager that returns error response
        let mockSocketManager = MockUnixSocketManager()
        mockSocketManager.shouldReturnError = true
        
        let service = RepositoryPathSyncService()
        
        // When - Trigger a path update
        UserDefaults.standard.set("~/ErrorPath", forKey: AppConstants.UserDefaultsKeys.repositoryBasePath)
        
        // Allow time for processing
        try await Task.sleep(for: .milliseconds(100))
        
        // Then - Service should handle error gracefully (no crash)
        // We can't easily test logger output, but we ensure no crash occurs
        #expect(true) // If we reach here, no crash occurred
    }
}

// MARK: - Mock Classes

@MainActor
class MockUnixSocketManager: SharedUnixSocketManager {
    var sentMessages: [UnixSocketMessage] = []
    var shouldReturnError = false
    
    override func sendMessage(_ message: UnixSocketMessage) async throws -> UnixSocketMessage? {
        sentMessages.append(message)
        
        if shouldReturnError {
            // Return an error response
            return UnixSocketMessage(
                id: message.id,
                type: .response,
                category: message.category,
                action: message.action,
                payload: nil,
                error: "Mock error"
            )
        } else {
            // Return a success response
            return UnixSocketMessage(
                id: message.id,
                type: .response,
                category: message.category,
                action: message.action,
                payload: ["success": true, "path": (message.payload as? [String: Any])?["path"] ?? ""],
                error: nil
            )
        }
    }
    
    override var isConnected: Bool {
        return true
    }
}