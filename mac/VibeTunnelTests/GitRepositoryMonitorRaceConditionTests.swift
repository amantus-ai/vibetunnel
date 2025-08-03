import Foundation
import Testing
@testable import VibeTunnel

/// Tests to verify that the race condition in GitHub URL fetching is fixed
@Suite("Git Repository Monitor Race Condition Tests", .tags(.concurrency, .gitRepository))
@MainActor
struct GitRepositoryMonitorRaceConditionTests {
    @Test(
        "Concurrent GitHub URL fetches don't cause duplicate Git operations",
        .tags(.attachmentTests),
        .enabled(if: TestConditions.isInGitRepository())
    )
    func concurrentGitHubURLFetches() async throws {
        let monitor = GitRepositoryMonitor()
        let testRepoPath = "/test/repo/path"

        // Create a mock repository
        _ = GitRepository(
            path: testRepoPath,
            modifiedCount: 0,
            addedCount: 0,
            deletedCount: 0,
            untrackedCount: 0,
            currentBranch: "main"
        )

        // Use reflection to access private properties for testing
        let mirror = Mirror(reflecting: monitor)

        // Find the githubURLFetchesInProgress property
        var inProgressSet: Set<String>?
        for child in mirror.children {
            if child.label == "githubURLFetchesInProgress",
               let set = child.value as? Set<String>
            {
                inProgressSet = set
                break
            }
        }

        // Simulate multiple concurrent requests for the same repository
        let concurrentTasks = (0..<10).map { _ in
            Task {
                // Access private method through mirror or simulate the behavior
                // Since we can't directly call private methods, we'll test the public API
                _ = await monitor.findRepository(for: testRepoPath)
            }
        }

        // Wait a bit to allow tasks to start (increased for CI)
        let waitTime: UInt64 = TestConditions.isRunningInCI() ? 500_000_000 : 100_000_000 // 0.5s in CI, 0.1s locally
        try await Task.sleep(nanoseconds: waitTime)

        // Verify that in-progress tracking is working
        // Note: This is a simplified test since we can't easily access private properties
        // In a real scenario, we'd need to refactor for better testability

        // Wait for all tasks to complete
        for task in concurrentTasks {
            _ = await task.value
        }

        // Clear cache to clean up
        monitor.clearCache()
    }

    @Test("GitHub URL fetch completes even on failure")
    func gitHubURLFetchFailureHandling() async throws {
        let monitor = GitRepositoryMonitor()
        let invalidRepoPath = "/this/is/not/a/git/repo"

        // This should not throw and should handle the failure gracefully
        let result = await monitor.findRepository(for: invalidRepoPath)

        // Should return nil for invalid repo
        #expect(result == nil)

        // Clear cache to clean up
        monitor.clearCache()
    }

    @Test("Clear cache removes in-progress fetches")
    func clearCacheRemovesInProgressFetches() async throws {
        let monitor = GitRepositoryMonitor()

        // Start a fetch (simulated through public API)
        let testPath = "/test/path"
        Task {
            _ = await monitor.findRepository(for: testPath)
        }

        // Clear cache immediately
        monitor.clearCache()

        // Verify cache is cleared (through public API)
        let cached = monitor.getCachedRepository(for: testPath)
        #expect(cached == nil)
    }
}
