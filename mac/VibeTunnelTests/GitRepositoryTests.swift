import XCTest
@testable import VibeTunnel

final class GitRepositoryTests: XCTestCase {
    
    // MARK: - Basic Initialization Tests
    
    func testGitRepositoryInitialization() {
        let repo = GitRepository(
            path: "/path/to/repo",
            modifiedCount: 5,
            addedCount: 2,
            deletedCount: 1,
            untrackedCount: 3,
            currentBranch: "main",
            githubURL: URL(string: "https://github.com/user/repo")
        )
        
        XCTAssertEqual(repo.path, "/path/to/repo")
        XCTAssertEqual(repo.modifiedCount, 5)
        XCTAssertEqual(repo.addedCount, 2)
        XCTAssertEqual(repo.deletedCount, 1)
        XCTAssertEqual(repo.untrackedCount, 3)
        XCTAssertEqual(repo.currentBranch, "main")
        XCTAssertEqual(repo.githubURL?.absoluteString, "https://github.com/user/repo")
    }
    
    func testGitRepositoryWithNilValues() {
        let repo = GitRepository(
            path: "/path/to/repo",
            modifiedCount: 0,
            addedCount: 0,
            deletedCount: 0,
            untrackedCount: 0,
            currentBranch: nil,
            githubURL: nil
        )
        
        XCTAssertEqual(repo.path, "/path/to/repo")
        XCTAssertEqual(repo.modifiedCount, 0)
        XCTAssertNil(repo.currentBranch)
        XCTAssertNil(repo.githubURL)
    }
    
    // MARK: - Computed Properties Tests
    
    func testHasChangesWithNoChanges() {
        let repo = GitRepository(
            path: "/path/to/repo",
            modifiedCount: 0,
            addedCount: 0,
            deletedCount: 0,
            untrackedCount: 0,
            currentBranch: "main",
            githubURL: nil
        )
        
        XCTAssertFalse(repo.hasChanges)
        XCTAssertEqual(repo.totalChangedFiles, 0)
    }
    
    func testHasChangesWithModifiedFiles() {
        let repo = GitRepository(
            path: "/path/to/repo",
            modifiedCount: 3,
            addedCount: 0,
            deletedCount: 0,
            untrackedCount: 0,
            currentBranch: "main",
            githubURL: nil
        )
        
        XCTAssertTrue(repo.hasChanges)
        XCTAssertEqual(repo.totalChangedFiles, 3)
    }
    
    func testHasChangesWithAddedFiles() {
        let repo = GitRepository(
            path: "/path/to/repo",
            modifiedCount: 0,
            addedCount: 2,
            deletedCount: 0,
            untrackedCount: 0,
            currentBranch: "main",
            githubURL: nil
        )
        
        XCTAssertTrue(repo.hasChanges)
        XCTAssertEqual(repo.totalChangedFiles, 2)
    }
    
    func testHasChangesWithDeletedFiles() {
        let repo = GitRepository(
            path: "/path/to/repo",
            modifiedCount: 0,
            addedCount: 0,
            deletedCount: 1,
            untrackedCount: 0,
            currentBranch: "main",
            githubURL: nil
        )
        
        XCTAssertTrue(repo.hasChanges)
        XCTAssertEqual(repo.totalChangedFiles, 1)
    }
    
    func testHasChangesWithUntrackedFiles() {
        let repo = GitRepository(
            path: "/path/to/repo",
            modifiedCount: 0,
            addedCount: 0,
            deletedCount: 0,
            untrackedCount: 5,
            currentBranch: "main",
            githubURL: nil
        )
        
        XCTAssertTrue(repo.hasChanges)
        XCTAssertEqual(repo.totalChangedFiles, 5)
    }
    
    func testHasChangesWithAllTypes() {
        let repo = GitRepository(
            path: "/path/to/repo",
            modifiedCount: 2,
            addedCount: 1,
            deletedCount: 3,
            untrackedCount: 4,
            currentBranch: "main",
            githubURL: nil
        )
        
        XCTAssertTrue(repo.hasChanges)
        XCTAssertEqual(repo.totalChangedFiles, 10)
    }
    
    // MARK: - Folder Name Tests
    
    func testFolderNameWithSimplePath() {
        let repo = GitRepository(
            path: "/path/to/my-repo",
            modifiedCount: 0,
            addedCount: 0,
            deletedCount: 0,
            untrackedCount: 0,
            currentBranch: "main",
            githubURL: nil
        )
        
        XCTAssertEqual(repo.folderName, "my-repo")
    }
    
    func testFolderNameWithComplexPath() {
        let repo = GitRepository(
            path: "/Users/username/Projects/My Awesome Project",
            modifiedCount: 0,
            addedCount: 0,
            deletedCount: 0,
            untrackedCount: 0,
            currentBranch: "main",
            githubURL: nil
        )
        
        XCTAssertEqual(repo.folderName, "My Awesome Project")
    }
    
    func testFolderNameWithTrailingSlash() {
        let repo = GitRepository(
            path: "/path/to/repo/",
            modifiedCount: 0,
            addedCount: 0,
            deletedCount: 0,
            untrackedCount: 0,
            currentBranch: "main",
            githubURL: nil
        )
        
        XCTAssertEqual(repo.folderName, "repo")
    }
    
    // MARK: - Equatable Tests
    
    func testGitRepositoryEquality() {
        let repo1 = GitRepository(
            path: "/path/to/repo",
            modifiedCount: 5,
            addedCount: 2,
            deletedCount: 1,
            untrackedCount: 3,
            currentBranch: "main",
            githubURL: URL(string: "https://github.com/user/repo")
        )
        
        let repo2 = GitRepository(
            path: "/path/to/repo",
            modifiedCount: 5,
            addedCount: 2,
            deletedCount: 1,
            untrackedCount: 3,
            currentBranch: "main",
            githubURL: URL(string: "https://github.com/user/repo")
        )
        
        XCTAssertEqual(repo1, repo2)
    }
    
    func testGitRepositoryInequality() {
        let repo1 = GitRepository(
            path: "/path/to/repo1",
            modifiedCount: 5,
            addedCount: 2,
            deletedCount: 1,
            untrackedCount: 3,
            currentBranch: "main",
            githubURL: URL(string: "https://github.com/user/repo1")
        )
        
        let repo2 = GitRepository(
            path: "/path/to/repo2",
            modifiedCount: 5,
            addedCount: 2,
            deletedCount: 1,
            untrackedCount: 3,
            currentBranch: "main",
            githubURL: URL(string: "https://github.com/user/repo2")
        )
        
        XCTAssertNotEqual(repo1, repo2)
    }
    
    // MARK: - Hashable Tests
    
    func testGitRepositoryHashable() {
        let repo1 = GitRepository(
            path: "/path/to/repo",
            modifiedCount: 5,
            addedCount: 2,
            deletedCount: 1,
            untrackedCount: 3,
            currentBranch: "main",
            githubURL: URL(string: "https://github.com/user/repo")
        )
        
        let repo2 = GitRepository(
            path: "/path/to/repo",
            modifiedCount: 5,
            addedCount: 2,
            deletedCount: 1,
            untrackedCount: 3,
            currentBranch: "main",
            githubURL: URL(string: "https://github.com/user/repo")
        )
        
        XCTAssertEqual(repo1.hashValue, repo2.hashValue)
        
        var set = Set<GitRepository>()
        set.insert(repo1)
        set.insert(repo2)
        
        XCTAssertEqual(set.count, 1) // Should only have one unique item
    }
    
    // MARK: - Sendable Tests
    
    func testGitRepositorySendable() {
        // This test verifies that GitRepository can be used in concurrent contexts
        let repo = GitRepository(
            path: "/path/to/repo",
            modifiedCount: 5,
            addedCount: 2,
            deletedCount: 1,
            untrackedCount: 3,
            currentBranch: "main",
            githubURL: URL(string: "https://github.com/user/repo")
        )
        
        let expectation = XCTestExpectation(description: "Concurrent access")
        
        DispatchQueue.concurrentPerform(iterations: 10) { _ in
            // Access various properties concurrently
            _ = repo.path
            _ = repo.hasChanges
            _ = repo.totalChangedFiles
            _ = repo.folderName
            _ = repo.currentBranch
            _ = repo.githubURL
        }
        
        expectation.fulfill()
        wait(for: [expectation], timeout: 1.0)
    }
    
    // MARK: - Edge Cases
    
    func testGitRepositoryWithEmptyPath() {
        let repo = GitRepository(
            path: "",
            modifiedCount: 0,
            addedCount: 0,
            deletedCount: 0,
            untrackedCount: 0,
            currentBranch: "main",
            githubURL: nil
        )
        
        XCTAssertEqual(repo.folderName, "")
    }
    
    func testGitRepositoryWithRootPath() {
        let repo = GitRepository(
            path: "/",
            modifiedCount: 0,
            addedCount: 0,
            deletedCount: 0,
            untrackedCount: 0,
            currentBranch: "main",
            githubURL: nil
        )
        
        XCTAssertEqual(repo.folderName, "")
    }
    
    func testGitRepositoryWithLargeNumbers() {
        let repo = GitRepository(
            path: "/path/to/repo",
            modifiedCount: Int.max,
            addedCount: Int.max,
            deletedCount: Int.max,
            untrackedCount: Int.max,
            currentBranch: "main",
            githubURL: nil
        )
        
        XCTAssertTrue(repo.hasChanges)
        // Note: This will overflow, but we're testing edge cases
        XCTAssertGreaterThan(repo.totalChangedFiles, 0)
    }
} 