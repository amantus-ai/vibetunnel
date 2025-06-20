import SwiftUI

struct SessionCreateView: View {
    @Binding var isPresented: Bool
    let onCreated: (String) -> Void
    
    @State private var command = "zsh"
    @State private var workingDirectory = "~"
    @State private var sessionName = ""
    @State private var isCreating = false
    @State private var errorMessage: String?
    @State private var showFileBrowser = false
    
    @FocusState private var focusedField: Field?
    
    enum Field {
        case command, workingDir, name
    }
    
    var body: some View {
        NavigationView {
            ZStack {
                Theme.Colors.terminalBackground
                    .ignoresSafeArea()
                
                ScrollView {
                    VStack(spacing: Theme.Spacing.lg) {
                        // Configuration Fields
                        VStack(spacing: Theme.Spacing.lg) {
                            // Command Field
                            VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                                Label("Command", systemImage: "terminal")
                                    .font(Theme.Typography.terminalSystem(size: 12))
                                    .foregroundColor(Theme.Colors.primaryAccent)
                                
                                TextField("zsh", text: $command)
                                    .textFieldStyle(TerminalTextFieldStyle())
                                    .autocapitalization(.none)
                                    .disableAutocorrection(true)
                                    .focused($focusedField, equals: .command)
                            }
                            
                            // Working Directory
                            VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                                Label("Working Directory", systemImage: "folder")
                                    .font(Theme.Typography.terminalSystem(size: 12))
                                    .foregroundColor(Theme.Colors.primaryAccent)
                                
                                HStack(spacing: Theme.Spacing.sm) {
                                    TextField("~", text: $workingDirectory)
                                        .textFieldStyle(TerminalTextFieldStyle())
                                        .autocapitalization(.none)
                                        .disableAutocorrection(true)
                                        .focused($focusedField, equals: .workingDir)
                                    
                                    Button(action: {
                                        HapticFeedback.impact(.light)
                                        showFileBrowser = true
                                    }) {
                                        Image(systemName: "folder")
                                            .font(.system(size: 16))
                                            .foregroundColor(Theme.Colors.primaryAccent)
                                            .frame(width: 44, height: 44)
                                            .background(
                                                RoundedRectangle(cornerRadius: Theme.CornerRadius.small)
                                                    .fill(Theme.Colors.cardBorder.opacity(0.1))
                                            )
                                            .overlay(
                                                RoundedRectangle(cornerRadius: Theme.CornerRadius.small)
                                                    .stroke(Theme.Colors.cardBorder.opacity(0.3), lineWidth: 1)
                                            )
                                    }
                                    .buttonStyle(PlainButtonStyle())
                                }
                            }
                            
                            // Session Name
                            VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                                Label("Session Name (Optional)", systemImage: "tag")
                                    .font(Theme.Typography.terminalSystem(size: 12))
                                    .foregroundColor(Theme.Colors.primaryAccent)
                                
                                TextField("My Session", text: $sessionName)
                                    .textFieldStyle(TerminalTextFieldStyle())
                                    .focused($focusedField, equals: .name)
                            }
                            
                            // Error Message
                            if let error = errorMessage {
                                HStack(spacing: Theme.Spacing.sm) {
                                    Image(systemName: "exclamationmark.triangle.fill")
                                        .font(.system(size: 14))
                                    Text(error)
                                        .font(Theme.Typography.terminalSystem(size: 13))
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                                .foregroundColor(Theme.Colors.errorAccent)
                                .padding(.horizontal, Theme.Spacing.md)
                                .padding(.vertical, Theme.Spacing.sm)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(
                                    RoundedRectangle(cornerRadius: Theme.CornerRadius.small)
                                        .fill(Theme.Colors.errorAccent.opacity(0.15))
                                )
                                .overlay(
                                    RoundedRectangle(cornerRadius: Theme.CornerRadius.small)
                                        .stroke(Theme.Colors.errorAccent.opacity(0.3), lineWidth: 1)
                                )
                                .transition(.asymmetric(
                                    insertion: .scale(scale: 0.95).combined(with: .opacity),
                                    removal: .scale(scale: 0.95).combined(with: .opacity)
                                ))
                            }
                        }
                        .padding(.horizontal)
                        .padding(.top, Theme.Spacing.lg)
                
                        // Quick Directories
                        if focusedField == .workingDir {
                            VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                                Text("COMMON DIRECTORIES")
                                    .font(Theme.Typography.terminalSystem(size: 10))
                                    .foregroundColor(Theme.Colors.terminalForeground.opacity(0.5))
                                    .tracking(1)
                                    .padding(.horizontal)
                                
                                ScrollView(.horizontal, showsIndicators: false) {
                                    HStack(spacing: Theme.Spacing.sm) {
                                    ForEach(commonDirectories, id: \.self) { dir in
                                        Button(action: {
                                            workingDirectory = dir
                                            HapticFeedback.selection()
                                        }) {
                                            HStack(spacing: 4) {
                                                Image(systemName: "folder.fill")
                                                    .font(.system(size: 12))
                                                Text(dir)
                                                    .font(Theme.Typography.terminalSystem(size: 13))
                                            }
                                            .foregroundColor(workingDirectory == dir ? Theme.Colors.terminalBackground : Theme.Colors.terminalForeground)
                                            .padding(.horizontal, 12)
                                            .padding(.vertical, 8)
                                            .background(
                                                RoundedRectangle(cornerRadius: Theme.CornerRadius.small)
                                                    .fill(workingDirectory == dir ? Theme.Colors.primaryAccent : Theme.Colors.cardBorder.opacity(0.1))
                                            )
                                            .overlay(
                                                RoundedRectangle(cornerRadius: Theme.CornerRadius.small)
                                                    .stroke(workingDirectory == dir ? Theme.Colors.primaryAccent : Theme.Colors.cardBorder.opacity(0.3), lineWidth: 1)
                                            )
                                        }
                                        .buttonStyle(PlainButtonStyle())
                                    }
                                    }
                                    .padding(.horizontal)
                                }
                            }
                        }
                        
                        // Quick Start Commands
                        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                            Text("QUICK START")
                                .font(Theme.Typography.terminalSystem(size: 10))
                                .foregroundColor(Theme.Colors.terminalForeground.opacity(0.5))
                                .tracking(1)
                                .padding(.horizontal)
                            
                            LazyVGrid(columns: [
                                GridItem(.flexible()),
                                GridItem(.flexible())
                            ], spacing: Theme.Spacing.sm) {
                                ForEach(recentCommands, id: \.self) { cmd in
                                    Button(action: {
                                        command = cmd
                                        HapticFeedback.selection()
                                    }) {
                                        HStack {
                                            Image(systemName: commandIcon(for: cmd))
                                                .font(.system(size: 14))
                                            Text(cmd)
                                                .font(Theme.Typography.terminalSystem(size: 14))
                                            Spacer()
                                        }
                                        .foregroundColor(command == cmd ? Theme.Colors.terminalBackground : Theme.Colors.terminalForeground)
                                        .padding(.horizontal, Theme.Spacing.md)
                                        .padding(.vertical, Theme.Spacing.sm)
                                        .background(
                                            RoundedRectangle(cornerRadius: Theme.CornerRadius.small)
                                                .fill(command == cmd ? Theme.Colors.primaryAccent : Theme.Colors.cardBorder.opacity(0.3))
                                        )
                                        .overlay(
                                            RoundedRectangle(cornerRadius: Theme.CornerRadius.small)
                                                .stroke(command == cmd ? Theme.Colors.primaryAccent : Theme.Colors.cardBorder, lineWidth: 1)
                                        )
                                    }
                                    .buttonStyle(PlainButtonStyle())
                                    .scaleEffect(command == cmd ? 0.95 : 1.0)
                                    .animation(Theme.Animation.quick, value: command == cmd)
                                }
                            }
                            .padding(.horizontal)
                        }
                        
                        Spacer(minLength: 40)
                    }
                }
            }
            .navigationBarHidden(true)
            .safeAreaInset(edge: .top) {
                // Custom Navigation Bar with proper safe area handling
                VStack(spacing: 0) {
                    HStack {
                        Button("Cancel") {
                            HapticFeedback.impact(.light)
                            isPresented = false
                        }
                        .font(.system(size: 17))
                        .foregroundColor(Theme.Colors.errorAccent)
                        
                        Spacer()
                        
                        Button(action: {
                            HapticFeedback.impact(.medium)
                            createSession()
                        }) {
                            if isCreating {
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle(tint: Theme.Colors.primaryAccent))
                                    .scaleEffect(0.8)
                            } else {
                                Text("Create")
                                    .font(.system(size: 17, weight: .semibold))
                            }
                        }
                        .foregroundColor(Theme.Colors.primaryAccent)
                        .disabled(isCreating || command.isEmpty)
                    }
                    .padding(.horizontal)
                    .padding(.vertical, 16)
                    .frame(maxWidth: .infinity)
                    .background(.ultraThinMaterial.opacity(0.8))
                }
            }
            .onAppear {
                loadDefaults()
                focusedField = .command
            }
        }
        .preferredColorScheme(.dark)
        .sheet(isPresented: $showFileBrowser) {
            FileBrowserView(initialPath: workingDirectory) { selectedPath in
                workingDirectory = selectedPath
                HapticFeedback.notification(.success)
            }
        }
    }
    
    private var recentCommands: [String] {
        ["zsh", "bash", "python3", "node", "npm run dev", "irb"]
    }
    
    private var commonDirectories: [String] {
        ["~", "~/Desktop", "~/Documents", "~/Downloads", "~/Projects", "/tmp"]
    }
    
    private func commandIcon(for command: String) -> String {
        switch command {
        case "zsh", "bash":
            return "terminal"
        case "python3":
            return "chevron.left.forwardslash.chevron.right"
        case "node":
            return "server.rack"
        case "npm run dev":
            return "play.circle"
        case "irb":
            return "diamond"
        default:
            return "terminal"
        }
    }
    
    private func loadDefaults() {
        // Load last used values
        if let lastCommand = UserDefaults.standard.string(forKey: "lastCommand") {
            command = lastCommand
        }
        if let lastDir = UserDefaults.standard.string(forKey: "lastWorkingDir") {
            workingDirectory = lastDir
        } else {
            // Default to home directory on the server
            workingDirectory = "~"
        }
    }
    
    private func createSession() {
        isCreating = true
        errorMessage = nil
        
        // Save preferences
        UserDefaults.standard.set(command, forKey: "lastCommand")
        UserDefaults.standard.set(workingDirectory, forKey: "lastWorkingDir")
        
        Task {
            do {
                let sessionData = SessionCreateData(
                    command: command,
                    workingDir: workingDirectory.isEmpty ? "~" : workingDirectory,
                    name: sessionName.isEmpty ? nil : sessionName
                )
                
                // Log the request for debugging
                print("[SessionCreate] Creating session with data:")
                print("  Command: \(sessionData.command)")
                print("  Working Dir: \(sessionData.workingDir)")
                print("  Name: \(sessionData.name ?? "nil")")
                print("  Spawn Terminal: \(sessionData.spawn_terminal ?? false)")
                print("  Cols: \(sessionData.cols ?? 0), Rows: \(sessionData.rows ?? 0)")
                
                let sessionId = try await SessionService.shared.createSession(sessionData)
                
                print("[SessionCreate] Session created successfully with ID: \(sessionId)")
                
                await MainActor.run {
                    onCreated(sessionId)
                    isPresented = false
                }
            } catch {
                print("[SessionCreate] Failed to create session:")
                print("  Error: \(error)")
                if let apiError = error as? APIError {
                    print("  API Error: \(apiError)")
                }
                
                await MainActor.run {
                    errorMessage = error.localizedDescription
                    isCreating = false
                }
            }
        }
    }
}