import SwiftUI
import UniformTypeIdentifiers

struct NewSessionView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(SessionManager.self) private var sessionManager
    
    @State private var command = ""
    @State private var workingDirectory = ""
    @State private var sessionName = ""
    @State private var spawnInNativeTerminal = false
    @State private var isCreating = false
    @State private var error: Error?
    
    @FocusState private var focusedField: Field?
    
    private let quickCommands = [
        ("zsh", "zsh"),
        ("bash", "bash"),
        ("python3", "python3"),
        ("node", "node"),
        ("npm run dev", "npm run dev"),
        ("claude", "claude")
    ]
    
    enum Field {
        case command, workingDirectory, name
    }
    
    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text("New Session")
                    .font(Theme.Typography.title2)
                
                Spacer()
                
                Button("Cancel") {
                    dismiss()
                }
                .keyboardShortcut(.escape)
            }
            .padding(Theme.Spacing.lg)
            
            Divider()
            
            // Form
            Form {
                // Command section
                Section {
                    VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                        Text("Command")
                            .font(Theme.Typography.headline)
                        
                        TextField("Enter command to run...", text: $command)
                            .textFieldStyle(.roundedBorder)
                            .focused($focusedField, equals: .command)
                            .onSubmit {
                                focusedField = .workingDirectory
                            }
                        
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: Theme.Spacing.xs) {
                                ForEach(quickCommands, id: \.0) { label, cmd in
                                    Button(label) {
                                        command = cmd
                                    }
                                    .buttonStyle(.bordered)
                                    .controlSize(.small)
                                }
                            }
                        }
                    }
                }
                
                // Working directory section
                Section {
                    VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                        Text("Working Directory")
                            .font(Theme.Typography.headline)
                        
                        HStack {
                            TextField("Enter path...", text: $workingDirectory)
                                .textFieldStyle(.roundedBorder)
                                .focused($focusedField, equals: .workingDirectory)
                                .onSubmit {
                                    focusedField = .name
                                }
                            
                            Button("Browse...") {
                                selectDirectory()
                            }
                        }
                    }
                }
                
                // Options section
                Section {
                    VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                        Text("Options")
                            .font(Theme.Typography.headline)
                        
                        TextField("Session name (optional)", text: $sessionName)
                            .textFieldStyle(.roundedBorder)
                            .focused($focusedField, equals: .name)
                            .onSubmit {
                                createSession()
                            }
                        
                        Toggle("Open in native Terminal", isOn: $spawnInNativeTerminal)
                            .help("Opens the session in Terminal.app instead of VibeTunnel")
                    }
                }
                
                // Error display
                if let error {
                    Section {
                        HStack {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundStyle(Theme.Colors.error)
                            
                            Text(error.localizedDescription)
                                .font(Theme.Typography.caption)
                                .foregroundStyle(Theme.Colors.error)
                            
                            Spacer()
                        }
                        .padding(Theme.Spacing.sm)
                        .background(Theme.Colors.error.opacity(0.1))
                        .cornerRadius(Theme.Sizes.cornerRadius)
                    }
                }
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
            
            Divider()
            
            // Footer
            HStack {
                Spacer()
                
                Button("Cancel") {
                    dismiss()
                }
                .keyboardShortcut(.escape)
                
                Button("Create") {
                    createSession()
                }
                .primaryButtonStyle()
                .disabled(command.isEmpty || workingDirectory.isEmpty || isCreating)
                .keyboardShortcut(.return, modifiers: .command)
            }
            .padding(Theme.Spacing.lg)
        }
        .frame(width: 600, height: 500)
        .background(Theme.Colors.background)
        .onAppear {
            loadDefaults()
            focusedField = .command
        }
    }
    
    private func loadDefaults() {
        // Load last used values from UserDefaults
        let defaults = UserDefaults.standard
        command = defaults.string(forKey: "LastUsedCommand") ?? ""
        workingDirectory = defaults.string(forKey: "LastUsedWorkingDirectory") ?? FileManager.default.homeDirectoryForCurrentUser.path
    }
    
    private func saveDefaults() {
        let defaults = UserDefaults.standard
        defaults.set(command, forKey: "LastUsedCommand")
        defaults.set(workingDirectory, forKey: "LastUsedWorkingDirectory")
    }
    
    private func selectDirectory() {
        let panel = NSOpenPanel()
        panel.title = "Select Working Directory"
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = true
        
        if !workingDirectory.isEmpty {
            panel.directoryURL = URL(fileURLWithPath: workingDirectory)
        }
        
        if panel.runModal() == .OK,
           let url = panel.url {
            workingDirectory = url.path
        }
    }
    
    private func createSession() {
        guard !command.isEmpty && !workingDirectory.isEmpty else { return }
        
        isCreating = true
        error = nil
        
        Task {
            do {
                saveDefaults()
                
                let session = try await sessionManager.createSession(
                    command: command,
                    workingDirectory: workingDirectory,
                    name: sessionName.isEmpty ? nil : sessionName,
                    spawnInNativeTerminal: spawnInNativeTerminal
                )
                
                await MainActor.run {
                    dismiss()
                    
                    // If not spawned in native terminal, navigate to the new session
                    if session != nil {
                        // TODO: Open terminal window for session
                    }
                }
            } catch {
                await MainActor.run {
                    self.error = error
                    isCreating = false
                }
            }
        }
    }
}

#Preview {
    NewSessionView()
        .environment(SessionManager())
}