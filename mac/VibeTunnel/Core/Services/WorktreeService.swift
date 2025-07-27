import Foundation
import Observation
import OSLog

/// Service for managing Git worktrees through the VibeTunnel server API
@MainActor
@Observable
final class WorktreeService {
    private let logger = Logger(subsystem: BundleIdentifiers.loggerSubsystem, category: "WorktreeService")
    private let serverManager: ServerManager

    private(set) var worktrees: [Worktree] = []
    private(set) var branches: [GitBranch] = []
    private(set) var stats: WorktreeStats?
    private(set) var followMode: FollowModeStatus?
    private(set) var isLoading = false
    private(set) var isLoadingBranches = false
    private(set) var error: Error?

    init(serverManager: ServerManager) {
        self.serverManager = serverManager
    }

    /// Fetch the list of worktrees for a Git repository
    func fetchWorktrees(for gitRepoPath: String) async {
        isLoading = true
        error = nil

        do {
            let worktreeResponse = try await serverManager.performRequest(
                endpoint: "/api/worktrees",
                method: "GET",
                queryItems: [URLQueryItem(name: "repoPath", value: gitRepoPath)],
                responseType: WorktreeListResponse.self
            )
            self.worktrees = worktreeResponse.worktrees
            // Stats and followMode are not part of the current API response
            // They could be fetched separately if needed
        } catch {
            self.error = error
            logger.error("Failed to fetch worktrees: \(error.localizedDescription)")
        }

        isLoading = false
    }

    /// Create a new worktree
    func createWorktree(
        gitRepoPath: String,
        branch: String,
        worktreePath: String,
        baseBranch: String? = nil
    )
        async throws
    {
        let request = CreateWorktreeRequest(
            repoPath: gitRepoPath,
            branch: branch,
            path: worktreePath,
            baseBranch: baseBranch
        )
        try await serverManager.performVoidRequest(
            endpoint: "/api/worktrees",
            method: "POST",
            body: request
        )

        // Refresh the worktree list
        await fetchWorktrees(for: gitRepoPath)
    }

    /// Delete a worktree
    func deleteWorktree(gitRepoPath: String, branch: String, force: Bool = false) async throws {
        try await serverManager.performVoidRequest(
            endpoint: "/api/worktrees/\(branch)",
            method: "DELETE",
            queryItems: [
                URLQueryItem(name: "repoPath", value: gitRepoPath),
                URLQueryItem(name: "force", value: String(force))
            ]
        )

        // Refresh the worktree list
        await fetchWorktrees(for: gitRepoPath)
    }

    /// Switch to a different branch
    func switchBranch(gitRepoPath: String, branch: String) async throws {
        let request = SwitchBranchRequest(repoPath: gitRepoPath, branch: branch)
        try await serverManager.performVoidRequest(
            endpoint: "/api/worktrees/switch",
            method: "POST",
            body: request
        )

        // Refresh the worktree list
        await fetchWorktrees(for: gitRepoPath)
    }

    /// Toggle follow mode
    func toggleFollowMode(gitRepoPath: String, enabled: Bool, targetBranch: String? = nil) async throws {
        let request = FollowModeRequest(repoPath: gitRepoPath, branch: targetBranch, enable: enabled)
        try await serverManager.performVoidRequest(
            endpoint: "/api/worktrees/follow",
            method: "POST",
            body: request
        )

        // Refresh the worktree list
        await fetchWorktrees(for: gitRepoPath)
    }

    /// Fetch the list of branches for a Git repository
    func fetchBranches(for gitRepoPath: String) async {
        isLoadingBranches = true

        do {
            self.branches = try await serverManager.performRequest(
                endpoint: "/api/repositories/branches",
                method: "GET",
                queryItems: [URLQueryItem(name: "path", value: gitRepoPath)],
                responseType: [GitBranch].self
            )
        } catch {
            self.error = error
            logger.error("Failed to fetch branches: \(error.localizedDescription)")
        }

        isLoadingBranches = false
    }
}

// MARK: - Error Types

enum WorktreeError: LocalizedError {
    case invalidURL
    case invalidResponse
    case serverError(String)
    case invalidConfiguration

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            "Invalid URL"
        case .invalidResponse:
            "Invalid server response"
        case .serverError(let message):
            message
        case .invalidConfiguration:
            "Invalid configuration"
        }
    }
}

// MARK: - Helper Types
