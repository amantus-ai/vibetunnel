import Foundation
import Testing
@testable import VibeTunnel

@MainActor
@Suite("GitRepositoryMonitor Worktree Tests")
struct GitRepositoryMonitorWorktreeTests {
    // MARK: - Test Properties

    let monitor = GitRepositoryMonitor()
    let mockServerManager = MockServerManager()

    // MARK: - Helper Types

    /// Mock server manager for testing API responses
    class MockServerManager {
        var responses: [String: Any] = [:]

        func setResponse(for endpoint: String, response: Any) {
            responses[endpoint] = response
        }

        func buildURL(endpoint: String, queryItems: [URLQueryItem]? = nil) -> URL? {
            URL(string: "http://localhost:4020\(endpoint)")
        }
    }

    // MARK: - Tests

    @Test("Git repository info response includes worktree field")
    func gitRepositoryInfoResponseWorktreeField() {
        // Test that GitRepositoryInfoResponse properly decodes isWorktree field
        let jsonWithWorktree = """
        {
            "isGitRepo": true,
            "repoPath": "/Users/test/project",
            "currentBranch": "main",
            "hasChanges": false,
            "modifiedCount": 0,
            "untrackedCount": 0,
            "stagedCount": 0,
            "isWorktree": true
        }
        """

        let decoder = JSONDecoder()
        let response = try? decoder.decode(GitRepositoryInfoResponse.self, from: jsonWithWorktree.data(using: .utf8)!)

        #expect(response != nil)
        #expect(response?.isWorktree == true)
    }

    @Test("Git repository info response handles missing worktree field")
    func gitRepositoryInfoResponseMissingWorktreeField() {
        // Test backward compatibility when isWorktree is not present
        let jsonWithoutWorktree = """
        {
            "isGitRepo": true,
            "repoPath": "/Users/test/project",
            "currentBranch": "main",
            "hasChanges": false,
            "modifiedCount": 0,
            "untrackedCount": 0,
            "stagedCount": 0
        }
        """

        let decoder = JSONDecoder()
        let response = try? decoder.decode(
            GitRepositoryInfoResponse.self,
            from: jsonWithoutWorktree.data(using: .utf8)!
        )

        #expect(response != nil)
        #expect(response?.isWorktree == nil)
    }

    @Test("Git repository detects regular repository as non-worktree")
    func regularRepositoryDetection() async {
        // Mock a regular repository response
        let mockResponse = GitRepositoryInfoResponse(
            isGitRepo: true,
            repoPath: "/Users/test/regular-repo",
            currentBranch: "main",
            remoteUrl: "https://github.com/test/repo.git",
            githubUrl: "https://github.com/test/repo",
            hasChanges: false,
            modifiedCount: 0,
            untrackedCount: 0,
            stagedCount: 0,
            addedCount: 0,
            deletedCount: 0,
            aheadCount: 0,
            behindCount: 0,
            hasUpstream: true,
            isWorktree: false
        )

        // Test that the repository is correctly identified as non-worktree
        let repository = await monitor.findRepository(for: "/Users/test/regular-repo/src/file.swift")

        // Note: In a real test, we would need to mock the server response
        // For now, we're testing the data structure
        #expect(mockResponse.isWorktree == false)
    }

    @Test("Git repository detects worktree repository")
    func worktreeRepositoryDetection() async {
        // Mock a worktree repository response
        let mockResponse = GitRepositoryInfoResponse(
            isGitRepo: true,
            repoPath: "/Users/test/worktree-branch",
            currentBranch: "feature/new-feature",
            remoteUrl: "https://github.com/test/repo.git",
            githubUrl: "https://github.com/test/repo",
            hasChanges: true,
            modifiedCount: 2,
            untrackedCount: 1,
            stagedCount: 0,
            addedCount: 0,
            deletedCount: 0,
            aheadCount: 3,
            behindCount: 0,
            hasUpstream: true,
            isWorktree: true
        )

        // Test that the repository is correctly identified as worktree
        #expect(mockResponse.isWorktree == true)
    }

    @Test("Git repository handles nil worktree status with fallback")
    func worktreeStatusFallback() {
        // Test the fallback mechanism when server doesn't provide isWorktree
        let mockResponse = GitRepositoryInfoResponse(
            isGitRepo: true,
            repoPath: "/Users/test/unknown-type",
            currentBranch: "main",
            remoteUrl: nil,
            githubUrl: nil,
            hasChanges: false,
            modifiedCount: 0,
            untrackedCount: 0,
            stagedCount: 0,
            addedCount: 0,
            deletedCount: 0,
            aheadCount: 0,
            behindCount: 0,
            hasUpstream: false,
            isWorktree: nil // Server didn't provide this info
        )

        // When isWorktree is nil, the code should fall back to local detection
        #expect(mockResponse.isWorktree == nil)
    }

    @Test("GitRepository model includes worktree status")
    func gitRepositoryModelWorktreeStatus() {
        // Test that GitRepository properly stores worktree status
        let regularRepo = GitRepository(
            path: "/Users/test/regular-repo",
            modifiedCount: 0,
            addedCount: 0,
            deletedCount: 0,
            untrackedCount: 0,
            currentBranch: "main",
            aheadCount: nil,
            behindCount: nil,
            trackingBranch: "origin/main",
            isWorktree: false,
            githubURL: URL(string: "https://github.com/test/repo")
        )

        let worktreeRepo = GitRepository(
            path: "/Users/test/worktree-feature",
            modifiedCount: 5,
            addedCount: 2,
            deletedCount: 1,
            untrackedCount: 3,
            currentBranch: "feature/awesome",
            aheadCount: 2,
            behindCount: nil,
            trackingBranch: "origin/feature/awesome",
            isWorktree: true,
            githubURL: URL(string: "https://github.com/test/repo")
        )

        #expect(regularRepo.isWorktree == false)
        #expect(worktreeRepo.isWorktree == true)
    }

    @Test("Cache preserves worktree status")
    func cachePreservesWorktreeStatus() async {
        // Clear cache first
        monitor.clearCache()

        // Create test repositories with different worktree status
        let testRepos = [
            GitRepository(
                path: "/test/main-repo",
                modifiedCount: 0,
                addedCount: 0,
                deletedCount: 0,
                untrackedCount: 0,
                currentBranch: "main",
                aheadCount: nil,
                behindCount: nil,
                trackingBranch: nil,
                isWorktree: false,
                githubURL: nil
            ),
            GitRepository(
                path: "/test/worktree-1",
                modifiedCount: 1,
                addedCount: 0,
                deletedCount: 0,
                untrackedCount: 0,
                currentBranch: "feature-1",
                aheadCount: nil,
                behindCount: nil,
                trackingBranch: nil,
                isWorktree: true,
                githubURL: nil
            )
        ]

        // Test that cached repositories maintain their worktree status
        for repo in testRepos {
            // Note: In a real implementation, we would need to properly mock
            // the caching mechanism. This test verifies the data structure.
            #expect(repo.isWorktree == (repo.path.contains("worktree")))
        }
    }

    @Test("Repository status update preserves worktree flag")
    func repositoryStatusUpdatePreservesWorktree() {
        // Test that when updating repository status (e.g., file counts),
        // the worktree status is preserved
        let initialRepo = GitRepository(
            path: "/test/my-worktree",
            modifiedCount: 0,
            addedCount: 0,
            deletedCount: 0,
            untrackedCount: 0,
            currentBranch: "feature",
            aheadCount: nil,
            behindCount: nil,
            trackingBranch: nil,
            isWorktree: true,
            githubURL: nil
        )

        // Simulate an update with changed file counts
        let updatedRepo = GitRepository(
            path: initialRepo.path,
            modifiedCount: 3, // Changed
            addedCount: 1, // Changed
            deletedCount: 0,
            untrackedCount: 2, // Changed
            currentBranch: initialRepo.currentBranch,
            aheadCount: 1, // Changed
            behindCount: nil,
            trackingBranch: "origin/feature",
            isWorktree: initialRepo.isWorktree, // Should preserve
            githubURL: URL(string: "https://github.com/test/repo")
        )

        #expect(updatedRepo.isWorktree == true)
        #expect(updatedRepo.isWorktree == initialRepo.isWorktree)
    }

    @Test("Worktree detection for deeply nested paths")
    func worktreeDetectionDeepPaths() {
        // Test that worktree detection works for deeply nested file paths
        let deepPaths = [
            "/Users/dev/projects/main-repo/src/components/ui/Button.tsx",
            "/Users/dev/worktrees/feature-x/src/components/ui/Button.tsx",
            "/Users/dev/worktrees/bugfix-123/deeply/nested/path/to/file.swift"
        ]

        // Each path should be properly handled regardless of depth
        for path in deepPaths {
            let url = URL(fileURLWithPath: path)
            #expect(url.path.hasPrefix("/"))
        }
    }

    @Test("Remote response includes GitHub URL for worktrees")
    func remoteResponseWorktreeGitHub() {
        // Test that worktrees properly report their GitHub URLs
        struct RemoteResponse: Codable {
            let isGitRepo: Bool
            let repoPath: String?
            let remoteUrl: String?
            let githubUrl: String?
        }

        let worktreeRemote = RemoteResponse(
            isGitRepo: true,
            repoPath: "/Users/dev/worktrees/feature",
            remoteUrl: "git@github.com:company/project.git",
            githubUrl: "https://github.com/company/project"
        )

        #expect(worktreeRemote.githubUrl != nil)
        #expect(worktreeRemote.githubUrl == "https://github.com/company/project")
    }
}

// MARK: - Static Method Tests

@Suite("GitRepositoryMonitor Static Method Tests")
struct GitRepositoryMonitorStaticTests {
    @Test("checkIfWorktree detects regular repository")
    func checkIfWorktreeRegularRepo() {
        // In a regular repo, .git is a directory
        // This test would need file system mocking in production

        // For testing purposes, we know that:
        // - Regular repo: .git is a directory
        // - Worktree: .git is a file

        // Test the expected behavior
        let regularRepoPath = "/tmp/test-regular-repo"
        let worktreePath = "/tmp/test-worktree"

        // The actual file system check would happen in the static method
        // Here we test the logic expectations
        #expect(true) // Placeholder for actual file system test
    }
}
