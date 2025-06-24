import SwiftUI
import UniformTypeIdentifiers
import os

struct TerminalWindowView: View {
    let session: Session
    @Environment(\.dismiss) private var dismiss
    @Environment(SessionManager.self) private var sessionManager
    @State private var terminalManager: TerminalManager?
    @State private var showFileBrowser = false
    @State private var preferences: TerminalPreferences = TerminalPreferences()
    @State private var showPreferences = false
    @AppStorage("terminalRenderer") private var terminalRenderer = "buffer"
    
    var body: some View {
        VStack(spacing: 0) {
            // Toolbar
            TerminalToolbar(
                session: session,
                preferences: $preferences,
                terminalRenderer: $terminalRenderer,
                terminalCols: terminalManager?.terminalCols ?? 0,
                terminalRows: terminalManager?.terminalRows ?? 0,
                terminalManager: terminalManager,
                onShowFileBrowser: { showFileBrowser = true },
                onShowPreferences: { showPreferences = true },
                onKillSession: killSession,
                onClose: { dismiss() }
            )
            
            Divider()
            
            // Terminal view with exit banner overlay
            ZStack {
                if let terminalManager {
                    Group {
                        if terminalRenderer == "buffer" {
                            TerminalBufferView(sessionId: session.id)
                                .terminalPreferences(preferences)
                        } else {
                            TerminalContainerView(
                                manager: terminalManager,
                                targetColumnWidth: preferences.maxColumns,
                                fontSize: preferences.fontSize,
                                renderer: terminalRenderer
                            )
                        }
                    }
                    .background(Theme.Colors.terminalBackground)
                    .opacity(terminalManager.sessionExited ? 0.6 : 1.0)
                    .allowsHitTesting(!terminalManager.sessionExited)
                    
                    // Session exit banner overlay
                    if terminalManager.sessionExited {
                        VStack {
                            Spacer()
                            
                            HStack {
                                if let exitCode = terminalManager.sessionExitCode {
                                    Text("SESSION EXITED WITH CODE \(exitCode)")
                                } else {
                                    Text("SESSION EXITED")
                                }
                            }
                            .font(Theme.Typography.terminalFont.bold())
                            .foregroundStyle(Theme.Colors.warning)
                            .padding(.horizontal, Theme.Spacing.lg)
                            .padding(.vertical, Theme.Spacing.md)
                            .background(Theme.Colors.secondaryBackground)
                            .cornerRadius(Theme.Sizes.cornerRadius)
                            .overlay(
                                RoundedRectangle(cornerRadius: Theme.Sizes.cornerRadius)
                                    .stroke(Theme.Colors.tertiaryText.opacity(0.3), lineWidth: 1)
                            )
                            .shadow(radius: 8)
                            
                            Spacer()
                        }
                    }
                } else {
                    LoadingView(message: "Connecting to session...")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Theme.Colors.terminalBackground)
                }
            }
        }
        .frame(minWidth: 800, minHeight: 600)
        .navigationTitle(session.displayName)
        .sheet(isPresented: $showFileBrowser) {
            FileBrowserView(
                mode: .browse,
                session: session,
                onSelectPath: { path, type in
                    // Insert path into terminal
                    // Escape the path if it contains spaces
                    let escapedPath = path.contains(" ") ? "\"\(path)\"" : path
                    terminalManager?.sendInput(escapedPath)
                    showFileBrowser = false
                }
            )
            .frame(width: 900, height: 600)
        }
        .onAppear {
            setupTerminal()
            preferences = TerminalPreferences.load(for: session.id)
        }
        .onDisappear {
            terminalManager?.disconnect()
        }
        // Keyboard shortcuts
        .keyboardShortcut("o", modifiers: .command)
        .onAppear {
            // Set up keyboard shortcuts
        }
        .toolbar {
            ToolbarItem {
                Menu {
                    Button("Increase Font Size") {
                        preferences.adjustFontSize(delta: 1)
                        preferences.save(for: session.id)
                    }
                    .keyboardShortcut("+", modifiers: .command)
                    
                    Button("Decrease Font Size") {
                        preferences.adjustFontSize(delta: -1)
                        preferences.save(for: session.id)
                    }
                    .keyboardShortcut("-", modifiers: .command)
                    
                    Button("Reset Font Size") {
                        preferences.fontSize = 13.0
                        preferences.save(for: session.id)
                    }
                    .keyboardShortcut("0", modifiers: .command)
                    
                    Divider()
                    
                    Button("Toggle Fit to Width") {
                        preferences.fitHorizontally.toggle()
                        if preferences.fitHorizontally && preferences.maxColumns == 0 {
                            preferences.maxColumns = 80
                        }
                        preferences.save(for: session.id)
                    }
                    .keyboardShortcut("w", modifiers: .command)
                    
                    Button("Preferences...") {
                        showPreferences = true
                    }
                    .keyboardShortcut(",", modifiers: .command)
                    
                    Divider()
                    
                    Button("Kill Session") {
                        killSession()
                    }
                    .keyboardShortcut("k", modifiers: .command)
                } label: {
                    Label("Actions", systemImage: "ellipsis.circle")
                }
            }
        }
        .sheet(isPresented: $showPreferences) {
            TerminalPreferencesView(preferences: $preferences) {
                preferences.save(for: session.id)
            }
        }
    }
    
    private func setupTerminal() {
        guard let serverURL = sessionManager.serverURL else { return }
        
        let manager = TerminalManager(
            sessionId: session.id,
            serverURL: serverURL,
            authHeader: sessionManager.authHeader
        )
        
        self.terminalManager = manager
        
        // Connect the terminal manager
        manager.connect()
    }
    
    private func killSession() {
        Task {
            try? await sessionManager.killSession(session)
            await MainActor.run {
                dismiss()
            }
        }
    }
}

struct TerminalToolbar: View {
    let session: Session
    @Binding var preferences: TerminalPreferences
    @Binding var terminalRenderer: String
    let terminalCols: Int
    let terminalRows: Int
    let terminalManager: TerminalManager?
    let onShowFileBrowser: () -> Void
    let onShowPreferences: () -> Void
    let onKillSession: () -> Void
    let onClose: () -> Void
    @Environment(SessionManager.self) private var sessionManager
    
    @State private var snapshotContent: String?
    @State private var showingSnapshot = false
    @State private var isExporting = false
    @State private var showingRecordingSavedAlert = false
    @State private var recordingFileURL: URL?
    
    var body: some View {
        HStack {
            // Session info
            HStack(spacing: Theme.Spacing.sm) {
                Circle()
                    .fill(terminalManager?.sessionExited == true ? Theme.Colors.warning : 
                          (session.isRunning ? Theme.Colors.success : Theme.Colors.secondaryText))
                    .frame(width: 8, height: 8)
                
                Text(session.command)
                    .font(Theme.Typography.terminalFont)
                    .foregroundStyle(Theme.Colors.secondaryText)
                
                // Terminal dimensions
                if terminalCols > 0 && terminalRows > 0 {
                    Text("\(terminalCols)×\(terminalRows)")
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Colors.tertiaryText)
                        .padding(.leading, Theme.Spacing.xs)
                }
            }
            
            Spacer()
            
            // Controls
            HStack(spacing: Theme.Spacing.md) {
                // Font size
                HStack(spacing: Theme.Spacing.xs) {
                    Button {
                        preferences.adjustFontSize(delta: -1)
                        preferences.save(for: session.id)
                    } label: {
                        Image(systemName: "textformat.size.smaller")
                    }
                    .buttonStyle(.plain)
                    .keyboardShortcut("-", modifiers: .command)
                    
                    Text("\(Int(preferences.fontSize))pt")
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Colors.secondaryText)
                        .monospacedDigit()
                        .frame(width: 30)
                    
                    Button {
                        preferences.adjustFontSize(delta: 1)
                        preferences.save(for: session.id)
                    } label: {
                        Image(systemName: "textformat.size.larger")
                    }
                    .buttonStyle(.plain)
                    .keyboardShortcut("+", modifiers: .command)
                }
                
                Divider()
                    .frame(height: 20)
                
                // Terminal preferences
                Button {
                    onShowPreferences()
                } label: {
                    Label("Preferences", systemImage: "slider.horizontal.3")
                }
                .help("Terminal preferences (Cmd+,)")
                
                // Show fit mode status
                if preferences.fitHorizontally {
                    Label("\(preferences.maxColumns) cols", systemImage: "arrow.left.and.right")
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Colors.secondaryText)
                }
                
                Divider()
                    .frame(height: 20)
                
                // Terminal renderer
                Menu {
                    Button("Buffer Protocol") { terminalRenderer = "buffer" }
                        .tag("buffer")
                    Button("xterm.js") { terminalRenderer = "xterm" }
                        .tag("xterm")
                    Button("SwiftTerm") { terminalRenderer = "swiftterm" }
                        .tag("swiftterm")
                } label: {
                    Label(
                        terminalRendererName,
                        systemImage: "terminal"
                    )
                }
                .fixedSize()
                
                Divider()
                    .frame(height: 20)
                
                // Recording controls
                if let recordingManager = terminalManager?.recordingManager {
                    if recordingManager.isRecording {
                        HStack(spacing: Theme.Spacing.xs) {
                            Circle()
                                .fill(Color.red)
                                .frame(width: 8, height: 8)
                                .overlay(
                                    Circle()
                                        .fill(Color.red.opacity(0.3))
                                        .frame(width: 12, height: 12)
                                        .scaleEffect(recordingManager.eventCount % 2 == 0 ? 1.0 : 1.2)
                                        .animation(.easeInOut(duration: 0.5).repeatForever(autoreverses: true), value: recordingManager.eventCount)
                                )
                            
                            Text(formatDuration(recordingManager.recordingDuration))
                                .font(Theme.Typography.caption)
                                .monospacedDigit()
                                .foregroundStyle(Theme.Colors.error)
                            
                            Button("Stop") {
                                stopRecording()
                            }
                            .buttonStyle(.borderedProminent)
                            .controlSize(.small)
                            .tint(Theme.Colors.error)
                        }
                    } else {
                        Button {
                            terminalManager?.startRecording()
                        } label: {
                            Label("Record", systemImage: "record.circle")
                        }
                        .help("Start Recording")
                    }
                    
                    Divider()
                        .frame(height: 20)
                }
                
                // Actions
                Button {
                    onShowFileBrowser()
                } label: {
                    Label("Browse", systemImage: "folder")
                }
                .help("Browse Files (⌘O)")
                .keyboardShortcut("o", modifiers: .command)
                
                Menu {
                    Button {
                        Task {
                            await takeSnapshot()
                        }
                    } label: {
                        Label("Take Snapshot", systemImage: "camera")
                    }
                    
                    Button {
                        Task {
                            await exportTerminal()
                        }
                    } label: {
                        Label("Export as Text", systemImage: "square.and.arrow.up")
                    }
                    
                    Divider()
                    
                    Button {
                        clearTerminal()
                    } label: {
                        Label("Clear Terminal", systemImage: "clear")
                    }
                    .keyboardShortcut("k", modifiers: .command)
                    
                    if session.isRunning {
                        Divider()
                        
                        Button {
                            onKillSession()
                        } label: {
                            Label("Kill Session", systemImage: "stop.circle")
                                .foregroundStyle(Theme.Colors.error)
                        }
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                .fixedSize()
            }
        }
        .padding(.horizontal, Theme.Spacing.md)
        .padding(.vertical, Theme.Spacing.sm)
        .background(Theme.Colors.background)
        .onAppear {
            // Preferences are loaded from the parent view
        }
        .onChange(of: terminalRenderer) { oldValue, newValue in
            // Handle renderer changes if needed
            // Both xterm and SwiftTerm use the TerminalManager connection
        }
        .sheet(isPresented: $showingSnapshot) {
            SnapshotView(content: snapshotContent ?? "")
        }
        .alert("Recording Saved", isPresented: $showingRecordingSavedAlert) {
            Button("Open in Finder") {
                if let url = recordingFileURL {
                    NSWorkspace.shared.selectFile(url.path, inFileViewerRootedAtPath: "")
                }
            }
            Button("Copy to Clipboard") {
                _ = terminalManager?.exportRecordingToClipboard()
            }
            Button("OK", role: .cancel) {}
        } message: {
            if let url = recordingFileURL {
                Text("Recording saved to:\n\(url.lastPathComponent)")
            }
        }
        .withStatusBar()
    }
    
    private var terminalRendererName: String {
        switch terminalRenderer {
        case "buffer": return "Buffer"
        case "xterm": return "xterm.js"
        default: return "SwiftTerm"
        }
    }
    
    @MainActor
    private func takeSnapshot() async {
        guard let serverURL = sessionManager.serverURL,
              let authHeader = sessionManager.authHeader else { return }
        
        do {
            let snapshot = try await APIClient.shared.getTerminalSnapshot(
                serverURL: serverURL,
                authHeader: authHeader,
                sessionId: session.id
            )
            snapshotContent = snapshot
            showingSnapshot = true
        } catch {
            // Handle error
            print("Failed to take snapshot: \(error)")
        }
    }
    
    @MainActor
    private func exportTerminal() async {
        guard let serverURL = sessionManager.serverURL,
              let authHeader = sessionManager.authHeader else { return }
        
        isExporting = true
        
        do {
            let snapshot = try await APIClient.shared.getTerminalSnapshot(
                serverURL: serverURL,
                authHeader: authHeader,
                sessionId: session.id
            )
            
            let savePanel = NSSavePanel()
            savePanel.title = "Export Terminal Output"
            savePanel.nameFieldStringValue = "\(session.displayName)-\(Date().ISO8601Format()).txt"
            savePanel.allowedContentTypes = [.plainText]
            
            if savePanel.runModal() == .OK,
               let url = savePanel.url {
                try snapshot.write(to: url, atomically: true, encoding: .utf8)
            }
        } catch {
            // Handle error
            print("Failed to export terminal: \(error)")
        }
        
        isExporting = false
    }
    
    private func clearTerminal() {
        // Send Ctrl+L to clear the terminal
        terminalManager?.sendInput("\u{0C}")
    }
    
    private func stopRecording() {
        guard let terminalManager = terminalManager else { return }
        
        if let savedURL = terminalManager.stopRecording() {
            recordingFileURL = savedURL
            showingRecordingSavedAlert = true
            Logger.terminal.info("Recording saved: \(savedURL.lastPathComponent)")
        } else {
            Logger.logError(Logger.terminal, "Failed to save terminal recording")
            ErrorPresenter.shared.showError("Recording Failed", 
                                           message: "Unable to save the terminal recording. Please check disk space and permissions.")
        }
    }
    
    private func formatDuration(_ duration: TimeInterval) -> String {
        let minutes = Int(duration) / 60
        let seconds = Int(duration) % 60
        return String(format: "%02d:%02d", minutes, seconds)
    }
}

#Preview {
    TerminalWindowView(
        session: Session(
            id: "preview",
            name: "Preview Session",
            command: "zsh",
            cwd: "/Users",
            createdAt: Date(),
            status: .running
        )
    )
    .environment(SessionManager())
}
