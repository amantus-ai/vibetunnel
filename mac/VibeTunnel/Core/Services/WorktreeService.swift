import Foundation
import Observation
import OSLog

/// Service for managing Git worktrees through the VibeTunnel server API
@MainActor
@Observable
final class WorktreeService {
    private let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "WorktreeService")
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
            guard let baseURL = URL(string: "\(URLConstants.localServerBase):\(serverManager.port)") else {
                throw WorktreeError.invalidURL
            }

            var components = URLComponents(
                url: baseURL.appendingPathComponent("api/worktrees"),
                resolvingAgainstBaseURL: false
            )!
            components.queryItems = [URLQueryItem(name: "gitRepoPath", value: gitRepoPath)]

            guard let url = components.url else {
                throw WorktreeError.invalidURL
            }

            let (data, response) = try await URLSession.shared.data(from: url)

            guard let httpResponse = response as? HTTPURLResponse else {
                throw WorktreeError.invalidResponse
            }

            if httpResponse.statusCode == 200 {
                let decoder = JSONDecoder()
                let worktreeResponse = try decoder.decode(WorktreeListResponse.self, from: data)
                self.worktrees = worktreeResponse.worktrees
                self.stats = worktreeResponse.stats
                self.followMode = worktreeResponse.followMode
            } else {
                let errorData = try? JSONDecoder().decode(ErrorResponse.self, from: data)
                throw WorktreeError.serverError(errorData?.error ?? "Unknown error")
            }
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
        createBranch: Bool,
        baseBranch: String? = nil
    )
        async throws
    {
        guard let baseURL = URL(string: "\(URLConstants.localServerBase):\(serverManager.port)") else {
            throw WorktreeError.invalidURL
        }

        var components = URLComponents(
            url: baseURL.appendingPathComponent("api/worktrees"),
            resolvingAgainstBaseURL: false
        )!
        components.queryItems = [URLQueryItem(name: "gitRepoPath", value: gitRepoPath)]

        guard let url = components.url else {
            throw WorktreeError.invalidURL
        }

        let request = CreateWorktreeRequest(branch: branch, createBranch: createBranch, baseBranch: baseBranch)
        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        urlRequest.httpBody = try JSONEncoder().encode(request)

        let (data, response) = try await URLSession.shared.data(for: urlRequest)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw WorktreeError.invalidResponse
        }

        if httpResponse.statusCode != 200 {
            let errorData = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            throw WorktreeError.serverError(errorData?.error ?? "Failed to create worktree")
        }

        // Refresh the worktree list
        await fetchWorktrees(for: gitRepoPath)
    }

    /// Delete a worktree
    func deleteWorktree(gitRepoPath: String, branch: String, force: Bool = false) async throws {
        guard let baseURL = URL(string: "\(URLConstants.localServerBase):\(serverManager.port)") else {
            throw WorktreeError.invalidURL
        }

        var components = URLComponents(
            url: baseURL.appendingPathComponent("api/worktrees/\(branch)"),
            resolvingAgainstBaseURL: false
        )!
        components.queryItems = [
            URLQueryItem(name: "gitRepoPath", value: gitRepoPath),
            URLQueryItem(name: "force", value: String(force))
        ]

        guard let url = components.url else {
            throw WorktreeError.invalidURL
        }

        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "DELETE"

        let (data, response) = try await URLSession.shared.data(for: urlRequest)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw WorktreeError.invalidResponse
        }

        if httpResponse.statusCode != 200 {
            let errorData = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            throw WorktreeError.serverError(errorData?.error ?? "Failed to delete worktree")
        }

        // Refresh the worktree list
        await fetchWorktrees(for: gitRepoPath)
    }

    /// Switch to a different branch
    func switchBranch(gitRepoPath: String, branch: String, createBranch: Bool = false) async throws {
        guard let baseURL = URL(string: "\(URLConstants.localServerBase):\(serverManager.port)") else {
            throw WorktreeError.invalidURL
        }

        var components = URLComponents(
            url: baseURL.appendingPathComponent("api/worktrees/switch"),
            resolvingAgainstBaseURL: false
        )!
        components.queryItems = [URLQueryItem(name: "gitRepoPath", value: gitRepoPath)]

        guard let url = components.url else {
            throw WorktreeError.invalidURL
        }

        let request = SwitchBranchRequest(branch: branch, createBranch: createBranch)
        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        urlRequest.httpBody = try JSONEncoder().encode(request)

        let (data, response) = try await URLSession.shared.data(for: urlRequest)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw WorktreeError.invalidResponse
        }

        if httpResponse.statusCode != 200 {
            let errorData = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            throw WorktreeError.serverError(errorData?.error ?? "Failed to switch branch")
        }

        // Refresh the worktree list
        await fetchWorktrees(for: gitRepoPath)
    }

    /// Toggle follow mode
    func toggleFollowMode(gitRepoPath: String, enabled: Bool, targetBranch: String? = nil) async throws {
        guard let baseURL = URL(string: "\(URLConstants.localServerBase):\(serverManager.port)") else {
            throw WorktreeError.invalidURL
        }

        var components = URLComponents(
            url: baseURL.appendingPathComponent("api/worktrees/follow"),
            resolvingAgainstBaseURL: false
        )!
        components.queryItems = [URLQueryItem(name: "gitRepoPath", value: gitRepoPath)]

        guard let url = components.url else {
            throw WorktreeError.invalidURL
        }

        let request = FollowModeRequest(enabled: enabled, targetBranch: targetBranch)
        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        urlRequest.httpBody = try JSONEncoder().encode(request)

        let (data, response) = try await URLSession.shared.data(for: urlRequest)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw WorktreeError.invalidResponse
        }

        if httpResponse.statusCode != 200 {
            let errorData = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            throw WorktreeError.serverError(errorData?.error ?? "Failed to toggle follow mode")
        }

        // Refresh the worktree list
        await fetchWorktrees(for: gitRepoPath)
    }

    /// Fetch the list of branches for a Git repository
    func fetchBranches(for gitRepoPath: String) async {
        isLoadingBranches = true

        do {
            guard let baseURL = URL(string: "\(URLConstants.localServerBase):\(serverManager.port)") else {
                throw WorktreeError.invalidURL
            }

            var components = URLComponents(
                url: baseURL.appendingPathComponent("api/repositories/branches"),
                resolvingAgainstBaseURL: false
            )!
            components.queryItems = [URLQueryItem(name: "path", value: gitRepoPath)]

            guard let url = components.url else {
                throw WorktreeError.invalidURL
            }

            let (data, response) = try await URLSession.shared.data(from: url)

            guard let httpResponse = response as? HTTPURLResponse else {
                throw WorktreeError.invalidResponse
            }

            if httpResponse.statusCode == 200 {
                let decoder = JSONDecoder()
                self.branches = try decoder.decode([GitBranch].self, from: data)
            } else {
                let errorData = try? JSONDecoder().decode(ErrorResponse.self, from: data)
                throw WorktreeError.serverError(errorData?.error ?? "Failed to fetch branches")
            }
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

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            "Invalid URL"
        case .invalidResponse:
            "Invalid server response"
        case .serverError(let message):
            message
        }
    }
}

// MARK: - Helper Types

private struct ErrorResponse: Codable {
    let error: String
}
