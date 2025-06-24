import SwiftUI

struct SessionsView: View {
    @Environment(SessionManager.self) private var sessionManager
    @Environment(NavigationManager.self) private var navigationManager
    @Environment(\.openWindow) private var openWindow
    @State private var selectedSession: Session?
    @State private var showingTerminal = false
    @State private var gridColumns = [
        GridItem(.adaptive(minimum: 300, maximum: 400), spacing: Theme.Spacing.md)
    ]
    @State private var isPerformingBlackHoleAnimation = false
    @State private var blackHoleAnimationTargets: Set<String> = []
    
    var body: some View {
        VStack(spacing: 0) {
            // Header
            SessionsHeaderView(blackHoleAnimationTargets: $blackHoleAnimationTargets)
                .padding(.horizontal, Theme.Spacing.lg)
                .padding(.vertical, Theme.Spacing.md)
                .background(Theme.Colors.background)
            
            Divider()
            
            // Content
            if sessionManager.isLoading && sessionManager.sessions.isEmpty {
                LoadingView(message: "Loading sessions...")
            } else if sessionManager.filteredSessions.isEmpty {
                emptyStateView
            } else {
                sessionsGrid
            }
        }
        .sheet(isPresented: Bindable(sessionManager).showNewSessionSheet) {
            NewSessionView()
                .environment(sessionManager)
        }
        .sheet(item: $selectedSession) { session in
            TerminalWindowView(session: session)
                .environment(sessionManager)
        }
        .onChange(of: navigationManager.selectedSessionId) { _, sessionId in
            if let sessionId,
               let session = sessionManager.sessions.first(where: { $0.id == sessionId }) {
                selectedSession = session
                navigationManager.selectedSessionId = nil
            }
        }
    }
    
    private var sessionsGrid: some View {
        ScrollView {
            LazyVGrid(columns: gridColumns, spacing: Theme.Spacing.md) {
                ForEach(sessionManager.filteredSessions) { session in
                    SessionCardView(session: session) {
                        // Open in new window
                        openWindow(value: session.id)
                    } onKill: {
                        Task {
                            try? await sessionManager.killSession(session)
                        }
                    }
                    .contextMenu {
                        Button("Open in New Window") {
                            openWindow(value: session.id)
                        }
                        
                        Button("Open in Sheet") {
                            selectedSession = session
                        }
                        
                        if session.isRunning {
                            Divider()
                            
                            Button("Kill Session") {
                                Task {
                                    try? await sessionManager.killSession(session)
                                }
                            }
                        }
                    }
                    .transition(
                        blackHoleAnimationTargets.contains(session.id) ?
                            .identity : // No transition for black hole items
                            .asymmetric(
                                insertion: .scale(scale: 0.9, anchor: .top)
                                    .combined(with: .opacity)
                                    .combined(with: .offset(y: -20)),
                                removal: .scale(scale: 0.8, anchor: .center)
                                    .combined(with: .opacity)
                            )
                    )
                    .blackHoleRemoval(
                        isRemoving: blackHoleAnimationTargets.contains(session.id),
                        onComplete: {
                            // Remove from animation targets when complete
                            blackHoleAnimationTargets.remove(session.id)
                        }
                    )
                    .id(session.id) // Important for proper animations
                }
            }
            .padding(Theme.Spacing.lg)
        }
        .animation(Theme.Animation.standard, value: sessionManager.filteredSessions)
    }
    
    private var emptyStateView: some View {
        EmptyStateView(
            title: emptyStateTitle,
            message: emptyStateMessage,
            systemImage: "terminal",
            action: sessionManager.searchText.isEmpty ? EmptyStateAction(
                title: "New Session",
                action: { sessionManager.showNewSessionSheet = true }
            ) : nil
        )
    }
    
    private var emptyStateTitle: String {
        if !sessionManager.searchText.isEmpty {
            return "No Matching Sessions"
        } else if !sessionManager.showExitedSessions && sessionManager.exitedSessions.count > 0 {
            return "No Running Sessions"
        } else {
            return "No Sessions"
        }
    }
    
    private var emptyStateMessage: String {
        if !sessionManager.searchText.isEmpty {
            return "Try adjusting your search"
        } else if !sessionManager.showExitedSessions && sessionManager.exitedSessions.count > 0 {
            return "Show exited sessions to see \(sessionManager.exitedSessions.count) more"
        } else {
            return "Create a new session to get started"
        }
    }
}

struct SessionsHeaderView: View {
    @Environment(SessionManager.self) private var sessionManager
    @Environment(ConnectionManager.self) private var connectionManager
    @State private var showKillAllConfirmation = false
    @State private var showCleanupConfirmation = false
    @State private var isRefreshing = false
    @State private var userAvatar: Image?
    @Binding var blackHoleAnimationTargets: Set<String>
    
    private var bindableSessionManager: Bindable<SessionManager> {
        Bindable(sessionManager)
    }
    
    var body: some View {
        HStack {
            // User info and avatar
            if let user = AuthService.shared.currentUser {
                HStack(spacing: Theme.Spacing.sm) {
                    // Avatar
                    Group {
                        if let avatar = userAvatar {
                            avatar
                                .resizable()
                                .scaledToFit()
                        } else {
                            Image(systemName: "person.circle.fill")
                                .foregroundStyle(Theme.Colors.secondaryText)
                        }
                    }
                    .frame(width: 32, height: 32)
                    .clipShape(Circle())
                    
                    // Username
                    Text(user.username)
                        .font(Theme.Typography.body)
                        .foregroundStyle(Theme.Colors.primaryText)
                }
                .onAppear {
                    loadUserAvatar()
                }
                
                Divider()
                    .frame(height: 24)
                    .padding(.horizontal, Theme.Spacing.sm)
            }
            
            // Title and counts
            HStack(spacing: Theme.Spacing.md) {
                Text("Sessions")
                    .font(Theme.Typography.title2)
                
                HStack(spacing: Theme.Spacing.sm) {
                    if sessionManager.sessionCounts.running > 0 {
                        Label("\(sessionManager.sessionCounts.running)", systemImage: "circle.fill")
                            .foregroundStyle(Theme.Colors.success)
                            .font(Theme.Typography.caption)
                            .transition(.scale.combined(with: .opacity))
                    }
                    
                    if sessionManager.sessionCounts.exited > 0 {
                        Label("\(sessionManager.sessionCounts.exited)", systemImage: "circle")
                            .foregroundStyle(Theme.Colors.secondaryText)
                            .font(Theme.Typography.caption)
                            .transition(.scale.combined(with: .opacity))
                    }
                }
                .animation(Theme.Animation.quick, value: sessionManager.sessionCounts.running)
                .animation(Theme.Animation.quick, value: sessionManager.sessionCounts.exited)
            }
            
            Spacer()
            
            // Controls
            HStack(spacing: Theme.Spacing.sm) {
                // Refresh button
                Button {
                    refreshSessions()
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .rotationEffect(.degrees(isRefreshing ? 360 : 0))
                        .animation(isRefreshing ? .linear(duration: 1).repeatForever(autoreverses: false) : .default, value: isRefreshing)
                }
                .buttonStyle(.plain)
                .disabled(isRefreshing)
                .help("Refresh sessions")
                
                // Search
                HStack {
                    Image(systemName: "magnifyingglass")
                        .foregroundStyle(Theme.Colors.secondaryText)
                    
                    TextField("Search sessions...", text: bindableSessionManager.searchText)
                        .textFieldStyle(.plain)
                        .frame(width: 200)
                }
                .padding(.horizontal, Theme.Spacing.sm)
                .padding(.vertical, 4)
                .background(Theme.Colors.secondaryBackground)
                .cornerRadius(Theme.Sizes.cornerRadius)
                
                // Show exited toggle
                Toggle(isOn: bindableSessionManager.showExitedSessions) {
                    Text("Show Exited")
                }
                .toggleStyle(.switch)
                .controlSize(.small)
                
                // Auto-refresh toggle
                Toggle(isOn: bindableSessionManager.autoRefreshEnabled) {
                    Image(systemName: "arrow.triangle.2.circlepath")
                }
                .toggleStyle(.switch)
                .controlSize(.small)
                .help("Auto-refresh sessions")
                
                // Cleanup button (only show if there are exited sessions)
                if sessionManager.sessionCounts.exited > 0 && sessionManager.showExitedSessions {
                    Button {
                        showCleanupConfirmation = true
                    } label: {
                        Label("Clean Up", systemImage: "trash")
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }
                
                // Kill All button (only show if there are running sessions)
                if sessionManager.sessionCounts.running > 0 {
                    Button {
                        showKillAllConfirmation = true
                    } label: {
                        Label("Kill All", systemImage: "stop.circle")
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .keyboardShortcut("k", modifiers: [.command, .shift])
                }
                
                // New session button
                Button {
                    sessionManager.showNewSessionSheet = true
                } label: {
                    Label("New Session", systemImage: "plus")
                }
                .primaryButtonStyle()
                .keyboardShortcut("n", modifiers: .command)
                
                // Logout button
                if AuthService.shared.isAuthenticated {
                    Button {
                        logout()
                    } label: {
                        Image(systemName: "rectangle.portrait.and.arrow.right")
                    }
                    .buttonStyle(.plain)
                    .help("Logout")
                }
            }
        }
        .alert("Kill All Sessions?", isPresented: $showKillAllConfirmation) {
            Button("Cancel", role: .cancel) { }
            Button("Kill All", role: .destructive) {
                killAllSessions()
            }
        } message: {
            Text("Are you sure you want to kill all \(sessionManager.sessionCounts.running) running sessions?")
        }
        .alert("Clean Up Exited Sessions?", isPresented: $showCleanupConfirmation) {
            Button("Cancel", role: .cancel) { }
            Button("Clean Up", role: .destructive) {
                cleanupExitedSessions()
            }
        } message: {
            Text("This will remove \(sessionManager.sessionCounts.exited) exited sessions from the list. This action cannot be undone.")
        }
    }
    
    private func killAllSessions() {
        // Trigger black hole animation for all running sessions
        let runningSessions = sessionManager.sessions.filter { $0.isRunning }
        blackHoleAnimationTargets = Set(runningSessions.map { $0.id })
        
        // After animation delay, actually kill the sessions
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
            Task {
                for session in runningSessions {
                    try? await sessionManager.killSession(session)
                }
                // Clean up animation targets
                blackHoleAnimationTargets.removeAll()
            }
        }
    }
    
    private func cleanupExitedSessions() {
        // Trigger black hole animation for all exited sessions
        let exitedSessions = sessionManager.sessions.filter { !$0.isRunning }
        blackHoleAnimationTargets = Set(exitedSessions.map { $0.id })
        
        // After animation delay, remove the sessions
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
            sessionManager.sessions.removeAll { !$0.isRunning }
            // Clean up animation targets
            blackHoleAnimationTargets.removeAll()
        }
    }
    
    private func refreshSessions() {
        withAnimation {
            isRefreshing = true
        }
        
        Task {
            await sessionManager.loadSessions()
            
            // Stop animation after a short delay
            try? await Task.sleep(nanoseconds: 500_000_000) // 0.5 seconds
            
            withAnimation {
                isRefreshing = false
            }
        }
    }
    
    private func loadUserAvatar() {
        guard let user = AuthService.shared.currentUser,
              let serverURL = connectionManager.serverURL else { return }
        
        Task {
            do {
                if let avatarData = try await AuthService.shared.getUserAvatar(serverURL: serverURL, userId: user.username) {
                    if let nsImage = NSImage(data: avatarData) {
                        await MainActor.run {
                            self.userAvatar = Image(nsImage: nsImage)
                        }
                    }
                }
            } catch {
                // Ignore avatar load errors
            }
        }
    }
    
    private func logout() {
        AuthService.shared.logout()
        connectionManager.disconnect()
    }
}

#Preview {
    SessionsView()
        .environment(SessionManager())
        .environment(NavigationManager())
        .frame(width: 1200, height: 800)
}