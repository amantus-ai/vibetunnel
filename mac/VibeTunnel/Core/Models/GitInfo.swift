import Foundation

/// Information about a Git repository
struct GitInfo: Equatable {
    let branch: String?
    let aheadCount: Int?
    let behindCount: Int?
    let hasChanges: Bool
    let isWorktree: Bool
}
