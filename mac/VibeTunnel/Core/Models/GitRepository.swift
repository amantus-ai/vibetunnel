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
        githubURL: URL? = nil
    ) {
        self.path = path
        self.modifiedCount = modifiedCount
        self.addedCount = addedCount
        self.deletedCount = deletedCount
        self.untrackedCount = untrackedCount
        self.currentBranch = currentBranch
        self.githubURL = githubURL
    }

    // MARK: - Internal Methods

    /// Extract GitHub URL from a repository path
    static func getGitHubURL(for repoPath: String) -> URL? {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        process.arguments = ["remote", "get-url", "origin"]
        process.currentDirectoryURL = URL(fileURLWithPath: repoPath)

        let outputPipe = Pipe()
        process.standardOutput = outputPipe
        process.standardError = Pipe()

        do {
            try process.run()
            process.waitUntilExit()

            guard process.terminationStatus == 0 else {
                return nil
            }

            let outputData = outputPipe.fileHandleForReading.readDataToEndOfFile()
            let output = String(data: outputData, encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

            return parseGitHubURL(from: output)
        } catch {
            return nil
        }
    }

    /// Parse GitHub URL from git remote output
    static func parseGitHubURL(from remoteURL: String) -> URL? {
        // Handle HTTPS URLs: https://github.com/user/repo.git
        if remoteURL.hasPrefix("https://github.com/") {
            let cleanURL = remoteURL.hasSuffix(".git") ? String(remoteURL.dropLast(4)) : remoteURL
            return URL(string: cleanURL)
        }

        // Handle SSH URLs: git@github.com:user/repo.git
        if remoteURL.hasPrefix("git@github.com:") {
            let pathPart = String(remoteURL.dropFirst("git@github.com:".count))
            let cleanPath = pathPart.hasSuffix(".git") ? String(pathPart.dropLast(4)) : pathPart
            return URL(string: "https://github.com/\(cleanPath)")
        }

        return nil
    }
}
