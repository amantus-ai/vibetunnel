import Observation
import SwiftUI
import UniformTypeIdentifiers

/// Main view displaying the list of terminal sessions.
///
/// Shows active and exited sessions with options to create new sessions,
/// manage existing ones, and navigate to terminal views.
struct SessionListView: View {
    @Environment(NavigationManager.self)
    var navigationManager
    @State private var viewModel: SessionListViewModel

    /// Inject ViewModel directly - clean separation
    init(viewModel: SessionListViewModel = SessionListViewModel()) {
        _viewModel = State(initialValue: viewModel)
    }

    var body: some View {
        NavigationStack {
            ZStack {
                // Background
                Theme.Colors.terminalBackground
                    .ignoresSafeArea()

                VStack {
                    // Error banner at the top
                    if let errorMessage = viewModel.errorMessage {
                        ErrorBanner(message: errorMessage, isOffline: !self.viewModel.isNetworkConnected)
                            .transition(.move(edge: .top).combined(with: .opacity))
                    }

                    if self.viewModel.isLoading, self.viewModel.sessions.isEmpty {
                        ProgressView("Loading sessions...")
                            .progressViewStyle(CircularProgressViewStyle(tint: Theme.Colors.primaryAccent))
                            .font(Theme.Typography.terminalSystem(size: 14))
                            .foregroundColor(Theme.Colors.terminalForeground)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                    } else if !self.viewModel.isNetworkConnected, self.viewModel.sessions.isEmpty {
                        self.offlineStateView
                    } else if self.viewModel.filteredSessions.isEmpty, !self.viewModel.searchText.isEmpty {
                        self.noSearchResultsView
                    } else if self.viewModel.sessions.isEmpty {
                        self.emptyStateView
                    } else {
                        self.sessionList
                    }
                }
            }
            .navigationTitle("Sessions")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button(action: {
                        HapticFeedback.impact(.medium)
                        Task {
                            await self.viewModel.disconnect()
                        }
                    }, label: {
                        HStack(spacing: 4) {
                            Image(systemName: "xmark.circle")
                            Text("Disconnect")
                        }
                        .foregroundColor(Theme.Colors.errorAccent)
                    })
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    HStack(spacing: Theme.Spacing.medium) {
                        Menu {
                            Button(action: {
                                HapticFeedback.impact(.light)
                                self.viewModel.showingSettings = true
                            }, label: {
                                Label("Settings", systemImage: "gearshape")
                            })

                            Button(action: {
                                HapticFeedback.impact(.light)
                                self.viewModel.showingCastImporter = true
                            }, label: {
                                Label("Import Recording", systemImage: "square.and.arrow.down")
                            })
                        } label: {
                            Image(systemName: "ellipsis.circle")
                                .font(.title3)
                                .foregroundColor(Theme.Colors.primaryAccent)
                        }

                        Button(action: {
                            HapticFeedback.impact(.light)
                            self.viewModel.showingFileBrowser = true
                        }, label: {
                            Image(systemName: "folder.fill")
                                .font(.title3)
                                .foregroundColor(Theme.Colors.primaryAccent)
                        })

                        Button(action: {
                            HapticFeedback.impact(.light)
                            self.viewModel.showingCreateSession = true
                        }, label: {
                            Image(systemName: "plus.circle.fill")
                                .font(.title3)
                                .foregroundColor(Theme.Colors.primaryAccent)
                        })
                    }
                }
            }
            .sheet(isPresented: self.$viewModel.showingCreateSession) {
                SessionCreateView(isPresented: self.$viewModel.showingCreateSession) { newSessionId in
                    Task {
                        await self.viewModel.loadSessions()
                        // Find and select the new session
                        if let newSession = viewModel.sessions.first(where: { $0.id == newSessionId }) {
                            self.viewModel.selectedSession = newSession
                        }
                    }
                }
            }
            .fullScreenCover(item: self.$viewModel.selectedSession) { session in
                TerminalView(session: session)
            }
            .sheet(isPresented: self.$viewModel.showingFileBrowser) {
                FileBrowserView(mode: .browseFiles) { _ in
                    // For browse mode, we don't need to handle path selection
                }
            }
            .sheet(isPresented: self.$viewModel.showingSettings) {
                SettingsView()
            }
            .fileImporter(
                isPresented: self.$viewModel.showingCastImporter,
                allowedContentTypes: [.json, .data],
                allowsMultipleSelection: false)
            { result in
                switch result {
                case let .success(urls):
                    if let url = urls.first {
                        self.viewModel.importedCastFile = CastFileItem(url: url)
                    }
                case let .failure(error):
                    logger.error("Failed to import cast file: \(error)")
                }
            }
            .sheet(item: self.$viewModel.importedCastFile) { item in
                    CastPlayerView(castFileURL: item.url)
                }
                .errorAlert(item: self.$viewModel.presentedError)
                .refreshable {
                    await self.viewModel.loadSessions()
                }
                .searchable(text: self.$viewModel.searchText, prompt: "Search sessions")
                .task {
                    await self.viewModel.loadSessions()

                    // Refresh every 3 seconds
                    while !Task.isCancelled {
                        try? await Task.sleep(nanoseconds: 3_000_000_000) // 3 seconds
                        if !Task.isCancelled {
                            await self.viewModel.loadSessions()
                        }
                    }
                }
        }
        .onChange(of: self.navigationManager.shouldNavigateToSession) { _, shouldNavigate in
            if shouldNavigate,
               let sessionId = navigationManager.selectedSessionId,
               let session = viewModel.sessions.first(where: { $0.id == sessionId })
            {
                self.viewModel.selectedSession = session
                self.navigationManager.clearNavigation()
            }
        }
        .onChange(of: self.viewModel.errorMessage) { _, newError in
            if let error = newError {
                self.viewModel.presentedError = IdentifiableError(error: APIError.serverError(0, error))
                self.viewModel.errorMessage = nil
            }
        }
    }

    private var emptyStateView: some View {
        VStack(spacing: Theme.Spacing.extraLarge) {
            ZStack {
                Image(systemName: "terminal")
                    .font(.system(size: 60))
                    .foregroundColor(Theme.Colors.primaryAccent)
                    .blur(radius: 20)
                    .opacity(0.3)

                Image(systemName: "terminal")
                    .font(.system(size: 60))
                    .foregroundColor(Theme.Colors.primaryAccent)
            }

            VStack(spacing: Theme.Spacing.small) {
                Text("No Sessions")
                    .font(.title2)
                    .fontWeight(.semibold)
                    .foregroundColor(Theme.Colors.terminalForeground)

                Text("Create a new terminal session to get started")
                    .font(Theme.Typography.terminalSystem(size: 14))
                    .foregroundColor(Theme.Colors.terminalForeground.opacity(0.7))
                    .multilineTextAlignment(.center)
            }

            Button(action: {
                HapticFeedback.impact(.medium)
                self.viewModel.showingCreateSession = true
            }, label: {
                HStack(spacing: Theme.Spacing.small) {
                    Image(systemName: "plus.circle")
                    Text("Create Session")
                }
                .font(Theme.Typography.terminalSystem(size: 16))
                .fontWeight(.medium)
            })
            .terminalButton()
        }
        .padding()
    }

    private var noSearchResultsView: some View {
        VStack(spacing: Theme.Spacing.extraLarge) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 48))
                .foregroundColor(Theme.Colors.terminalForeground.opacity(0.3))

            VStack(spacing: Theme.Spacing.small) {
                Text("No sessions found")
                    .font(.title2)
                    .fontWeight(.semibold)
                    .foregroundColor(Theme.Colors.terminalForeground)

                Text("Try searching with different keywords")
                    .font(Theme.Typography.terminalSystem(size: 14))
                    .foregroundColor(Theme.Colors.terminalForeground.opacity(0.7))
            }

            Button(action: { self.viewModel.searchText = "" }, label: {
                Label("Clear Search", systemImage: "xmark.circle.fill")
                    .font(Theme.Typography.terminalSystem(size: 14))
            })
            .terminalButton()
        }
        .padding()
    }

    private var sessionList: some View {
        ScrollView {
            VStack(spacing: Theme.Spacing.large) {
                SessionHeaderView(
                    sessions: self.viewModel.sessions,
                    showExitedSessions: self.$viewModel.showExitedSessions,
                    onKillAll: {
                        Task {
                            await self.viewModel.killAllSessions()
                        }
                    },
                    onCleanupAll: {
                        Task {
                            await self.viewModel.cleanupAllExited()
                        }
                    })
                    .padding(.horizontal)
                    .padding(.vertical, Theme.Spacing.small)
                    .background(
                        RoundedRectangle(cornerRadius: Theme.CornerRadius.large)
                            .fill(Theme.Colors.terminalForeground.opacity(0.03)))
                    .padding(.horizontal)

                // Sessions grid
                LazyVGrid(columns: [
                    GridItem(.flexible(), spacing: Theme.Spacing.medium),
                    GridItem(.flexible(), spacing: Theme.Spacing.medium),
                ], spacing: Theme.Spacing.medium) {
                    ForEach(self.viewModel.filteredSessions) { session in
                        SessionCardView(session: session) {
                            HapticFeedback.selection()
                            if session.isRunning {
                                self.viewModel.selectedSession = session
                            }
                        } onKill: {
                            HapticFeedback.impact(.medium)
                            Task {
                                await self.viewModel.killSession(session.id)
                            }
                        } onCleanup: {
                            HapticFeedback.impact(.medium)
                            Task {
                                await self.viewModel.cleanupSession(session.id)
                            }
                        }
                        .livePreview(for: session.id, enabled: session.isRunning && self.viewModel.enableLivePreviews)
                        .transition(.asymmetric(
                            insertion: .scale(scale: 0.8).combined(with: .opacity),
                            removal: .scale(scale: 0.8).combined(with: .opacity)))
                    }
                }
                .padding(.horizontal)
            }
            .padding(.vertical)
            .animation(Theme.Animation.smooth, value: self.viewModel.sessions)
        }
    }

    private var offlineStateView: some View {
        VStack(spacing: Theme.Spacing.extraLarge) {
            ZStack {
                Image(systemName: "wifi.slash")
                    .font(.system(size: 60))
                    .foregroundColor(Theme.Colors.errorAccent)
                    .blur(radius: 20)
                    .opacity(0.3)

                Image(systemName: "wifi.slash")
                    .font(.system(size: 60))
                    .foregroundColor(Theme.Colors.errorAccent)
            }

            VStack(spacing: Theme.Spacing.small) {
                Text("No Internet Connection")
                    .font(.title2)
                    .fontWeight(.semibold)
                    .foregroundColor(Theme.Colors.terminalForeground)

                Text("Unable to load sessions while offline")
                    .font(Theme.Typography.terminalSystem(size: 14))
                    .foregroundColor(Theme.Colors.terminalForeground.opacity(0.7))
                    .multilineTextAlignment(.center)
            }

            Button(action: {
                HapticFeedback.impact(.medium)
                Task {
                    await self.viewModel.loadSessions()
                }
            }, label: {
                HStack(spacing: Theme.Spacing.small) {
                    Image(systemName: "arrow.clockwise")
                    Text("Retry")
                }
                .font(Theme.Typography.terminalSystem(size: 16))
                .fontWeight(.medium)
            })
            .terminalButton()
            .disabled(!self.viewModel.isNetworkConnected)
        }
        .padding()
    }
}

/// Protocol defining the interface for session list view model
/// Protocol defining the interface for session list view models.
/// Ensures testability and separation of concerns for session management.
@MainActor
protocol SessionListViewModelProtocol: Observable {
    var sessions: [Session] { get }
    var filteredSessions: [Session] { get }
    var isLoading: Bool { get }
    var errorMessage: String? { get set }
    var showExitedSessions: Bool { get set }
    var searchText: String { get set }
    var isNetworkConnected: Bool { get }

    func loadSessions() async
    func killSession(_ sessionId: String) async
    func cleanupSession(_ sessionId: String) async
    func cleanupAllExited() async
    func killAllSessions() async
}

/// View model for managing session list state and operations.
/// View model managing terminal session state and operations.
/// Handles session creation, deletion, and real-time updates via WebSocket.
@MainActor
@Observable
class SessionListViewModel: SessionListViewModelProtocol {
    var sessions: [Session] = []
    var isLoading = false
    var errorMessage: String?
    var showExitedSessions = true
    var searchText = ""

    var filteredSessions: [Session] {
        let visibleSessions = self.sessions.filter { self.showExitedSessions || $0.isRunning }

        if self.searchText.isEmpty {
            return visibleSessions
        }

        return visibleSessions.filter { session in
            // Search in session name
            if let name = session.name, name.localizedCaseInsensitiveContains(searchText) {
                return true
            }
            // Search in command
            if session.command.joined(separator: " ").localizedCaseInsensitiveContains(self.searchText) {
                return true
            }
            // Search in working directory
            if session.workingDir.localizedCaseInsensitiveContains(self.searchText) {
                return true
            }
            // Search in PID
            if let pid = session.pid, String(pid).contains(searchText) {
                return true
            }
            return false
        }
    }

    var isNetworkConnected: Bool {
        self.networkMonitor.isConnected
    }

    // UI State
    var showingCreateSession = false
    var selectedSession: Session?
    var showingFileBrowser = false
    var showingSettings = false
    var showingCastImporter = false
    var importedCastFile: CastFileItem?
    var presentedError: IdentifiableError?
    var enableLivePreviews = true

    private let sessionService: SessionServiceProtocol
    private let networkMonitor: NetworkMonitoring
    private let connectionManager: ConnectionManager

    init(
        sessionService: SessionServiceProtocol = SessionService(),
        networkMonitor: NetworkMonitoring = NetworkMonitor.shared,
        connectionManager: ConnectionManager = ConnectionManager.shared)
    {
        self.sessionService = sessionService
        self.networkMonitor = networkMonitor
        self.connectionManager = connectionManager
    }

    func disconnect() async {
        await self.connectionManager.disconnect()
    }

    func loadSessions() async {
        if self.sessions.isEmpty {
            self.isLoading = true
        }

        do {
            self.sessions = try await self.sessionService.getSessions()
            self.errorMessage = nil
        } catch {
            self.errorMessage = error.localizedDescription
        }

        self.isLoading = false
    }

    func killSession(_ sessionId: String) async {
        do {
            try await self.sessionService.killSession(sessionId)
            await self.loadSessions()
        } catch {
            self.errorMessage = error.localizedDescription
        }
    }

    func cleanupSession(_ sessionId: String) async {
        do {
            try await self.sessionService.cleanupSession(sessionId)
            await self.loadSessions()
        } catch {
            self.errorMessage = error.localizedDescription
        }
    }

    func cleanupAllExited() async {
        do {
            _ = try await self.sessionService.cleanupAllExitedSessions()
            await self.loadSessions()
            HapticFeedback.notification(.success)
        } catch {
            self.errorMessage = error.localizedDescription
            HapticFeedback.notification(.error)
        }
    }

    func killAllSessions() async {
        do {
            try await self.sessionService.killAllSessions()
            await self.loadSessions()
            HapticFeedback.notification(.success)
        } catch {
            self.errorMessage = error.localizedDescription
            HapticFeedback.notification(.error)
        }
    }
}

// MARK: - Extracted Components

/// Header component displaying session list title and actions.
/// Shows session count and provides quick access to create new sessions.
struct SessionHeaderView: View {
    let sessions: [Session]
    @Binding var showExitedSessions: Bool
    let onKillAll: () -> Void
    let onCleanupAll: () -> Void

    private var runningCount: Int { self.sessions.count { $0.isRunning } }
    private var exitedCount: Int { self.sessions.count { !$0.isRunning } }

    var body: some View {
        VStack(spacing: Theme.Spacing.medium) {
            // Session counts
            HStack(spacing: Theme.Spacing.extraLarge) {
                SessionCountBadge(
                    label: "Running",
                    count: self.runningCount,
                    color: Theme.Colors.successAccent)

                SessionCountBadge(
                    label: "Exited",
                    count: self.exitedCount,
                    color: Theme.Colors.errorAccent)

                Spacer()
            }

            // Action buttons
            HStack(spacing: Theme.Spacing.medium) {
                if self.exitedCount > 0 {
                    ExitedSessionToggle(showExitedSessions: self.$showExitedSessions)
                }

                Spacer()

                if self.showExitedSessions, self.sessions.contains(where: { !$0.isRunning }) {
                    CleanupAllHeaderButton(onCleanup: self.onCleanupAll)
                }

                if self.sessions.contains(where: \.isRunning) {
                    KillAllButton(onKillAll: self.onKillAll)
                }
            }
        }
        .padding(.vertical, Theme.Spacing.small)
    }
}

/// Badge component showing the total number of sessions.
/// Displays count with consistent styling across the app.
struct SessionCountBadge: View {
    let label: String
    let count: Int
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(self.label)
                .font(Theme.Typography.terminalSystem(size: 12))
                .foregroundColor(Theme.Colors.terminalForeground.opacity(0.6))
                .textCase(.uppercase)

            Text("\(self.count)")
                .font(Theme.Typography.terminalSystem(size: 28))
                .fontWeight(.bold)
                .foregroundColor(self.color)
        }
    }
}

struct ExitedSessionToggle: View {
    @Binding var showExitedSessions: Bool

    var body: some View {
        Button(action: {
            HapticFeedback.selection()
            withAnimation(Theme.Animation.smooth) {
                self.showExitedSessions.toggle()
            }
        }, label: {
            HStack(spacing: 6) {
                Image(systemName: self.showExitedSessions ? "eye.slash" : "eye")
                    .font(.system(size: 14))
                Text(self.showExitedSessions ? "Hide Exited" : "Show Exited")
                    .font(Theme.Typography.terminalSystem(size: 14))
            }
            .foregroundColor(Theme.Colors.terminalForeground.opacity(0.8))
            .padding(.horizontal, Theme.Spacing.medium)
            .padding(.vertical, Theme.Spacing.small)
            .background(
                RoundedRectangle(cornerRadius: Theme.CornerRadius.medium)
                    .fill(Theme.Colors.terminalForeground.opacity(0.08))
                    .overlay(
                        RoundedRectangle(cornerRadius: Theme.CornerRadius.medium)
                            .stroke(Theme.Colors.terminalForeground.opacity(0.15), lineWidth: 1)))
        })
        .buttonStyle(PlainButtonStyle())
    }
}

struct KillAllButton: View {
    let onKillAll: () -> Void

    var body: some View {
        Button(action: {
            HapticFeedback.impact(.medium)
            self.onKillAll()
        }, label: {
            HStack(spacing: 6) {
                Image(systemName: "stop.circle.fill")
                    .font(.system(size: 14))
                Text("Kill All")
                    .fontWeight(.medium)
            }
            .font(Theme.Typography.terminalSystem(size: 14))
            .foregroundColor(Theme.Colors.terminalBackground)
            .padding(.horizontal, Theme.Spacing.medium)
            .padding(.vertical, Theme.Spacing.small)
            .background(
                RoundedRectangle(cornerRadius: Theme.CornerRadius.medium)
                    .fill(Theme.Colors.errorAccent))
        })
        .buttonStyle(PlainButtonStyle())
    }
}

struct CleanupAllButton: View {
    let onCleanup: () -> Void

    var body: some View {
        Button(action: {
            HapticFeedback.impact(.medium)
            self.onCleanup()
        }, label: {
            HStack {
                Image(systemName: "trash")
                Text("Clean Up All Exited")
                Spacer()
            }
            .font(Theme.Typography.terminalSystem(size: 14))
            .foregroundColor(Theme.Colors.warningAccent)
            .padding()
            .background(
                RoundedRectangle(cornerRadius: Theme.CornerRadius.card)
                    .fill(Theme.Colors.warningAccent.opacity(0.1)))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.CornerRadius.card)
                    .stroke(Theme.Colors.warningAccent.opacity(0.3), lineWidth: 1))
        })
        .buttonStyle(PlainButtonStyle())
        .transition(.asymmetric(
            insertion: .scale.combined(with: .opacity),
            removal: .scale.combined(with: .opacity)))
    }
}

struct CleanupAllHeaderButton: View {
    let onCleanup: () -> Void

    var body: some View {
        Button(action: {
            HapticFeedback.impact(.medium)
            self.onCleanup()
        }, label: {
            HStack(spacing: 6) {
                Image(systemName: "trash")
                    .font(.system(size: 14))
                Text("Clean Up All Exited")
                    .font(Theme.Typography.terminalSystem(size: 14))
            }
            .foregroundColor(Theme.Colors.warningAccent)
            .padding(.horizontal, Theme.Spacing.medium)
            .padding(.vertical, Theme.Spacing.small)
            .background(
                RoundedRectangle(cornerRadius: Theme.CornerRadius.medium)
                    .fill(Theme.Colors.warningAccent.opacity(0.1))
                    .overlay(
                        RoundedRectangle(cornerRadius: Theme.CornerRadius.medium)
                            .stroke(Theme.Colors.warningAccent.opacity(0.2), lineWidth: 1)))
        })
        .buttonStyle(PlainButtonStyle())
    }
}

/// Wrapper for cast file URL to make it Identifiable
struct CastFileItem: Identifiable {
    let id = UUID()
    let url: URL
}

// MARK: - Logging

private let logger = Logger(category: "SessionListView")
