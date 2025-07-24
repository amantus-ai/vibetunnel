import OSLog
import SwiftUI

/// Project folder configuration page in the welcome flow.
///
/// Allows users to select their primary project directory for repository discovery
/// and new session defaults. This path will be synced to the web UI settings.
struct ProjectFolderPageView: View {
    private let configManager = ConfigManager.shared

    @State private var selectedPath = ""
    @State private var isShowingPicker = false
    @State private var discoveredRepos: [RepositoryInfo] = []
    @State private var isScanning = false

    struct RepositoryInfo: Identifiable {
        let id = UUID()
        let name: String
        let path: String
    }

    @State private var scanTask: Task<Void, Never>?
    @Binding var currentPage: Int

    /// Page index for ProjectFolderPageView in the welcome flow
    private let pageIndex = 4

    var body: some View {
        VStack(spacing: 30) {
            VStack(spacing: 16) {
                Text("Choose Your Project Folder")
                    .font(.largeTitle)
                    .fontWeight(.semibold)

                Text(
                    "Select the folder where you keep your projects. VibeTunnel will use this for quick access and repository discovery."
                )
                .font(.body)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 480)
                .fixedSize(horizontal: false, vertical: true)

                // Folder and repository section
                VStack(spacing: 16) {
                    // Folder picker
                    HStack {
                        Text(selectedPath.isEmpty ? "~/" : selectedPath)
                            .font(.system(size: 13))
                            .foregroundColor(selectedPath.isEmpty ? .secondary : .primary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(Color(NSColor.controlBackgroundColor))
                            .cornerRadius(6)

                        Button("Choose...") {
                            showFolderPicker()
                        }
                        .buttonStyle(.bordered)
                    }
                    .frame(width: 350)

                    // Repository count
                    if !selectedPath.isEmpty {
                        HStack {
                            Image(systemName: "folder.badge.gearshape")
                                .font(.system(size: 12))
                                .foregroundColor(.secondary)

                            if isScanning {
                                Text("Scanning...")
                                    .font(.system(size: 12))
                                    .foregroundColor(.secondary)
                            } else if discoveredRepos.isEmpty {
                                Text("No repositories found")
                                    .font(.system(size: 12))
                                    .foregroundColor(.secondary)
                            } else {
                                Text(
                                    "\(discoveredRepos.count) repositor\(discoveredRepos.count == 1 ? "y" : "ies") found"
                                )
                                .font(.system(size: 12))
                                .foregroundColor(.primary)
                            }

                            Spacer()
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(Color(NSColor.controlBackgroundColor).opacity(0.5))
                        .cornerRadius(6)
                        .frame(width: 350)
                    }
                    // Tip
                    HStack(alignment: .top, spacing: 6) {
                        Text("You can change this later in Settings → Application → Repository")
                            .font(.system(size: 11))
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .frame(maxWidth: 350)
                    .padding(.top, 8)
                }
            }
            Spacer()
        }
        .padding()
        .onAppear {
            selectedPath = configManager.repositoryBasePath
        }
        .onChange(of: currentPage) { _, newPage in
            if newPage == pageIndex {
                // Page just became visible
                if !selectedPath.isEmpty {
                    scanForRepositories()
                }
            } else {
                // Page is no longer visible, cancel any ongoing scan
                scanTask?.cancel()
                // Ensure UI is reset if scan was in progress
                isScanning = false
            }
        }
        .onChange(of: selectedPath) { _, newValue in
            configManager.updateRepositoryBasePath(newValue)

            // Cancel any existing scan
            scanTask?.cancel()

            // Debounce path changes to prevent rapid successive scans
            scanTask = Task {
                // Add small delay to debounce rapid changes
                try? await Task.sleep(for: .milliseconds(300))
                guard !Task.isCancelled else { return }

                // Only scan if we're the current page
                if currentPage == pageIndex && !newValue.isEmpty {
                    await performScan()
                }
            }
        }
    }

    private func showFolderPicker() {
        let panel = NSOpenPanel()
        panel.title = "Choose Project Folder"
        panel.message = "Select the folder where you keep your projects"
        panel.prompt = "Choose"
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.canCreateDirectories = true
        panel.allowsMultipleSelection = false

        // Set initial directory
        if !selectedPath.isEmpty {
            let expandedPath = (selectedPath as NSString).expandingTildeInPath
            panel.directoryURL = URL(fileURLWithPath: expandedPath)
        } else {
            panel.directoryURL = URL(fileURLWithPath: NSHomeDirectory())
        }

        if panel.runModal() == .OK, let url = panel.url {
            let path = url.path
            let homePath = NSHomeDirectory()

            // Convert to ~/ format if it's in the home directory
            if path.hasPrefix(homePath) {
                selectedPath = "~" + path.dropFirst(homePath.count)
            } else {
                selectedPath = path
            }
        }
    }

    private func scanForRepositories() {
        // Cancel any existing scan
        scanTask?.cancel()

        scanTask = Task {
            await performScan()
        }
    }

    private func performScan() async {
        isScanning = true
        discoveredRepos = []

        let expandedPath = (selectedPath as NSString).expandingTildeInPath
        let repos = await findGitRepositories(in: expandedPath, maxDepth: 3)

        await MainActor.run {
            // Always update isScanning to false when done, regardless of cancellation
            if !Task.isCancelled {
                discoveredRepos = repos.map { path in
                    RepositoryInfo(name: URL(fileURLWithPath: path).lastPathComponent, path: path)
                }
            }
            isScanning = false
        }
    }

    private func findGitRepositories(in path: String, maxDepth: Int) async -> [String] {
        var repositories: [String] = []

        // Use a recursive async function that properly checks for cancellation
        func scanDirectory(_ dirPath: String, depth: Int) async {
            // Check for cancellation at each level
            guard !Task.isCancelled else { return }
            guard depth <= maxDepth else { return }

            do {
                let contents = try FileManager.default.contentsOfDirectory(atPath: dirPath)

                for item in contents {
                    // Check for cancellation in the loop
                    try Task.checkCancellation()

                    let fullPath = (dirPath as NSString).appendingPathComponent(item)
                    var isDirectory: ObjCBool = false

                    guard FileManager.default.fileExists(atPath: fullPath, isDirectory: &isDirectory),
                          isDirectory.boolValue else { continue }

                    // Skip hidden directories except .git
                    if item.hasPrefix(".") && item != ".git" { continue }

                    // Check if this directory contains .git
                    let gitPath = (fullPath as NSString).appendingPathComponent(".git")
                    if FileManager.default.fileExists(atPath: gitPath) {
                        repositories.append(fullPath)
                    } else {
                        // Recursively scan subdirectories
                        await scanDirectory(fullPath, depth: depth + 1)
                    }
                }
            } catch is CancellationError {
                // Task was cancelled, stop scanning
                return
            } catch let error as NSError
                where error.domain == NSCocoaErrorDomain && error.code == NSFileReadNoPermissionError
            {
                // Silently ignore permission errors - common for system directories
            } catch let error as NSError where error.domain == NSPOSIXErrorDomain && error.code == 1 {
                // Operation not permitted - another common permission error
            } catch {
                // Log unexpected errors for debugging
                Logger(subsystem: BundleIdentifiers.loggerSubsystem, category: "ProjectFolderPageView")
                    .debug("Unexpected error scanning \(dirPath): \(error)")
            }
        }

        // Run the scanning on a lower priority
        await Task(priority: .background) {
            await scanDirectory(path, depth: 0)
        }.value

        return repositories
    }
}

#Preview {
    ProjectFolderPageView(currentPage: .constant(4))
        .frame(width: 640, height: 300)
}
