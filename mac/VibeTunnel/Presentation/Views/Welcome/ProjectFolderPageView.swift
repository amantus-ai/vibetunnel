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
                discoveredRepos = repos.map { path in
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
