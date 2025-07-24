import Foundation

/// Represents the current state and metadata of a Git repository.
///
/// `GitRepository` provides a comprehensive snapshot of a Git repository's status,
/// including file change counts, current branch, and remote URL information.
/// It's designed to be used with ``GitRepositoryMonitor`` for real-time monitoring
/// of repository states in the VibeTunnel menu bar interface.
public struct GitRepository: Sendable, Equatable, Hashable {
    // MARK: - Properties

    /// The root path of the Git repository (.git directory's parent)
    public let path: String

    /// Number of modified files
    public let modifiedCount: Int

    /// Number of added files
    public let addedCount: Int

    /// Number of deleted files
    public let deletedCount: Int

    /// Number of untracked files
    public let untrackedCount: Int

    /// Current branch name
    public let currentBranch: String?

    /// Number of commits ahead of upstream
    public let aheadCount: Int?

    /// Number of commits behind upstream
    public let behindCount: Int?

    /// Name of the tracking branch (e.g., "origin/main")
    public let trackingBranch: String?

    /// Whether this is a worktree (not the main repository)
    public let isWorktree: Bool

    /// GitHub URL for the repository (cached, not computed)
    public let githubURL: URL?

    // MARK: - Computed Properties

    /// Whether the repository has uncommitted changes
    public var hasChanges: Bool {
        modifiedCount > 0 || addedCount > 0 || deletedCount > 0 || untrackedCount > 0
    }

    /// Total number of files with changes
    public var totalChangedFiles: Int {
        modifiedCount + addedCount + deletedCount + untrackedCount
    }

    /// Folder name for display
    public var folderName: String {
        URL(fileURLWithPath: path).lastPathComponent
    }

    /// Status text for display
    public var statusText: String {
        if !hasChanges {
            return "clean"
        }

        var parts: [String] = []
        if modifiedCount > 0 {
            parts.append("\(modifiedCount)M")
        }
        if addedCount > 0 {
            parts.append("\(addedCount)A")
        }
        if deletedCount > 0 {
            parts.append("\(deletedCount)D")
        }
        if untrackedCount > 0 {
            parts.append("\(untrackedCount)U")
        }
        return parts.joined(separator: " ")
    }

    // MARK: - Lifecycle

    public init(
        path: String,
        modifiedCount: Int = 0,
        addedCount: Int = 0,
        deletedCount: Int = 0,
        untrackedCount: Int = 0,
        currentBranch: String? = nil,
        aheadCount: Int? = nil,
        behindCount: Int? = nil,
        trackingBranch: String? = nil,
        isWorktree: Bool = false,
        githubURL: URL? = nil
    ) {
        self.path = path
        self.modifiedCount = modifiedCount
        self.addedCount = addedCount
        self.deletedCount = deletedCount
        self.untrackedCount = untrackedCount
        self.currentBranch = currentBranch
        self.aheadCount = aheadCount
        self.behindCount = behindCount
        self.trackingBranch = trackingBranch
        self.isWorktree = isWorktree
        self.githubURL = githubURL
    }

    // MARK: - Internal Methods
}
