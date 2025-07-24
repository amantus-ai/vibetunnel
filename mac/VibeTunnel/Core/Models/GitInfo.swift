import Foundation

/// Information about a Git repository.
///
/// This struct encapsulates the current state of a Git repository, including
/// branch information, sync status, and working tree state.
struct GitInfo: Equatable {
    /// The current branch name, if available.
    ///
    /// This will be `nil` if the repository is in a detached HEAD state
    /// or if the branch information cannot be determined.
    let branch: String?

    /// The number of commits the current branch is ahead of its upstream branch.
    ///
    /// This value is `nil` if there is no upstream branch configured
    /// or if the ahead count cannot be determined.
    let aheadCount: Int?

    /// The number of commits the current branch is behind its upstream branch.
    ///
    /// This value is `nil` if there is no upstream branch configured
    /// or if the behind count cannot be determined.
    let behindCount: Int?

    /// Indicates whether the repository has uncommitted changes.
    ///
    /// This includes both staged and unstaged changes, as well as untracked files.
    let hasChanges: Bool

    /// Indicates whether the repository is a Git worktree.
    ///
    /// A worktree is a linked working tree that shares the same repository
    /// with the main working tree but can have a different branch checked out.
    let isWorktree: Bool
}
