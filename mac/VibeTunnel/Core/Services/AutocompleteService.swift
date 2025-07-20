import AppKit
import Foundation

/// Service for providing path autocompletion suggestions
@MainActor
class AutocompleteService: ObservableObject {
    @Published private(set) var isLoading = false
    @Published private(set) var suggestions: [PathSuggestion] = []

    private var currentTask: Task<Void, Never>?
    private let fileManager = FileManager.default

    struct PathSuggestion: Identifiable, Equatable {
        let id = UUID()
        let name: String
        let path: String
        let type: SuggestionType
        let suggestion: String // The complete path to insert
        let isRepository: Bool

        enum SuggestionType {
            case file
            case directory
        }
    }

    /// Fetch autocomplete suggestions for the given path
    func fetchSuggestions(for partialPath: String) async {
        // Cancel any existing task
        currentTask?.cancel()

        guard !partialPath.isEmpty else {
            suggestions = []
            return
        }

        currentTask = Task {
            await performFetch(for: partialPath)
        }
    }

    private func performFetch(for originalPath: String) async {
        isLoading = true
        defer { isLoading = false }

        var partialPath = originalPath

        // Handle tilde expansion
        if partialPath.hasPrefix("~") {
            let homeDir = NSHomeDirectory()
            if partialPath == "~" {
                partialPath = homeDir
            } else if partialPath.hasPrefix("~/") {
                partialPath = homeDir + partialPath.dropFirst(1)
            }
        }

        // Determine directory and partial filename
        let (dirPath, partialName) = splitPath(partialPath)

        // Check if task was cancelled
        if Task.isCancelled { return }

        // Get suggestions from filesystem
        let fsSuggestions = await getFileSystemSuggestions(
            directory: dirPath,
            partialName: partialName,
            originalPath: originalPath
        )

        // Check if task was cancelled
        if Task.isCancelled { return }

        // Also get git repository suggestions if searching by name
        let isSearchingByName = !originalPath.contains("/") ||
            (originalPath.split(separator: "/").count == 1 && !originalPath.hasSuffix("/"))

        var allSuggestions = fsSuggestions

        if isSearchingByName {
            // Get git repository suggestions from discovered repositories
            let repoSuggestions = await getRepositorySuggestions(searchTerm: originalPath)

            // Merge with filesystem suggestions, avoiding duplicates
            let existingPaths = Set(fsSuggestions.map(\.suggestion))
            let uniqueRepos = repoSuggestions.filter { !existingPaths.contains($0.suggestion) }
            allSuggestions.append(contentsOf: uniqueRepos)
        }

        // Sort suggestions
        let sortedSuggestions = sortSuggestions(allSuggestions, searchTerm: partialName)

        // Limit to 20 results
        suggestions = Array(sortedSuggestions.prefix(20))
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
        originalPath: String
    )
        async -> [PathSuggestion]
    {
        let expandedDir = NSString(string: directory).expandingTildeInPath

        guard fileManager.fileExists(atPath: expandedDir) else {
            return []
        }

        do {
            let contents = try fileManager.contentsOfDirectory(atPath: expandedDir)

            return contents.compactMap { filename in
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
                    isRepository: isGitRepo
                )
            }
        } catch {
            return []
        }
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

    private func getRepositorySuggestions(searchTerm: String) async -> [PathSuggestion] {
        // Since we can't directly access RepositoryDiscoveryService from here,
        // we'll need to discover repositories inline or pass them as a parameter
        // For now, let's scan common locations for git repositories

        let searchLower = searchTerm.lowercased().replacingOccurrences(of: "~/", with: "")
        let homeDir = NSHomeDirectory()
        let commonPaths = [
            homeDir + "/Developer",
            homeDir + "/Projects",
            homeDir + "/Documents",
            homeDir + "/Desktop",
            homeDir + "/Code",
            homeDir + "/repos",
            homeDir + "/git"
        ]

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
                        isRepository: true
                    ))
                }
            } catch {
                // Ignore errors for individual directories
                continue
            }
        }

        return repositories
    }
}
