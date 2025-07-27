import Foundation

/// Represents a Git worktree in a repository.
///
/// A worktree allows you to have multiple working trees attached to the same repository,
/// enabling you to work on different branches simultaneously without switching contexts.
///
/// ## Overview
///
/// The `Worktree` struct provides comprehensive information about a Git worktree including:
/// - Basic properties like path, branch, and HEAD commit
/// - Status information (detached, locked, prunable)
/// - Statistics about uncommitted changes
/// - UI helper properties for display purposes
///
/// ## Usage Example
///
/// ```swift
/// let worktree = Worktree(
///     path: "/path/to/repo/worktrees/feature-branch",
///     branch: "feature/new-ui",
///     HEAD: "abc123def456",
///     detached: false,
///     prunable: false,
///     locked: nil,
///     lockedReason: nil,
///     commitsAhead: 3,
///     filesChanged: 5,
///     insertions: 42,
///     deletions: 10,
///     hasUncommittedChanges: true,
///     isMainWorktree: false,
///     isCurrentWorktree: true
/// )
/// ```
struct Worktree: Codable, Identifiable, Equatable {
    /// Unique identifier for the worktree instance.
    let id = UUID()

    /// The file system path to the worktree directory.
    let path: String

    /// The branch name associated with this worktree.
    ///
    /// This is the branch that the worktree is currently checked out to.
    let branch: String

    /// The SHA hash of the current HEAD commit.
    let HEAD: String

    /// Indicates whether the worktree is in a detached HEAD state.
    ///
    /// When `true`, the worktree is not on any branch but directly on a commit.
    let detached: Bool

    /// Indicates whether this worktree can be pruned (removed).
    ///
    /// A worktree is prunable when its associated branch has been deleted
    /// or when it's no longer needed.
    let prunable: Bool?

    /// Indicates whether this worktree is locked.
    ///
    /// Locked worktrees cannot be pruned or removed until unlocked.
    let locked: Bool?

    /// The reason why this worktree is locked, if applicable.
    ///
    /// Only present when `locked` is `true`.
    let lockedReason: String?

    // MARK: - Extended Statistics

    /// Number of commits this branch is ahead of the base branch.
    let commitsAhead: Int?

    /// Number of files with uncommitted changes in this worktree.
    let filesChanged: Int?

    /// Number of line insertions in uncommitted changes.
    let insertions: Int?

    /// Number of line deletions in uncommitted changes.
    let deletions: Int?

    /// Indicates whether this worktree has any uncommitted changes.
    ///
    /// This includes both staged and unstaged changes.
    let hasUncommittedChanges: Bool?

    // MARK: - UI Helpers

    /// Indicates whether this is the main worktree (not a linked worktree).
    ///
    /// The main worktree is typically the original repository directory.
    let isMainWorktree: Bool?

    /// Indicates whether this worktree is currently active in VibeTunnel.
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

/// Response from the worktree API endpoint.
///
/// This structure encapsulates the complete response when fetching worktree information,
/// including the list of worktrees and branch tracking information.
///
/// ## Topics
///
/// ### Properties
/// - ``worktrees``
/// - ``baseBranch``
/// - ``followBranch``
struct WorktreeListResponse: Codable {
    /// Array of all worktrees in the repository.
    let worktrees: [Worktree]

    /// The base branch for the repository (typically "main" or "master").
    let baseBranch: String

    /// The branch being followed in follow mode, if enabled.
    let followBranch: String?
}

/// Aggregated statistics about worktrees in a repository.
///
/// Provides a quick overview of the worktree state without
/// needing to process the full worktree list.
///
/// ## Example
///
/// ```swift
/// let stats = WorktreeStats(total: 5, locked: 1, prunable: 2)
/// logger.info("Active worktrees: \(stats.total - stats.prunable)")
/// ```
struct WorktreeStats: Codable {
    /// Total number of worktrees including the main worktree.
    let total: Int

    /// Number of worktrees that are currently locked.
    let locked: Int

    /// Number of worktrees that can be pruned.
    let prunable: Int
}

/// Status of the follow mode feature.
///
/// Follow mode automatically switches to a specified branch
/// when changes are detected, useful for continuous integration
/// or automated workflows.
struct FollowModeStatus: Codable {
    /// Whether follow mode is currently active.
    let enabled: Bool

    /// The branch being followed when enabled.
    let targetBranch: String?
}

/// Request payload for creating a new worktree.
///
/// ## Usage
///
/// ```swift
/// let request = CreateWorktreeRequest(
///     repoPath: "/path/to/repo",
///     branch: "feature/new-feature",
///     path: "/path/to/worktree",
///     baseBranch: "main"
/// )
/// ```
struct CreateWorktreeRequest: Codable {
    /// The repository path where the worktree will be created.
    let repoPath: String
    
    /// The branch name for the new worktree.
    let branch: String
    
    /// The file system path where the worktree will be created.
    let path: String

    /// The base branch to create from when creating a new branch.
    ///
    /// If nil, uses the repository's default branch.
    let baseBranch: String?
}

/// Request payload for switching branches in the current worktree.
///
/// This allows changing the checked-out branch without creating
/// a new worktree, useful for quick context switches.
struct SwitchBranchRequest: Codable {
    /// The repository path where the branch switch will occur.
    let repoPath: String
    
    /// The branch to switch to.
    let branch: String
}

/// Request payload for toggling follow mode.
///
/// ## Example
///
/// ```swift
/// // Enable follow mode
/// let enableRequest = FollowModeRequest(repoPath: "/path/to/repo", branch: "develop", enable: true)
///
/// // Disable follow mode
/// let disableRequest = FollowModeRequest(repoPath: "/path/to/repo", branch: nil, enable: false)
/// ```
struct FollowModeRequest: Codable {
    /// The repository path where follow mode will be configured.
    let repoPath: String
    
    /// The branch to follow when enabling.
    ///
    /// Required when `enable` is true, ignored otherwise.
    let branch: String?
    
    /// Whether to enable or disable follow mode.
    let enable: Bool
}

/// Represents a Git branch in the repository.
///
/// Provides information about branches including their relationship
/// to worktrees and whether they're local or remote branches.
///
/// ## Topics
///
/// ### Identification
/// - ``id``
/// - ``name``
///
/// ### Status
/// - ``current``
/// - ``remote``
/// - ``worktree``
struct GitBranch: Codable, Identifiable, Equatable {
    /// Unique identifier for the branch instance.
    let id = UUID()

    /// The branch name (e.g., "main", "feature/login", "origin/develop").
    let name: String

    /// Whether this is the currently checked-out branch.
    let current: Bool

    /// Whether this is a remote tracking branch.
    let remote: Bool

    /// Path to the worktree using this branch, if any.
    ///
    /// Will be nil for branches not associated with any worktree.
    let worktree: String?

    enum CodingKeys: String, CodingKey {
        case name
        case current
        case remote
        case worktree
    }
}
