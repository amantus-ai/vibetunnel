import SwiftUI

/// Project folder configuration page in the welcome flow.
///
/// Allows users to select their primary project directory for repository discovery
/// and new session defaults. This path will be synced to the web UI settings.
struct ProjectFolderPageView: View {
    @AppStorage(AppConstants.UserDefaultsKeys.repositoryBasePath)
    private var repositoryBasePath = AppConstants.Defaults.repositoryBasePath

    @State private var selectedPath = ""
    @State private var isShowingPicker = false
    @State private var discoveredRepos: [RepositoryInfo] = []
    @State private var isScanning = false

    struct RepositoryInfo: Identifiable {
        let id = UUID()
        let name: String
        let path: String
    }

    var body: some View {
        VStack(spacing: 24) {
            // Title and description
            VStack(spacing: 12) {
                Text("Choose Your Project Folder")
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundColor(.primary)

                Text(
                    "Select the folder where you keep your projects. VibeTunnel will use this for quick access and repository discovery."
                )
                .font(.system(size: 14))
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 400)
            }

            // Folder picker section
            VStack(alignment: .leading, spacing: 12) {
                Text("Project Folder")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(.secondary)

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

                // Repository preview
                if !selectedPath.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text("Discovered Repositories")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundColor(.secondary)

                            if isScanning {
                                ProgressView()
                                    .scaleEffect(0.5)
                                    .frame(width: 16, height: 16)
                            }

                            Spacer()
                        }

                        ScrollView {
                            VStack(alignment: .leading, spacing: 4) {
                                if discoveredRepos.isEmpty && !isScanning {
                                    Text("No repositories found in this folder")
                                        .font(.system(size: 11))
                                        .foregroundColor(.secondary)
                                        .italic()
                                        .padding(.vertical, 8)
                                } else {
                                    ForEach(discoveredRepos) { repo in
                                        HStack {
                                            Image(systemName: "folder.badge.gearshape")
                                                .font(.system(size: 11))
                                                .foregroundColor(.secondary)

                                            Text(repo.name)
                                                .font(.system(size: 11))
                                                .lineLimit(1)

                                            Spacer()
                                        }
                                        .padding(.vertical, 2)
                                    }
                                }
                            }
                        }
                        .frame(maxHeight: 100)
                        .padding(8)
                        .background(Color(NSColor.controlBackgroundColor).opacity(0.5))
                        .cornerRadius(6)
                    }
                }
            }
            .frame(maxWidth: 400)

            // Tips
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "lightbulb")
                        .font(.system(size: 12))
                        .foregroundColor(.orange)

                    Text("You can change this later in Settings → Application → Repository Base Path")
                        .font(.system(size: 11))
                        .foregroundColor(.secondary)
                }

                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "info.circle")
                        .font(.system(size: 12))
                        .foregroundColor(.blue)

                    Text("VibeTunnel will scan up to 3 levels deep for Git repositories")
                        .font(.system(size: 11))
                        .foregroundColor(.secondary)
                }
            }
            .frame(maxWidth: 400)
            .padding(.top, 12)
        }
        .padding(.horizontal, 40)
        .onAppear {
            selectedPath = repositoryBasePath
            if !selectedPath.isEmpty {
                scanForRepositories()
            }
        }
        .onChange(of: selectedPath) { _, newValue in
            repositoryBasePath = newValue
            if !newValue.isEmpty {
                scanForRepositories()
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
        isScanning = true
        discoveredRepos = []

        Task {
            let expandedPath = (selectedPath as NSString).expandingTildeInPath
            let repos = await findGitRepositories(in: expandedPath, maxDepth: 3)

            await MainActor.run {
                discoveredRepos = repos.prefix(10).map { path in
                    RepositoryInfo(name: URL(fileURLWithPath: path).lastPathComponent, path: path)
                }
                isScanning = false
            }
        }
    }

    private func findGitRepositories(in path: String, maxDepth: Int) async -> [String] {
        var repositories: [String] = []

        func scanDirectory(_ dirPath: String, depth: Int) {
            guard depth <= maxDepth else { return }

            do {
                let contents = try FileManager.default.contentsOfDirectory(atPath: dirPath)

                for item in contents {
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
                        scanDirectory(fullPath, depth: depth + 1)
                    }
                }
            } catch {
                // Ignore directories we can't read
            }
        }

        scanDirectory(path, depth: 0)
        return repositories
    }
}

#Preview {
    ProjectFolderPageView()
        .frame(width: 640, height: 300)
}
