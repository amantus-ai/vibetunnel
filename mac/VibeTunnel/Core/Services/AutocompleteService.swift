import AppKit
import Foundation
import Observation
import OSLog

/// Service for providing path autocompletion suggestions
@MainActor
@Observable
class AutocompleteService {
    private(set) var isLoading = false
    private(set) var suggestions: [PathSuggestion] = []

    private var currentTask: Task<Void, Never>?
    private var taskCounter = 0
    private let fileManager = FileManager.default
    private let logger = Logger(subsystem: BundleIdentifiers.loggerSubsystem, category: "AutocompleteService")
    private let gitMonitor: GitRepositoryMonitor

    /// Common repository search paths relative to home directory
    private nonisolated static let commonRepositoryPaths = [
        "/Projects",
        "/Developer",
        "/Documents",
        "/Desktop",
        "/Code",
        "/repos",
        "/git",
        "/src",
        "/work",
        "" // Home directory itself
    ]

    init(gitMonitor: GitRepositoryMonitor = GitRepositoryMonitor()) {
        self.gitMonitor = gitMonitor
    }

    /// Fetch autocomplete suggestions for the given path
    func fetchSuggestions(for partialPath: String) async {
        logger.debug("[AutocompleteService] fetchSuggestions called with: '\(partialPath)'")

        // Cancel any existing task
        currentTask?.cancel()

        guard !partialPath.isEmpty else {
            logger.debug("[AutocompleteService] Empty path, clearing suggestions")
            suggestions = []
            return
        }

        // Increment task counter to track latest task
        taskCounter += 1
        let thisTaskId = taskCounter
        logger.debug("[AutocompleteService] Starting task \(thisTaskId) for path: '\(partialPath)'")

        currentTask = Task {
            await performFetch(for: partialPath, taskId: thisTaskId)
        }

        // Wait for the task to complete
        await currentTask?.value
        logger.debug("[AutocompleteService] Task \(thisTaskId) awaited, suggestions count: \(self.suggestions.count)")
    }

    private func performFetch(for originalPath: String, taskId: Int) async {
        self.isLoading = true
        defer { self.isLoading = false }

        var partialPath = originalPath

        logger.debug("[AutocompleteService] performFetch - originalPath: '\(originalPath)'")

        // Handle tilde expansion
        if partialPath.hasPrefix("~") {
            let homeDir = NSHomeDirectory()
            if partialPath == "~" {
                partialPath = homeDir
            } else if partialPath.hasPrefix("~/") {
                partialPath = homeDir + partialPath.dropFirst(1)
            }
        }

        logger.debug("[AutocompleteService] After expansion - partialPath: '\(partialPath)'")

        // Determine directory and partial filename
        let (dirPath, partialName) = splitPath(partialPath)

        logger.debug("[AutocompleteService] After split - dirPath: '\(dirPath)', partialName: '\(partialName)'")

        // Check if task was cancelled
        if Task.isCancelled { return }

        // Get suggestions from filesystem
        let fsSuggestions = await getFileSystemSuggestions(
            directory: dirPath,
            partialName: partialName,
            originalPath: originalPath,
            taskId: taskId
        )

        // Check if task was cancelled
        if Task.isCancelled { return }

        // Also get git repository suggestions if searching by name
        let isSearchingByName = !originalPath.contains("/") ||
            (originalPath.split(separator: "/").count == 1 && !originalPath.hasSuffix("/"))

        var allSuggestions = fsSuggestions

        if isSearchingByName {
            // Get git repository suggestions from discovered repositories
            let repoSuggestions = await getRepositorySuggestions(searchTerm: originalPath, taskId: taskId)

            // Check if task was cancelled
            if Task.isCancelled { return }

            // Merge with filesystem suggestions, avoiding duplicates
            let existingPaths = Set(fsSuggestions.map(\.suggestion))
            let uniqueRepos = repoSuggestions.filter { !existingPaths.contains($0.suggestion) }
            allSuggestions.append(contentsOf: uniqueRepos)
        }

        // Sort suggestions
        let sortedSuggestions = sortSuggestions(allSuggestions, searchTerm: partialName)

        // Limit to 20 results before enriching with Git info
        let limitedSuggestions = Array(sortedSuggestions.prefix(20))

        // Enrich with Git info
        let enrichedSuggestions = await enrichSuggestionsWithGitInfo(limitedSuggestions)

        // Only update suggestions if this is still the latest task
        if taskId == taskCounter {
            self.suggestions = enrichedSuggestions

            logger
                .debug(
                    "[AutocompleteService] Task \(taskId) updated suggestions. Final count: \(self.suggestions.count), items: \(self.suggestions.map(\.name).joined(separator: ", "))"
                )
        } else {
            logger
                .debug(
                    "[AutocompleteService] Discarding stale results from task \(taskId), current task is \(self.taskCounter)"
                )
        }
    }

    private func splitPath(_ path: String) -> (directory: String, partialName: String) {
        if path.hasSuffix("/") {
            return (path, "")
        } else {
            let url = URL(fileURLWithPath: path)
            return (url.deletingLastPathComponent().path, url.lastPathComponent)
        }
    }

    private func getFileSystemSuggestions(
        directory: String,
        partialName: String,
        originalPath: String,
        taskId: Int
    )
        async -> [PathSuggestion]
    {
        // Move to background thread to avoid blocking UI
        await Task.detached(priority: .userInitiated) { [logger = self.logger] in
            let expandedDir = NSString(string: directory).expandingTildeInPath
            let fileManager = FileManager.default

            guard fileManager.fileExists(atPath: expandedDir) else {
                return []
            }

            do {
                // Check if this task is still current before doing expensive operations
                if Task.isCancelled {
                    logger.debug("[AutocompleteService] Task \(taskId) cancelled, not processing directory listing")
                    return []
                }

                let contents = try fileManager.contentsOfDirectory(atPath: expandedDir)

                // Debug logging
                let matching = contents.filter { filename in
                    partialName.isEmpty || filename.lowercased().hasPrefix(partialName.lowercased())
                }
                logger
                    .debug(
                        "[AutocompleteService] Directory: \(expandedDir), PartialName: '\(partialName)', Total items: \(contents.count), Matching: \(matching.count) - \(matching.joined(separator: ", "))"
                    )

                return contents.compactMap { filename -> PathSuggestion? in
                    // Filter by partial name (case-insensitive)
                    if !partialName.isEmpty &&
                        !filename.lowercased().hasPrefix(partialName.lowercased())
                    {
                        return nil
                    }

                    // Skip hidden files unless explicitly searching for them
                    if !partialName.hasPrefix(".") && filename.hasPrefix(".") {
                        return nil
                    }

                    let fullPath = (expandedDir as NSString).appendingPathComponent(filename)
                    var isDirectory: ObjCBool = false
                    fileManager.fileExists(atPath: fullPath, isDirectory: &isDirectory)

                    // Build display path
                    let displayPath: String = if originalPath.hasSuffix("/") {
                        originalPath + filename
                    } else {
                        if let lastSlash = originalPath.lastIndex(of: "/") {
                            String(originalPath[..<originalPath.index(after: lastSlash)]) + filename
                        } else {
                            filename
                        }
                    }

                    // Check if it's a git repository
                    let isGitRepo = isDirectory.boolValue &&
                        fileManager.fileExists(atPath: (fullPath as NSString).appendingPathComponent(".git"))

                    return PathSuggestion(
                        name: filename,
                        path: displayPath,
                        type: isDirectory.boolValue ? .directory : .file,
                        suggestion: isDirectory.boolValue ? displayPath + "/" : displayPath,
                        isRepository: isGitRepo,
                        gitInfo: nil // Git info will be fetched later if needed
                    )
                }
            } catch {
                return []
            }
        }.value
    }

    private func getRepositorySuggestions(searchTerm: String, taskId: Int) async -> [PathSuggestion] {
        // Get git repositories from common locations
        await Task.detached(priority: .userInitiated) { [logger = self.logger] in
            var suggestions: [PathSuggestion] = []
            let fileManager = FileManager.default

            // Check if this task is still current
            if Task.isCancelled {
                logger.debug("[AutocompleteService] Task cancelled, not processing repository search")
                return []
            }

            // Common repository locations
            let homeDir = NSHomeDirectory()
            let searchPaths = Self.commonRepositoryPaths.map { path in
                path.isEmpty ? homeDir : homeDir + path
            }

            let lowercasedTerm = searchTerm.lowercased()

            for basePath in searchPaths {
                guard fileManager.fileExists(atPath: basePath) else { continue }

                // Check if task is still current
                if Task.isCancelled {
                    return []
                }

                do {
                    let contents = try fileManager.contentsOfDirectory(atPath: basePath)

                    for item in contents {
                        // Skip if doesn't match search term
                        if !lowercasedTerm.isEmpty && !item.lowercased().contains(lowercasedTerm) {
                            continue
                        }

                        let fullPath = (basePath as NSString).appendingPathComponent(item)
                        var isDirectory: ObjCBool = false

                        guard fileManager.fileExists(atPath: fullPath, isDirectory: &isDirectory),
                              isDirectory.boolValue else { continue }

                        // Check if it's a git repository
                        let gitPath = (fullPath as NSString).appendingPathComponent(".git")
                        if fileManager.fileExists(atPath: gitPath) {
                            let displayPath = fullPath.replacingOccurrences(of: NSHomeDirectory(), with: "~")

                            suggestions.append(PathSuggestion(
                                name: item,
                                path: displayPath,
                                type: .directory,
                                suggestion: fullPath + "/",
                                isRepository: true,
                                gitInfo: nil // Git info will be fetched later if needed
                            ))
                        }
                    }
                } catch {
                    // Ignore errors for individual directories
                    continue
                }
            }

            return suggestions
        }.value
    }

    private func sortSuggestions(_ suggestions: [PathSuggestion], searchTerm: String) -> [PathSuggestion] {
        let lowercasedTerm = searchTerm.lowercased()

        return suggestions.sorted { first, second in
            // Direct name matches come first
            let firstNameMatch = first.name.lowercased() == lowercasedTerm
            let secondNameMatch = second.name.lowercased() == lowercasedTerm
            if firstNameMatch != secondNameMatch {
                return firstNameMatch
            }

            // Name starts with search term
            let firstStartsWith = first.name.lowercased().hasPrefix(lowercasedTerm)
            let secondStartsWith = second.name.lowercased().hasPrefix(lowercasedTerm)
            if firstStartsWith != secondStartsWith {
                return firstStartsWith
            }

            // Directories before files
            if first.type != second.type {
                return first.type == .directory
            }

            // Git repositories before regular directories
            if first.type == .directory && second.type == .directory {
                if first.isRepository != second.isRepository {
                    return first.isRepository
                }
            }

            // Alphabetical order
            return first.name.localizedCompare(second.name) == .orderedAscending
        }
    }

    /// Clear all suggestions
    func clearSuggestions() {
        currentTask?.cancel()
        suggestions = []
    }

    /// Fetch Git info for directory suggestions
    private func enrichSuggestionsWithGitInfo(_ suggestions: [PathSuggestion]) async -> [PathSuggestion] {
        await withTaskGroup(of: (Int, GitInfo?).self) { group in
            var enrichedSuggestions = suggestions

            // Only fetch Git info for directories and repositories
            for (index, suggestion) in suggestions.enumerated() where suggestion.type == .directory {
                group.addTask { [gitMonitor = self.gitMonitor] in
                    // Expand path for Git lookup
                    let expandedPath = NSString(
                        string: suggestion.suggestion
                            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
                    ).expandingTildeInPath
                    let gitInfo = await gitMonitor.findRepository(for: expandedPath).map { repo in
                        GitInfo(
                            branch: repo.currentBranch,
                            aheadCount: repo.aheadCount,
                            behindCount: repo.behindCount,
                            hasChanges: repo.hasChanges,
                            isWorktree: repo.isWorktree
                        )
                    }
                    return (index, gitInfo)
                }
            }

            // Collect results
            for await (index, gitInfo) in group {
                if let gitInfo {
                    enrichedSuggestions[index] = PathSuggestion(
                        name: enrichedSuggestions[index].name,
                        path: enrichedSuggestions[index].path,
                        type: enrichedSuggestions[index].type,
                        suggestion: enrichedSuggestions[index].suggestion,
                        isRepository: true, // If we have Git info, it's a repository
                        gitInfo: gitInfo
                    )
                }
            }

            return enrichedSuggestions
        }
    }

    private func getRepositorySuggestions(searchTerm: String) async -> [PathSuggestion] {
        // Since we can't directly access RepositoryDiscoveryService from here,
        // we'll need to discover repositories inline or pass them as a parameter
        // For now, let's scan common locations for git repositories

        await Task.detached(priority: .userInitiated) {
            let fileManager = FileManager.default
            let searchLower = searchTerm.lowercased().replacingOccurrences(of: "~/", with: "")
            let homeDir = NSHomeDirectory()
            let commonPaths = Self.commonRepositoryPaths
                .filter { !$0.isEmpty } // Exclude home directory for this method
                .map { homeDir + $0 }

            var repositories: [PathSuggestion] = []

            for basePath in commonPaths {
                guard fileManager.fileExists(atPath: basePath) else { continue }

                do {
                    let contents = try fileManager.contentsOfDirectory(atPath: basePath)
                    for item in contents {
                        let fullPath = (basePath as NSString).appendingPathComponent(item)
                        var isDirectory: ObjCBool = false

                        guard fileManager.fileExists(atPath: fullPath, isDirectory: &isDirectory),
                              isDirectory.boolValue else { continue }

                        // Check if it's a git repository
                        let gitPath = (fullPath as NSString).appendingPathComponent(".git")
                        guard fileManager.fileExists(atPath: gitPath) else { continue }

                        // Check if name matches search term
                        guard item.lowercased().contains(searchLower) else { continue }

                        // Convert to tilde path if in home directory
                        let displayPath = fullPath.hasPrefix(homeDir) ?
                            "~" + fullPath.dropFirst(homeDir.count) : fullPath

                        repositories.append(PathSuggestion(
                            name: item,
                            path: displayPath,
                            type: .directory,
                            suggestion: displayPath + "/",
                            isRepository: true,
                            gitInfo: nil // Git info will be fetched later if needed
                        ))
                    }
                } catch {
                    // Ignore errors for individual directories
                    continue
                }
            }

            return repositories
        }.value
    }
}
