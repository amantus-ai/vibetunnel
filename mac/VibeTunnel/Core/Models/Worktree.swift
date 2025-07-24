import Foundation

/// Represents a Git worktree
struct Worktree: Codable, Identifiable, Equatable {
    let id = UUID()
    let path: String
    let branch: String
    let HEAD: String
    let detached: Bool
    let prunable: Bool?
    let locked: Bool?
    let lockedReason: String?
    // Extended stats
    let commitsAhead: Int?
    let filesChanged: Int?
    let insertions: Int?
    let deletions: Int?
    let hasUncommittedChanges: Bool?
    // UI helpers
    let isMainWorktree: Bool?
    let isCurrentWorktree: Bool?

    enum CodingKeys: String, CodingKey {
        case path
        case branch
        case HEAD
        case detached
        case prunable
        case locked
        case lockedReason
        case commitsAhead
        case filesChanged
        case insertions
        case deletions
        case hasUncommittedChanges
        case isMainWorktree
        case isCurrentWorktree
    }
}

/// Response from the worktree API
struct WorktreeListResponse: Codable {
    let worktrees: [Worktree]
    let baseBranch: String
    let followBranch: String?
}

/// Statistics about worktrees
struct WorktreeStats: Codable {
    let total: Int
    let locked: Int
    let prunable: Int
}

/// Follow mode status
struct FollowModeStatus: Codable {
    let enabled: Bool
    let targetBranch: String?
}

/// Request to create a new worktree
struct CreateWorktreeRequest: Codable {
    let branch: String
    let createBranch: Bool
    let baseBranch: String?
}

/// Request to switch branches
struct SwitchBranchRequest: Codable {
    let branch: String
    let createBranch: Bool
}

/// Request to toggle follow mode
struct FollowModeRequest: Codable {
    let enabled: Bool
    let targetBranch: String?
}

/// Represents a Git branch
struct GitBranch: Codable, Identifiable, Equatable {
    let id = UUID()
    let name: String
    let current: Bool
    let remote: Bool
    let worktree: String?

    enum CodingKeys: String, CodingKey {
        case name
        case current
        case remote
        case worktree
    }
}
