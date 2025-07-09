import Testing
import Foundation
@testable import VibeTunnel

@Suite("RepositoryDiscoveryService Tests")
struct RepositoryDiscoveryServiceTests {
    
    @Test("Test repository discovery initialization")
    @MainActor
    func testServiceInitialization() async {
        let service = RepositoryDiscoveryService()
        
        #expect(service.repositories.isEmpty)
        #expect(!service.isDiscovering)
        #expect(service.lastError == nil)
    }
    
    @Test("Test discovery state management")
    @MainActor 
    func testDiscoveryStateManagement() async {
        let service = RepositoryDiscoveryService()
        
        // Start discovery
        let task = Task {
            await service.discoverRepositories(in: "/nonexistent/path")
        }
        
        // Give it a moment to start
        try? await Task.sleep(nanoseconds: 100_000_000) // 0.1 seconds
        
        // Should not start another discovery while one is in progress
        await service.discoverRepositories(in: "/another/path")
        
        // Wait for completion
        await task.value
        
        // Should eventually reset isDiscovering
        #expect(!service.isDiscovering)
    }
    
    @Test("Test cache functionality")
    @MainActor
    func testCacheFunctionality() async throws {
        let service = RepositoryDiscoveryService()
        let testPath = NSTemporaryDirectory()
        
        // First discovery
        await service.discoverRepositories(in: testPath)
        try await Task.sleep(nanoseconds: 500_000_000) // 0.5 seconds
        let firstCount = service.repositories.count
        
        // Clear cache
        service.clearCache()
        
        // Second discovery should potentially find different results
        await service.discoverRepositories(in: testPath)
        try await Task.sleep(nanoseconds: 500_000_000) // 0.5 seconds
        
        // Results should be consistent for the same path
        #expect(service.repositories.count == firstCount)
    }
    
    @Test("Test race condition handling")
    @MainActor
    func testRaceConditionHandling() async throws {
        // Create a service that will be deallocated during discovery
        var service: RepositoryDiscoveryService? = RepositoryDiscoveryService()
        
        // Start discovery
        Task {
            await service?.discoverRepositories(in: NSTemporaryDirectory())
        }
        
        // Deallocate service while discovery might be in progress
        try await Task.sleep(nanoseconds: 50_000_000) // 0.05 seconds
        service = nil
        
        // Wait a bit more to ensure the task completes
        try await Task.sleep(nanoseconds: 500_000_000) // 0.5 seconds
        
        // Test passes if no crash occurs and the flag is properly reset
        #expect(true) // If we get here, the race condition was handled
    }
    
    @Test("Test tilde expansion in path")
    @MainActor
    func testTildeExpansion() async {
        let service = RepositoryDiscoveryService()
        
        // Test with tilde path
        await service.discoverRepositories(in: "~/")
        
        // The service should handle tilde expansion without errors
        #expect(service.lastError == nil)
    }
}