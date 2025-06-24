import SwiftUI

struct ContentView: View {
    @Environment(ConnectionManager.self)
    private var connectionManager
    @Environment(NavigationManager.self)
    private var navigationManager
    @Environment(SessionManager.self)
    private var sessionManager
    @State private var selectedSection: NavigationSection? = .sessions
    @State private var columnVisibility = NavigationSplitViewVisibility.all
    
    var body: some View {
        NavigationSplitView(columnVisibility: $columnVisibility) {
            SidebarView(selection: $selectedSection)
                .navigationSplitViewColumnWidth(min: 200, ideal: 250, max: 350)
        } detail: {
            DetailView(selectedSection: selectedSection)
        }
        .focusedSceneValue(\.sessionManager, sessionManager)
        .onAppear {
            if let serverURL = connectionManager.serverURL {
                sessionManager.serverURL = serverURL
                sessionManager.authHeader = connectionManager.authHeader
                sessionManager.startRefreshing()
            }
        }
        .onChange(of: connectionManager.serverURL) { _, newValue in
            if let newValue {
                sessionManager.serverURL = newValue
                sessionManager.authHeader = connectionManager.authHeader
                sessionManager.startRefreshing()
            } else {
                sessionManager.stopRefreshing()
            }
        }
        .errorPresentation()
        .toolbar {
            ToolbarItem(placement: .automatic) {
                ConnectionStatusView()
                    .environment(connectionManager)
            }
        }
        .sheet(isPresented: Binding(
            get: { connectionManager.showAuthSheet },
            set: { connectionManager.showAuthSheet = $0 }
        )) {
            AuthLoginView(
                onSuccess: {
                    Task {
                        await connectionManager.completeAuthenticatedConnection()
                    }
                },
                onCancel: {
                    connectionManager.disconnect()
                }
            )
            .environment(connectionManager)
        }
    }
}

enum NavigationSection: String, CaseIterable, Identifiable {
    case sessions
    case logs
    case settings
    
    var id: String { rawValue }
    
    var title: String {
        switch self {
        case .sessions: return "Sessions"
        case .logs: return "Logs"
        case .settings: return "Settings"
        }
    }
    
    var systemImage: String {
        switch self {
        case .sessions: return "terminal"
        case .logs: return "doc.text"
        case .settings: return "gear"
        }
    }
}

struct SidebarView: View {
    @Binding var selection: NavigationSection?
    @Environment(SessionManager.self)
    private var sessionManager
    @Environment(ConnectionManager.self)
    private var connectionManager
    
    var body: some View {
        List(selection: $selection) {
            Section {
                ForEach(NavigationSection.allCases.filter { $0 != .settings }) { section in
                    if let count = badgeCount(for: section) {
                        Label(section.title, systemImage: section.systemImage)
                            .tag(section)
                            .badge(count)
                    } else {
                        Label(section.title, systemImage: section.systemImage)
                            .tag(section)
                    }
                }
            }
            
            if connectionManager.isConnected {
                Section("Quick Actions") {
                    Button {
                        sessionManager.showNewSessionSheet = true
                    } label: {
                        Label("New Session", systemImage: "plus.circle")
                    }
                    .buttonStyle(.plain)
                    .keyboardShortcut("n", modifiers: .command)
                    
                    if !sessionManager.runningSessions.isEmpty {
                        Button {
                            Task {
                                await sessionManager.killAllSessions()
                            }
                        } label: {
                            Label("Kill All Sessions", systemImage: "stop.circle")
                        }
                        .buttonStyle(.plain)
                    }
                    
                    if !sessionManager.exitedSessions.isEmpty {
                        Button {
                            Task {
                                await sessionManager.cleanupExitedSessions()
                            }
                        } label: {
                            Label("Cleanup Exited", systemImage: "trash")
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            
            Section {
                Label(NavigationSection.settings.title, systemImage: NavigationSection.settings.systemImage)
                    .tag(NavigationSection.settings)
            }
        }
        .navigationTitle("VibeTunnel")
        .listStyle(.sidebar)
    }
    
    private func badgeCount(for section: NavigationSection) -> Int? {
        switch section {
        case .sessions:
            let runningCount = sessionManager.runningSessions.count
            return runningCount > 0 ? runningCount : nil
        default:
            return nil
        }
    }
}

struct DetailView: View {
    let selectedSection: NavigationSection?
    @Environment(ConnectionManager.self)
    private var connectionManager
    @Namespace private var namespace
    
    var body: some View {
        ZStack {
            if !connectionManager.isConnected {
                ConnectionSetupView()
                    .transition(.smoothModal)
            } else {
                switch selectedSection {
                case .sessions:
                    SessionsView()
                        .transition(.slideAndFade)
                        .id("sessions")
                case .logs:
                    LogsView()
                        .transition(.slideAndFade)
                        .id("logs")
                case .settings:
                    SettingsView()
                        .transition(.slideAndFade)
                        .id("settings")
                case nil:
                    EmptyStateView(
                        title: "Select a Section",
                        message: "Choose from the sidebar to get started",
                        systemImage: "sidebar.left"
                    )
                    .transition(.scaleAndFade)
                    .id("empty")
                }
            }
        }
        .animation(.spring(response: 0.3, dampingFraction: 0.8), value: selectedSection)
        .animation(.spring(response: 0.3, dampingFraction: 0.8), value: connectionManager.isConnected)
        .withStatusBar()
    }
}

#Preview {
    ContentView()
        .environment(ConnectionManager())
        .environment(NavigationManager())
        .environment(SessionManager())
}
