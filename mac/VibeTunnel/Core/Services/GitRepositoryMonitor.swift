import Combine
import Foundation
import Observation

/// Monitors and caches Git repository status information for efficient UI updates.
///
/// `GitRepositoryMonitor` provides real-time Git repository information for terminal sessions
/// in VibeTunnel. It efficiently tracks repository states with intelligent caching to minimize
/// Git command executions while keeping the UI responsive.
@MainActor
@Observable
public final class GitRepositoryMonitor {
    // MARK: - Lifecycle

    public init() {}
    
    // MARK: - Private Properties
    
    /// Concurrent queue for thread-safe cache access
    private let cacheQueue = DispatchQueue(label: "git.cache", attributes: .concurrent)

    // MARK: - Public Methods
    
    /// Get cached repository information synchronously
    /// - Parameter filePath: Path to a file within a potential Git repository
    /// - Returns: Cached GitRepository information if available, nil otherwise
    public func getCachedRepository(for filePath: String) -> GitRepository? {
        cacheQueue.sync {
            guard let cachedRepoPath = fileToRepoCache[filePath],
                  let cached = repositoryCache[cachedRepoPath] else {
                return nil
            }
            return cached
        }
    }

    /// Find Git repository for a given file path and return its status
    /// - Parameter filePath: Path to a file within a potential Git repository
    /// - Returns: GitRepository information if found, nil otherwise
    public func findRepository(for filePath: String) async -> GitRepository? {
        // Validate path first
        guard validatePath(filePath) else {
            return nil
        }
        
        // Check cache first
        if let cached = getCachedRepository(for: filePath) {
            return cached
        }
        
        // Find the Git repository root
        guard let repoPath = await findGitRoot(from: filePath) else {
            return nil
        }
        
        // Check if we already have this repository cached
        let cachedRepo = cacheQueue.sync { repositoryCache[repoPath] }
        if let cachedRepo {
            // Cache the file->repo mapping
            cacheQueue.async(flags: .barrier) {
                self.fileToRepoCache[filePath] = repoPath
            }
            return cachedRepo
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
        cacheQueue.async(flags: .barrier) {
            self.repositoryCache.removeAll()
            self.fileToRepoCache.removeAll()
        }
    }
    
    /// Start monitoring and refreshing all cached repositories
    public func startMonitoring() {
        stopMonitoring()
        
        // Set up periodic refresh of all cached repositories
        monitoringTimer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { _ in
            Task { @MainActor in
                await self.refreshAllCached()
            }
        }
    }
    
    /// Stop monitoring
    public func stopMonitoring() {
        monitoringTimer?.invalidate()
        monitoringTimer = nil
    }
    
    // MARK: - Private Methods
    
    /// Refresh all cached repositories
    private func refreshAllCached() async {
        let repoPaths = cacheQueue.sync { Array(repositoryCache.keys) }
        for repoPath in repoPaths {
            if let fresh = await getRepositoryStatus(at: repoPath) {
                cacheQueue.async(flags: .barrier) {
                    self.repositoryCache[repoPath] = fresh
                }
            }
        }
    }

    // MARK: - Private Properties

    /// Cache for repository information by repository path (not file path)
    private var repositoryCache: [String: GitRepository] = [:]
    
    /// Cache mapping file paths to their repository paths
    private var fileToRepoCache: [String: String] = [:]

    /// Timer for periodic monitoring
    private var monitoringTimer: Timer?

    // MARK: - Private Methods

    private func cacheRepository(_ repository: GitRepository) {
        cacheQueue.async(flags: .barrier) {
            self.fileToRepoCache[repository.path] = repository.path
            self.repositoryCache[repository.path] = repository
        }
    }
    
    /// Validate and sanitize paths
    private func validatePath(_ path: String) -> Bool {
        let expandedPath = NSString(string: path).expandingTildeInPath
        let url = URL(fileURLWithPath: expandedPath)
        // Ensure path is absolute and exists
        return url.path.hasPrefix("/") && FileManager.default.fileExists(atPath: url.path)
    }

    /// Find the Git repository root starting from a given path
    private nonisolated func findGitRoot(from path: String) async -> String? {
        let expandedPath = NSString(string: path).expandingTildeInPath
        var currentPath = URL(fileURLWithPath: expandedPath)

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
