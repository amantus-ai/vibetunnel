import Foundation

/// A path suggestion for autocomplete functionality.
///
/// This struct represents a file system path suggestion that can be presented
/// to users during path completion. It includes metadata about the path type
/// and Git repository information when applicable.
struct PathSuggestion: Identifiable, Equatable {
    /// Unique identifier for the suggestion.
    let id = UUID()

    /// The display name of the file or directory.
    ///
    /// This is typically the last component of the path (basename).
    let name: String

    /// The full file system path.
    ///
    /// This is the absolute or relative path to the file or directory.
    let path: String

    /// The type of file system entry this suggestion represents.
    let type: SuggestionType

    /// The complete path to insert when this suggestion is selected.
    ///
    /// This may include escaping or formatting necessary for shell usage.
    let suggestion: String

    /// Indicates whether this path is a Git repository.
    ///
    /// When `true`, the path contains a `.git` directory or is a Git worktree.
    let isRepository: Bool

    /// Git repository information if this path is a repository.
    ///
    /// Contains branch, sync status, and change information when `isRepository` is `true`.
    let gitInfo: GitInfo?

    /// The type of file system entry.
    ///
    /// Distinguishes between different types of file system entries
    /// to provide appropriate UI representation and behavior.
    enum SuggestionType {
        /// A regular file
        case file
        /// A directory
        case directory
    }
}
