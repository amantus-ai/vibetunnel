import SwiftUI

@main
struct VibeTunnelFrontendApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @State private var connectionManager = ConnectionManager.shared
    @State private var navigationManager = NavigationManager()
    @State private var sessionManager = SessionManager()
    @State private var showingKeyboardShortcuts = false
    
    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(connectionManager)
                .environment(navigationManager)
                .environment(sessionManager)
                .frame(minWidth: 1000, minHeight: 700)
                .onAppear {
                    setupApp()
                }
                .onChange(of: sessionManager.sessions) { _, sessions in
                    StatusBarManager.shared.sessionCount = sessions.filter { $0.isRunning }.count
                }
                .sheet(isPresented: $showingKeyboardShortcuts) {
                    KeyboardShortcutsView()
                }
                .keyboardShortcut("?", modifiers: .command)
        }
        .windowResizability(.contentSize)
        .windowToolbarStyle(.unified(showsTitle: true))
        .commands {
            AppCommands(showingKeyboardShortcuts: $showingKeyboardShortcuts)
        }
        
        // Allow opening multiple terminal windows
        WindowGroup("Terminal", for: Session.ID.self) { $sessionId in
            if let sessionId,
               let session = sessionManager.sessions.first(where: { $0.id == sessionId }) {
                TerminalWindowView(session: session)
                    .environment(sessionManager)
                    .environment(connectionManager)
                    .frame(minWidth: 800, minHeight: 600)
                    .errorPresentation()
            } else {
                Text("Session not found")
                    .frame(width: 400, height: 200)
            }
        }
        .windowResizability(.contentSize)
        .windowToolbarStyle(.unified(showsTitle: true))
        
        Settings {
            SettingsView()
                .environment(connectionManager)
        }
    }
    
    private func setupApp() {
        // Initialize managers
        connectionManager.loadSavedConnection()
        
        // Request notification permissions
        Task {
            await NotificationManager.shared.requestPermissionIfNeeded()
        }
        
        // Update status bar with session count
        // Since SessionManager is @Observable, we'll update this in the view instead
        
        // Set up appearance
        NSWindow.allowsAutomaticWindowTabbing = false
    }
}

struct AppCommands: Commands {
    @Environment(\.openWindow) private var openWindow
    @FocusedValue(\.sessionManager) private var sessionManager
    @Binding var showingKeyboardShortcuts: Bool
    
    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button("New Session") {
                sessionManager?.showNewSessionSheet = true
            }
            .keyboardShortcut("n", modifiers: .command)
            
            Divider()
            
            Button("Kill All Sessions") {
                Task {
                    await sessionManager?.killAllSessions()
                }
            }
            .keyboardShortcut("k", modifiers: [.command, .shift])
            .disabled(sessionManager?.runningSessions.isEmpty ?? true)
            
            Button("Cleanup Exited Sessions") {
                Task {
                    await sessionManager?.cleanupExitedSessions()
                }
            }
            .disabled(sessionManager?.exitedSessions.isEmpty ?? true)
        }
        
        CommandGroup(after: .windowArrangement) {
            Button("Show Logs") {
                // TODO: Open logs window
            }
            .keyboardShortcut("l", modifiers: [.command, .shift])
        }
        
        CommandGroup(replacing: .help) {
            Button("Keyboard Shortcuts") {
                showingKeyboardShortcuts = true
            }
            .keyboardShortcut("?", modifiers: .command)
            
            Divider()
            
            Link("VibeTunnel Documentation", destination: URL(string: "https://github.com/vibetunnel/vibetunnel")!)
            Link("Report an Issue", destination: URL(string: "https://github.com/vibetunnel/vibetunnel/issues")!)
        }
    }
}

// Focus values for commands
struct SessionManagerKey: FocusedValueKey {
    typealias Value = SessionManager
}

extension FocusedValues {
    var sessionManager: SessionManager? {
        get { self[SessionManagerKey.self] }
        set { self[SessionManagerKey.self] = newValue }
    }
}