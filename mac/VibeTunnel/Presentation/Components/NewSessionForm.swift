import SwiftUI

/// Compact new session form designed for the popover.
///
/// Provides a streamlined interface for creating new terminal sessions with
/// options for command selection, naming, directory settings, and window spawning.
/// Integrates with the server to create sessions both in terminal windows and web browsers.
struct NewSessionForm: View {
    @Binding var isPresented: Bool
    @Environment(ServerManager.self)
    private var serverManager
    @Environment(SessionMonitor.self)
    private var sessionMonitor
    @Environment(SessionService.self)
    private var sessionService
    @Environment(RepositoryDiscoveryService.self)
    private var repositoryDiscovery
    @StateObject private var configManager = ConfigManager.shared

    // Form fields
    @State private var command = "zsh"
    @State private var sessionName = ""
    @State private var workingDirectory = FilePathConstants.defaultRepositoryBasePath
    @State private var spawnWindow = true
    @State private var titleMode: TitleMode = .dynamic

    // UI state
    @State private var isCreating = false
    @State private var showError = false
    @State private var errorMessage = ""
    @State private var isHoveringCreate = false
    @FocusState private var focusedField: Field?

    enum Field: Hashable {
        case command
        case name
        case directory
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header with back button
            HStack {
                Button(action: {
                    isPresented = false
                }, label: {
                    HStack(spacing: 4) {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 11, weight: .medium))
                        Text("Sessions")
                            .font(.system(size: 12, weight: .medium))
                    }
                })
                .buttonStyle(.plain)
                .foregroundColor(.primary.opacity(0.8))

                Spacer()

                Text("New Session")
                    .font(.system(size: 13, weight: .semibold))

                Spacer()

                // Balance the back button
                Color.clear
                    .frame(width: 60)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(
                LinearGradient(
                    colors: [
                        Color(NSColor.controlBackgroundColor).opacity(0.6),
                        Color(NSColor.controlBackgroundColor).opacity(0.3)
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )

            Divider()

            // Form content
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    // Name field (first)
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Name")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(.secondary)

                        TextField("(optional)", text: $sessionName)
                            .textFieldStyle(.roundedBorder)
                            .focused($focusedField, equals: .name)
                    }

                    // Command field (second)
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Command")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(.secondary)

                        TextField("claude", text: $command)
                            .textFieldStyle(.roundedBorder)
                            .focused($focusedField, equals: .command)
                            .onChange(of: command) { _, newValue in
                                // Auto-select dynamic title mode for AI tools
                                if newValue.lowercased().contains("claude") ||
                                    newValue.lowercased().contains("gemini")
                                {
                                    titleMode = .dynamic
                                }
                            }
                    }

                    // Working Directory (third)
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Working Directory")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(.secondary)

                        VStack(alignment: .leading, spacing: 0) {
                            HStack(spacing: 8) {
                                AutocompleteTextField(text: $workingDirectory, placeholder: "~/")
                                    .focused($focusedField, equals: .directory)

                                Button(action: selectDirectory) {
                                    Image(systemName: "folder")
                                        .font(.system(size: 12))
                                        .foregroundColor(.secondary)
                                        .frame(width: 20, height: 20)
                                        .contentShape(Rectangle())
                                }
                                .buttonStyle(.borderless)
                                .help("Choose directory")
                            }
                        }
                    }

                    // Quick Start
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Quick Start")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(.secondary)

                        LazyVGrid(columns: [
                            GridItem(.flexible()),
                            GridItem(.flexible()),
                            GridItem(.flexible())
                        ], spacing: 8) {
                            ForEach(configManager.quickStartCommands) { cmd in
                                Button(action: {
                                    command = cmd.command
                                    sessionName = ""
                                }, label: {
                                    Text(cmd.displayName)
                                        .font(.system(size: 11))
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                        .padding(.horizontal, 12)
                                        .padding(.vertical, 6)
                                })
                                .background(
                                    RoundedRectangle(cornerRadius: 6)
                                        .fill(command == cmd.command ? Color.accentColor.opacity(0.15) : Color.primary
                                            .opacity(0.05)
                                        )
                                )
                                .overlay(
                                    RoundedRectangle(cornerRadius: 6)
                                        .stroke(
                                            command == cmd.command ? Color.accentColor.opacity(0.5) : Color.primary
                                                .opacity(0.1),
                                            lineWidth: 1
                                        )
                                )
                                .buttonStyle(.plain)
                            }
                        }
                    }

                    Divider()
                        .padding(.vertical, 4)

                    // Options
                    VStack(spacing: 16) {
                        // Title Mode with combo box - right aligned
                        HStack {
                            Text("Title Mode")
                                .font(.system(size: 11, weight: .medium))
                                .foregroundColor(.secondary)

                            Spacer()

                            Menu {
                                ForEach(TitleMode.allCases, id: \.self) { mode in
                                    Button(action: { titleMode = mode }, label: {
                                        HStack {
                                            Text(mode.displayName)
                                            if mode == titleMode {
                                                Image(systemName: "checkmark")
                                            }
                                        }
                                    })
                                }
                            } label: {
                                HStack(spacing: 4) {
                                    Text(titleMode.displayName)
                                        .font(.system(size: 11))
                                        .foregroundColor(.primary)
                                    Image(systemName: "chevron.up.chevron.down")
                                        .font(.system(size: 8, weight: .medium))
                                        .foregroundColor(.secondary)
                                }
                                .padding(.horizontal, 10)
                                .padding(.vertical, 4)
                                .background(
                                    RoundedRectangle(cornerRadius: 6)
                                        .fill(Color.primary.opacity(0.05))
                                )
                                .overlay(
                                    RoundedRectangle(cornerRadius: 6)
                                        .stroke(Color.primary.opacity(0.1), lineWidth: 1)
                                )
                            }
                            .menuStyle(.borderlessButton)
                            .menuIndicator(.hidden)
                            .fixedSize()
                        }

                        // Open in Terminal
                        HStack {
                            Text("Terminal")
                                .font(.system(size: 11, weight: .medium))
                                .foregroundColor(.secondary)

                            Text("Open in native terminal window")
                                .font(.system(size: 11))
                                .foregroundColor(.secondary.opacity(0.8))

                            Spacer()

                            Toggle("", isOn: $spawnWindow)
                                .toggleStyle(.switch)
                                .scaleEffect(0.8)
                                .labelsHidden()
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 16)
            }
            .frame(maxHeight: 400)

            Divider()

            // Create button with improved styling
            HStack {
                Spacer()

                Button(action: createSession) {
                    if isCreating {
                        HStack(spacing: 4) {
                            ProgressView()
                                .scaleEffect(0.7)
                                .controlSize(.small)
                            Text("Creating...")
                                .font(.system(size: 12))
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 3)
                    } else {
                        Text("Create")
                            .font(.system(size: 12))
                            .padding(.horizontal, 10)
                            .padding(.vertical, 3)
                    }
                }
                .buttonStyle(.plain)
                .foregroundColor(command.isEmpty || workingDirectory.isEmpty ? .secondary.opacity(0.5) : .secondary)
                .background(
                    RoundedRectangle(cornerRadius: 6)
                        .fill(isHoveringCreate && !command.isEmpty && !workingDirectory.isEmpty ? Color.accentColor
                            .opacity(0.05) : Color.clear
                        )
                        .animation(.easeInOut(duration: 0.2), value: isHoveringCreate)
                )
                .disabled(isCreating || command.isEmpty || workingDirectory.isEmpty)
                .onHover { hovering in
                    isHoveringCreate = hovering
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
        .frame(width: 384)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .fixedSize(horizontal: true, vertical: false)
        .onAppear {
            loadPreferences()
            focusedField = .name
        }
        .task {
            await repositoryDiscovery.discoverRepositories(in: configManager.repositoryBasePath)
        }
        .alert("Error", isPresented: $showError) {
            Button("OK") {}
        } message: {
            Text(errorMessage)
        }
        .compositingGroup() // Render the entire form as a single composited layer
    }

    private func selectDirectory() {
        // Find the menu window first
        guard let menuWindow = NSApp.windows.first(where: { $0 is CustomMenuWindow }) as? CustomMenuWindow else {
            return
        }
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.directoryURL = URL(fileURLWithPath: NSString(string: workingDirectory).expandingTildeInPath)
        // Set flag on the window to prevent it from hiding
        menuWindow.isFileSelectionInProgress = true
        // Use beginSheetModal to keep the window relationship
        panel.beginSheetModal(for: menuWindow) { response in
            Task { @MainActor in
                if response == .OK, let url = panel.url {
                    let path = url.path
                    let homeDir = NSHomeDirectory()
                    if path.hasPrefix(homeDir) {
                        self.workingDirectory = "~" + path.dropFirst(homeDir.count)
                    } else {
                        self.workingDirectory = path
                    }
                }

                // Clear the flag after selection completes
                menuWindow.isFileSelectionInProgress = false

                // Ensure the menu window regains focus
                menuWindow.makeKeyAndOrderFront(nil)
            }
        }
    }

    private func createSession() {
        guard !command.isEmpty && !workingDirectory.isEmpty else { return }

        isCreating = true
        savePreferences()

        Task {
            do {
                // Parse command into array
                let commandArray = parseCommand(command.trimmingCharacters(in: .whitespacesAndNewlines))

                // Expand tilde in working directory
                let expandedWorkingDir = NSString(string: workingDirectory).expandingTildeInPath

                // Create session using SessionService
                let sessionId = try await sessionService.createSession(
                    command: commandArray,
                    workingDir: expandedWorkingDir,
                    name: sessionName.isEmpty ? nil : sessionName.trimmingCharacters(in: .whitespacesAndNewlines),
                    titleMode: titleMode.rawValue,
                    spawnTerminal: spawnWindow
                )

                // If not spawning window, open in browser
                if !spawnWindow {
                    if let webURL = DashboardURLBuilder.dashboardURL(port: serverManager.port, sessionId: sessionId) {
                        NSWorkspace.shared.open(webURL)
                    }
                }

                await MainActor.run {
                    isPresented = false
                }
            } catch {
                await MainActor.run {
                    isCreating = false
                    errorMessage = error.localizedDescription
                    showError = true
                }
            }
        }
    }

    private func parseCommand(_ cmd: String) -> [String] {
        // Simple command parsing that respects quotes
        var result: [String] = []
        var current = ""
        var inQuotes = false
        var quoteChar: Character?

        for char in cmd {
            if !inQuotes && (char == "\"" || char == "'") {
                inQuotes = true
                quoteChar = char
            } else if inQuotes && char == quoteChar {
                inQuotes = false
                quoteChar = nil
            } else if !inQuotes && char == " " {
                if !current.isEmpty {
                    result.append(current)
                    current = ""
                }
            } else {
                current.append(char)
            }
        }

        if !current.isEmpty {
            result.append(current)
        }

        return result.isEmpty ? ["zsh"] : result
    }

    // MARK: - Preferences

    private func loadPreferences() {
        if let savedCommand = UserDefaults.standard.string(forKey: AppConstants.UserDefaultsKeys.newSessionCommand) {
            command = savedCommand
        }

        // Restore last used working directory, not repository base path
        if let savedDirectory = UserDefaults.standard
            .string(forKey: AppConstants.UserDefaultsKeys.newSessionWorkingDirectory)
        {
            workingDirectory = savedDirectory
        } else {
            // Default to repository base path if never set
            workingDirectory = configManager.sessionWorkingDirectory
        }

        // Check if spawn window preference has been explicitly set
        if UserDefaults.standard.object(forKey: AppConstants.UserDefaultsKeys.newSessionSpawnWindow) != nil {
            spawnWindow = UserDefaults.standard.bool(forKey: AppConstants.UserDefaultsKeys.newSessionSpawnWindow)
        } else {
            // Default to true if never set
            spawnWindow = true
        }

        if let savedMode = UserDefaults.standard.string(forKey: AppConstants.UserDefaultsKeys.newSessionTitleMode),
           let mode = TitleMode(rawValue: savedMode)
        {
            titleMode = mode
        }
    }

    private func savePreferences() {
        UserDefaults.standard.set(command, forKey: AppConstants.UserDefaultsKeys.newSessionCommand)
        UserDefaults.standard.set(workingDirectory, forKey: AppConstants.UserDefaultsKeys.newSessionWorkingDirectory)
        UserDefaults.standard.set(spawnWindow, forKey: AppConstants.UserDefaultsKeys.newSessionSpawnWindow)
        UserDefaults.standard.set(titleMode.rawValue, forKey: AppConstants.UserDefaultsKeys.newSessionTitleMode)
    }
}

// MARK: - Repository Dropdown List

private struct RepositoryDropdownList: View {
    let repositories: [DiscoveredRepository]
    let isDiscovering: Bool
    @Binding var selectedPath: String
    @Binding var isShowing: Bool

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(repositories) { repository in
                        Button(action: {
                            selectedPath = repository.path
                            isShowing = false
                        }, label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(repository.displayName)
                                        .font(.system(size: 11, weight: .medium))
                                        .foregroundColor(.primary)

                                    Text(repository.relativePath)
                                        .font(.system(size: 10))
                                        .foregroundColor(.secondary)
                                }

                                Spacer()

                                Text(repository.formattedLastModified)
                                    .font(.system(size: 10))
                                    .foregroundColor(.secondary)
                            }
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(
                                RoundedRectangle(cornerRadius: 4)
                                    .fill(Color.clear)
                            )
                            .contentShape(Rectangle())
                        })
                        .buttonStyle(.plain)
                        .onHover { hovering in
                            if hovering {
                                // Add hover effect if needed
                            }
                        }

                        if repository.id != repositories.last?.id {
                            Divider()
                                .padding(.horizontal, 8)
                        }
                    }
                }
            }
            .frame(maxHeight: 200)
        }
        .padding(.vertical, 4)
        .background(
            RoundedRectangle(cornerRadius: 6)
                .fill(.regularMaterial)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 6)
                .stroke(Color.primary.opacity(0.1), lineWidth: 1)
        )
    }
}
