import Foundation
import OSLog
import Observation
// MARK: - Logger

extension Logger {
    fileprivate static let repositoryDiscovery = Logger(
        subsystem: "sh.vibetunnel.vibetunnel",
        category: "RepositoryDiscovery"
    )
}

/// Service for discovering Git repositories in a specified directory
/// 
/// Provides functionality to scan a base directory for Git repositories and
/// return them in a format suitable for display in the New Session form.
/// Includes caching and performance optimizations for large directory trees.
@MainActor
@Observable
public final class RepositoryDiscoveryService {
    
    // MARK: - Properties
    
    /// Published array of discovered repositories
    public private(set) var repositories: [DiscoveredRepository] = []
    
    /// Whether discovery is currently in progress
    public private(set) var isDiscovering = false
    
    /// Last error encountered during discovery
    public private(set) var lastError: String?
    
    /// Cache of discovered repositories by base path
    private var repositoryCache: [String: [DiscoveredRepository]] = [:]
    
    /// Maximum depth to search for repositories (prevents infinite recursion)
    private let maxSearchDepth = 3
    
    
    // MARK: - Lifecycle
    
    public init() {}
    
    // MARK: - Public Methods
    
    /// Discover repositories in the specified base path
    /// - Parameter basePath: The base directory to search (supports ~ expansion)
    public func discoverRepositories(in basePath: String) async {
        guard !isDiscovering else {
            Logger.repositoryDiscovery.debug("Discovery already in progress, skipping")
            return
        }
        
        isDiscovering = true
        lastError = nil
        
        let expandedPath = NSString(string: basePath).expandingTildeInPath
        Logger.repositoryDiscovery.info("Starting repository discovery in: \(expandedPath)")
        
        // Check cache first
        if let cachedRepositories = repositoryCache[expandedPath] {
            Logger.repositoryDiscovery.debug("Using cached repositories for path: \(expandedPath)")
            repositories = cachedRepositories
            isDiscovering = false
            return
        }
        
        Task.detached { [weak self] in
            // Perform discovery in background
            let discoveredRepos = await self?.performDiscovery(in: expandedPath)

            guard let discoveredRepos else {
                return
            }
    
            await MainActor.run { [weak self] in
                // Cache and update results
                self?.repositoryCache[expandedPath] = discoveredRepos
                self?.repositories = discoveredRepos
                
                Logger.repositoryDiscovery.info("Discovered \(discoveredRepos.count) repositories in: \(expandedPath)")
                
                self?.isDiscovering = false
            }
        }
    }
    
    /// Clear the repository cache
    public func clearCache() {
        repositoryCache.removeAll()
        Logger.repositoryDiscovery.debug("Repository cache cleared")
    }
    
    // MARK: - Private Methods
    
    /// Perform the actual discovery work
    private nonisolated func performDiscovery(in basePath: String) async -> [DiscoveredRepository] {
        return await withTaskGroup(of: [DiscoveredRepository].self) { taskGroup in
            var allRepositories: [DiscoveredRepository] = []
            
            // Submit discovery task
            taskGroup.addTask { [weak self] in
                await self?.scanDirectory(basePath, depth: 0) ?? []
            }
            
            // Collect results
            for await repositories in taskGroup {
                allRepositories.append(contentsOf: repositories)
            }
            
            // Sort by folder name for consistent display
            return allRepositories.sorted { $0.folderName < $1.folderName }
        }
    }
    
    /// Recursively scan a directory for Git repositories
    private nonisolated func scanDirectory(_ path: String, depth: Int) async -> [DiscoveredRepository] {
        guard depth < maxSearchDepth else {
            Logger.repositoryDiscovery.debug("Max depth reached at: \(path)")
            return []
        }
        
        do {
            let fileManager = FileManager.default
            let url = URL(fileURLWithPath: path)
            
            // Check if directory is accessible
            guard fileManager.isReadableFile(atPath: path) else {
                Logger.repositoryDiscovery.debug("Directory not readable: \(path)")
                return []
            }
            
            // Get directory contents
            let contents = try fileManager.contentsOfDirectory(
                at: url,
                includingPropertiesForKeys: [.isDirectoryKey, .isHiddenKey],
                options: [.skipsSubdirectoryDescendants]
            )
            
            var repositories: [DiscoveredRepository] = []
            
            for itemURL in contents {
                let resourceValues = try itemURL.resourceValues(forKeys: [.isDirectoryKey, .isHiddenKey])
                
                // Skip files and hidden directories (except .git)
                guard resourceValues.isDirectory == true else { continue }
                if resourceValues.isHidden == true && itemURL.lastPathComponent != ".git" {
                    continue
                }
                
                let itemPath = itemURL.path
                
                // Check if this directory is a Git repository
                if isGitRepository(at: itemPath) {
                    let repository = await createDiscoveredRepository(at: itemPath)
                    repositories.append(repository)
                } else {
                    // Recursively scan subdirectories
                    let subdirectoryRepos = await scanDirectory(itemPath, depth: depth + 1)
                    repositories.append(contentsOf: subdirectoryRepos)
                }
            }
            
            return repositories
            
        } catch {
            Logger.repositoryDiscovery.error("Error scanning directory \(path): \(error)")
            return []
        }
    }
    
    /// Check if a directory is a Git repository
    private nonisolated func isGitRepository(at path: String) -> Bool {
        let gitPath = URL(fileURLWithPath: path).appendingPathComponent(".git").path
        return FileManager.default.fileExists(atPath: gitPath)
    }
    
    /// Create a DiscoveredRepository from a path
    private nonisolated func createDiscoveredRepository(at path: String) async -> DiscoveredRepository {
        let url = URL(fileURLWithPath: path)
        let folderName = url.lastPathComponent
        
        // Get last modified date
        let lastModified = getLastModifiedDate(at: path)
        
        // Get GitHub URL (this might be slow, so we do it in background)
        let githubURL = GitRepository.getGitHubURL(for: path)
        
        return DiscoveredRepository(
            path: path,
            folderName: folderName,
            lastModified: lastModified,
            githubURL: githubURL
        )
    }
    
    /// Get the last modified date of a repository
    nonisolated private func getLastModifiedDate(at path: String) -> Date {
        do {
            let attributes = try FileManager.default.attributesOfItem(atPath: path)
            return attributes[.modificationDate] as? Date ?? Date.distantPast
        } catch {
            Logger.repositoryDiscovery.debug("Could not get modification date for \(path): \(error)")
            return Date.distantPast
        }
    }
}

// MARK: - DiscoveredRepository

/// A lightweight repository representation for discovery purposes
public struct DiscoveredRepository: Identifiable, Hashable, Sendable {
    public let id = UUID()
    public let path: String
    public let folderName: String
    public let lastModified: Date
    public let githubURL: URL?
    
    /// Display name for the repository
    public var displayName: String {
        folderName
    }
    
    /// Relative path from home directory if applicable
    public var relativePath: String {
        let homeDir = NSHomeDirectory()
        if path.hasPrefix(homeDir) {
            return "~" + path.dropFirst(homeDir.count)
        }
        return path
    }
    
    /// Formatted last modified date
    public var formattedLastModified: String {
        let formatter = DateFormatter()
        formatter.dateStyle = .short
        formatter.timeStyle = .none
        return formatter.string(from: lastModified)
    }
}
