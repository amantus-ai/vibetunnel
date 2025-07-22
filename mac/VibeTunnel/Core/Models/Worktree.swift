import Foundation

/// Represents a Git worktree
struct Worktree: Codable, Identifiable, Equatable {
    let id = UUID()
    let path: String
    let branch: String
    let isCurrentBranch: Bool
    let isLocked: Bool
    let reason: String?
    let prunable: Bool
    let isDetached: Bool
    let head: String
    
    enum CodingKeys: String, CodingKey {
        case path
        case branch
        case isCurrentBranch
        case isLocked
        case reason
        case prunable
        case isDetached
        case head
    }
}

/// Response from the worktree API
struct WorktreeListResponse: Codable {
    let worktrees: [Worktree]
    let stats: WorktreeStats
    let followMode: FollowModeStatus
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