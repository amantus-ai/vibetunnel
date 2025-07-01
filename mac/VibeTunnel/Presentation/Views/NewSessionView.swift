import AppKit
import SwiftUI

/// Native macOS dialog for creating new terminal sessions
struct NewSessionView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(ServerManager.self) private var serverManager

    // Form fields
    @State private var sessionName = ""
    @State private var command = "zsh"
    @State private var workingDirectory = "~/"
    @State private var spawnWindow = true
    @State private var titleMode: TitleMode = .dynamic

    // UI state
    @State private var isCreating = false
    @State private var showError = false
    @State private var errorMessage = ""
    @FocusState private var focusedField: Field?

    /// Quick commands
    private let quickCommands = [
        ("claude", "✨"),
        ("aider", "✨"),
        ("zsh", nil),
        ("python3", nil),
        ("node", nil),
        ("pnpm run dev", "▶️")
    ]

    enum Field: Hashable {
        case name
        case command
        case directory
    }

    enum TitleMode: String, CaseIterable {
        case none = "none"
        case filter = "filter"
        case `static` = "static"
        case dynamic = "dynamic"

        var displayName: String {
            switch self {
            case .none: "None"
            case .filter: "Filter"
            case .static: "Static"
            case .dynamic: "Dynamic"
            }
        }

        var description: String {
            switch self {
            case .none: "Apps control their own titles"
            case .filter: "Block all title changes"
            case .static: "Show path and command"
            case .dynamic: "Show activity indicators"
            }
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            // Form content
            Form {
                // Command Section
                Section {
                    // Command field with integrated name
                    HStack(alignment: .center, spacing: 12) {
                        TextField("Command", text: $command)
                            .textFieldStyle(.squareBorder)
                            .focused($focusedField, equals: .command)
                            .onChange(of: command) { _, newValue in
                                // Auto-select dynamic title mode for AI tools
                                if newValue.lowercased().contains("claude") ||
                                    newValue.lowercased().contains("aider")
                                {
                                    titleMode = .dynamic
                                }
                            }

                        // Optional session name
                        TextField("Session Name (optional)", text: $sessionName)
                            .textFieldStyle(.squareBorder)
                            .focused($focusedField, equals: .name)
                            .frame(width: 160)
                    }

                    // Working Directory
                    HStack(spacing: 8) {
                        Text("Working Directory")
                            .foregroundColor(.secondary)
                            .frame(width: 120, alignment: .trailing)

                        TextField("", text: $workingDirectory)
                            .textFieldStyle(.squareBorder)
                            .focused($focusedField, equals: .directory)

                        Button(action: selectDirectory) {
                            Image(systemName: "folder")
                        }
                        .buttonStyle(.borderless)
                    }
                }

                // Quick Start Grid
                Section("Quick Start") {
                    LazyVGrid(columns: [
                        GridItem(.flexible()),
                        GridItem(.flexible()),
                        GridItem(.flexible())
                    ], spacing: 8) {
                        ForEach(quickCommands, id: \.0) { cmd in
                            Button(action: {
                                command = cmd.0
                                // Clear session name when selecting quick command
                                sessionName = ""
                            }) {
                                HStack(spacing: 4) {
                                    if let emoji = cmd.1 {
                                        Text(emoji)
                                            .font(.system(size: 13))
                                    }
                                    Text(cmd.0)
                                        .font(.system(size: 12))
                                    Spacer()
                                }
                                .frame(maxWidth: .infinity)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 6)
                                .background(Color.secondary.opacity(0.1))
                                .cornerRadius(6)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.vertical, 4)
                }

                Divider()
                    .padding(.vertical, 8)

                // Options Section
                Section {
                    // Terminal Title Mode - Single line
                    HStack(spacing: 12) {
                        Text("Terminal Title Mode")
                            .foregroundColor(.secondary)
                            .frame(width: 120, alignment: .trailing)

                        Picker("", selection: $titleMode) {
                            ForEach(TitleMode.allCases, id: \.self) { mode in
                                Text(mode.displayName)
                                    .tag(mode)
                            }
                        }
                        .pickerStyle(.segmented)
                        .frame(width: 200)

                        Text(titleMode.description)
                            .font(.system(size: 11))
                            .foregroundColor(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    // Open in Terminal Window - Toggle on right
                    HStack {
                        Text("Open in Terminal Window")
                            .foregroundColor(.secondary)
                            .frame(width: 120, alignment: .trailing)

                        Text("Launch session in native terminal app")
                            .font(.system(size: 11))
                            .foregroundColor(.secondary)

                        Spacer()

                        Toggle("", isOn: $spawnWindow)
                            .toggleStyle(.switch)
                            .labelsHidden()
                    }
                }
            }
            .formStyle(.grouped)
            .scrollDisabled(true)
            .padding(.top, 12)

            // Buttons
            HStack {
                Button("Cancel") {
                    dismiss()
                }
                .keyboardShortcut(.escape, modifiers: [])

                Spacer()

                Button(action: createSession) {
                    if isCreating {
                        HStack(spacing: 4) {
                            ProgressView()
                                .scaleEffect(0.7)
                                .controlSize(.small)
                            Text("Creating...")
                        }
                    } else {
                        Text("Create")
                    }
                }
                .keyboardShortcut(.return, modifiers: [])
                .disabled(isCreating || !isFormValid)
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 16)
            .background(Color(NSColor.controlBackgroundColor))
        }
        .frame(width: 620, height: 380)
        .background(Color(NSColor.windowBackgroundColor))
        .onAppear {
            loadPreferences()
            focusedField = .command
        }
        .alert("Error", isPresented: $showError) {
            Button("OK") {}
        } message: {
            Text(errorMessage)
        }
    }

    // MARK: - Computed Properties

    private var isFormValid: Bool {
        !command.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            !workingDirectory.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    // MARK: - Actions

    private func selectDirectory() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.directoryURL = URL(fileURLWithPath: NSString(string: workingDirectory).expandingTildeInPath)

        if panel.runModal() == .OK, let url = panel.url {
            let path = url.path
            let homeDir = NSHomeDirectory()
            if path.hasPrefix(homeDir) {
                workingDirectory = "~" + path.dropFirst(homeDir.count)
            } else {
                workingDirectory = path
            }
        }
    }

    private func createSession() {
        guard isFormValid else { return }

        // Check if server is running
        guard serverManager.isRunning else {
            errorMessage = "Server is not running. Please start the server first."
            showError = true
            return
        }

        isCreating = true
        savePreferences()

        Task {
            do {
                // Parse command into array
                let commandArray = parseCommand(command.trimmingCharacters(in: .whitespacesAndNewlines))

                // Expand tilde in working directory
                let expandedWorkingDir = NSString(string: workingDirectory).expandingTildeInPath

                // Prepare request body
                var body: [String: Any] = [
                    "command": commandArray,
                    "workingDir": expandedWorkingDir,
                    "titleMode": titleMode.rawValue
                ]

                if !sessionName.isEmpty {
                    body["name"] = sessionName.trimmingCharacters(in: .whitespacesAndNewlines)
                }

                if spawnWindow {
                    body["spawn_terminal"] = true
                } else {
                    // Web sessions need terminal dimensions
                    body["cols"] = 120
                    body["rows"] = 30
                }

                // Create session
                let url = URL(string: "http://127.0.0.1:\(serverManager.port)/api/sessions")!
                var request = URLRequest(url: url)
                request.httpMethod = "POST"
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.setValue("localhost", forHTTPHeaderField: "Host")
                request.httpBody = try JSONSerialization.data(withJSONObject: body)

                let (data, response) = try await URLSession.shared.data(for: request)

                if let httpResponse = response as? HTTPURLResponse {
                    if httpResponse.statusCode == 201 {
                        // Success
                        if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                           let sessionId = json["id"] as? String
                        {
                            // If not spawning window, open in browser
                            if !spawnWindow {
                                if let webURL =
                                    URL(string: "http://127.0.0.1:\(serverManager.port)/?sessionId=\(sessionId)")
                                {
                                    NSWorkspace.shared.open(webURL)
                                }
                            }

                            await MainActor.run {
                                dismiss()
                            }
                        }
                    } else {
                        // Parse error response
                        var errorMessage = "Failed to create session"
                        if let errorData = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                           let error = errorData["error"] as? String
                        {
                            errorMessage = error
                        }

                        throw NSError(domain: "VibeTunnel", code: httpResponse.statusCode, userInfo: [
                            NSLocalizedDescriptionKey: errorMessage
                        ])
                    }
                } else {
                    throw NSError(domain: "VibeTunnel", code: 1, userInfo: [
                        NSLocalizedDescriptionKey: "Invalid server response"
                    ])
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
        if let savedCommand = UserDefaults.standard.string(forKey: "NewSession.command") {
            command = savedCommand
        }
        if let savedDir = UserDefaults.standard.string(forKey: "NewSession.workingDirectory") {
            workingDirectory = savedDir
        }

        // Check if spawn window preference has been explicitly set
        if UserDefaults.standard.object(forKey: "NewSession.spawnWindow") != nil {
            spawnWindow = UserDefaults.standard.bool(forKey: "NewSession.spawnWindow")
        } else {
            // Default to true if never set
            spawnWindow = true
        }

        if let savedMode = UserDefaults.standard.string(forKey: "NewSession.titleMode"),
           let mode = TitleMode(rawValue: savedMode)
        {
            titleMode = mode
        }
    }

    private func savePreferences() {
        UserDefaults.standard.set(command, forKey: "NewSession.command")
        UserDefaults.standard.set(workingDirectory, forKey: "NewSession.workingDirectory")
        UserDefaults.standard.set(spawnWindow, forKey: "NewSession.spawnWindow")
        UserDefaults.standard.set(true, forKey: "NewSession.hasSetSpawnWindow")
        UserDefaults.standard.set(titleMode.rawValue, forKey: "NewSession.titleMode")
    }
}

// MARK: - Window Scene

struct NewSessionWindow: Scene {
    var body: some Scene {
        Window("New Session", id: "new-session") {
            NewSessionView()
                .environment(ServerManager.shared)
        }
        .windowStyle(.titleBar)
        .windowToolbarStyle(.unified(showsTitle: true))
        .windowResizability(.contentSize)
        .defaultPosition(.center)
    }
}
