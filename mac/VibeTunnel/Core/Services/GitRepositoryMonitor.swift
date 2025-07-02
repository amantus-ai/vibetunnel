import Combine
import Foundation
import Observation

/// Monitors Git repositories and provides status information
@MainActor
@Observable
public final class GitRepositoryMonitor {
    // MARK: - Lifecycle

    public init() {}

    // MARK: - Public Methods

    /// Find Git repository for a given file path and return its status
    /// - Parameter filePath: Path to a file within a potential Git repository
    /// - Returns: GitRepository information if found, nil otherwise
    public func findRepository(for filePath: String) async -> GitRepository? {
        // Check if we already know the repo path for this file
        if let cachedRepoPath = fileToRepoCache[filePath],
           let cached = getCachedRepository(forRepoPath: cachedRepoPath) {
            return cached
        }
        
        // Find the Git repository root
        guard let repoPath = await findGitRoot(from: filePath) else {
            return nil
        }
        
        // Cache the file->repo mapping
        fileToRepoCache[filePath] = repoPath
        
        // Check if we already have this repository cached
        if let cached = getCachedRepository(forRepoPath: repoPath) {
            return cached
        }
        
        // Get repository status
        let repository = await getRepositoryStatus(at: repoPath)
        
        // Cache the result by repository path
        if let repository {
            cacheRepository(repository)
        }
        
        return repository
    }

    /// Clear the repository cache
    public func clearCache() {
        repositoryCache.removeAll()
        cacheTimestamps.removeAll()
        fileToRepoCache.removeAll()
    }

    /// Monitor a specific directory for git changes
    public func startMonitoring(directory: String) {
        monitoringTimer?.invalidate()

        // Initial check
        Task {
            await findRepository(for: directory)
        }

        // Set up periodic monitoring
        monitoringTimer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { _ in
            Task { @MainActor in
                await self.findRepository(for: directory)
            }
        }
    }

    /// Stop monitoring
    public func stopMonitoring() {
        monitoringTimer?.invalidate()
        monitoringTimer = nil
    }

    // MARK: - Private Properties

    /// Cache for repository information by repository path (not file path)
    private var repositoryCache: [String: GitRepository] = [:]
    
    /// Cache mapping file paths to their repository paths
    private var fileToRepoCache: [String: String] = [:]

    /// Cache timeout interval (5 seconds)
    private let cacheTimeout: TimeInterval = 5.0

    /// Timestamps for cached entries (by repository path)
    private var cacheTimestamps: [String: Date] = [:]

    /// Timer for periodic monitoring
    private var monitoringTimer: Timer?

    // MARK: - Private Methods

    private func getCachedRepository(forRepoPath repoPath: String) -> GitRepository? {
        guard let timestamp = cacheTimestamps[repoPath],
              Date().timeIntervalSince(timestamp) < cacheTimeout,
              let cached = repositoryCache[repoPath]
        else {
            return nil
        }
        return cached
    }

    private func cacheRepository(_ repository: GitRepository) {
        repositoryCache[repository.path] = repository
        cacheTimestamps[repository.path] = Date()
    }

    /// Find the Git repository root starting from a given path
    private nonisolated func findGitRoot(from path: String) async -> String? {
        var currentPath = URL(fileURLWithPath: path)

        // If it's a file, start from its directory
        if !currentPath.hasDirectoryPath {
            currentPath = currentPath.deletingLastPathComponent()
        }

        // Get home directory path to stop searching
        let homeDirectory = FileManager.default.homeDirectoryForCurrentUser.path

        // Search up the directory tree
        while currentPath.path != "/", currentPath.path.hasPrefix(homeDirectory) {
            let gitPath = currentPath.appendingPathComponent(".git")

            if FileManager.default.fileExists(atPath: gitPath.path) {
                return currentPath.path
            }

            currentPath = currentPath.deletingLastPathComponent()
        }

        return nil
    }

    /// Get repository status by running git status
    private nonisolated func getRepositoryStatus(at repoPath: String) async -> GitRepository? {
        await Task.detached(priority: .userInitiated) {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
            process.arguments = ["status", "--porcelain", "--branch"]
            process.currentDirectoryURL = URL(fileURLWithPath: repoPath)

            let outputPipe = Pipe()
            process.standardOutput = outputPipe
            process.standardError = Pipe() // Suppress error output

            do {
                try process.run()
                process.waitUntilExit()

                guard process.terminationStatus == 0 else {
                    return nil
                }

                let outputData = outputPipe.fileHandleForReading.readDataToEndOfFile()
                let output = String(data: outputData, encoding: .utf8) ?? ""

                return Self.parseGitStatus(output: output, repoPath: repoPath)
            } catch {
                return nil
            }
        }.value
    }

    /// Parse git status --porcelain output
    private nonisolated static func parseGitStatus(output: String, repoPath: String) -> GitRepository {
        let lines = output.split(separator: "\n")
        var currentBranch: String?
        var modifiedCount = 0
        var addedCount = 0
        var deletedCount = 0
        var untrackedCount = 0

        for line in lines {
            let trimmedLine = line.trimmingCharacters(in: .whitespaces)

            // Parse branch information (first line with --branch flag)
            if trimmedLine.hasPrefix("##") {
                let branchInfo = trimmedLine.dropFirst(2).trimmingCharacters(in: .whitespaces)
                // Extract branch name (format: "branch...tracking" or just "branch")
                if let branchEndIndex = branchInfo.firstIndex(of: ".") {
                    currentBranch = String(branchInfo[..<branchEndIndex])
                } else {
                    currentBranch = branchInfo
                }
                continue
            }

            // Skip empty lines
            guard trimmedLine.count >= 2 else { continue }

            // Get status code (first two characters)
            let statusCode = trimmedLine.prefix(2)

            // Count files based on status codes
            // ?? = untracked
            // M_ or _M = modified
            // A_ or _A = added to index
            // D_ or _D = deleted
            // R_ = renamed
            // C_ = copied
            // U_ = unmerged
            if statusCode == "??" {
                untrackedCount += 1
            } else if statusCode.contains("M") {
                modifiedCount += 1
            } else if statusCode.contains("A") {
                addedCount += 1
            } else if statusCode.contains("D") {
                deletedCount += 1
            } else if statusCode.contains("R") || statusCode.contains("C") {
                // Renamed/copied files count as modified
                modifiedCount += 1
            } else if statusCode.contains("U") {
                // Unmerged files count as modified
                modifiedCount += 1
            }
        }

        return GitRepository(
            path: repoPath,
            modifiedCount: modifiedCount,
            addedCount: addedCount,
            deletedCount: deletedCount,
            untrackedCount: untrackedCount,
            currentBranch: currentBranch
        )
    }
}
