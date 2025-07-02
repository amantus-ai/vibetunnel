import Foundation

/// Represents information about a Git repository
public struct GitRepository: Sendable, Equatable, Hashable {
    // MARK: - Properties

    /// The root path of the Git repository (.git directory's parent)
    public let path: String

    /// Number of modified files (staged and unstaged)
    public let dirtyFileCount: Int

    /// Number of untracked files
    public let untrackedFileCount: Int

    /// Current branch name
    public let currentBranch: String?

    // MARK: - Computed Properties

    /// Whether the repository has uncommitted changes
    public var hasChanges: Bool {
        dirtyFileCount > 0 || untrackedFileCount > 0
    }

    /// Total number of files with changes (dirty + untracked)
    public var totalChangedFiles: Int {
        dirtyFileCount + untrackedFileCount
    }

    /// Folder name for display
    public var folderName: String {
        URL(fileURLWithPath: path).lastPathComponent
    }

    /// GitHub URL for the repository if it's hosted on GitHub
    public var githubURL: URL? {
        Self.getGitHubURL(for: path)
    }

    /// Status text for display
    public var statusText: String {
        if !hasChanges {
            return "clean"
        }

        var parts: [String] = []
        if dirtyFileCount > 0 {
            parts.append("\(dirtyFileCount)M")
        }
        if untrackedFileCount > 0 {
            parts.append("\(untrackedFileCount)U")
        }
        return parts.joined(separator: ", ")
    }

    // MARK: - Lifecycle

    public init(
        path: String,
        dirtyFileCount: Int = 0,
        untrackedFileCount: Int = 0,
        currentBranch: String? = nil
    ) {
        self.path = path
        self.dirtyFileCount = dirtyFileCount
        self.untrackedFileCount = untrackedFileCount
        self.currentBranch = currentBranch
    }

    // MARK: - Private Methods

    /// Extract GitHub URL from a repository path
    private static func getGitHubURL(for repoPath: String) -> URL? {
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
    private static func parseGitHubURL(from remoteURL: String) -> URL? {
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
