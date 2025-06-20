import SwiftUI

struct SessionListView: View {
    @EnvironmentObject var connectionManager: ConnectionManager
    @StateObject private var viewModel = SessionListViewModel()
    @State private var showingCreateSession = false
    @State private var selectedSession: Session?
    
    var body: some View {
        NavigationView {
            ZStack {
                // Background
                Theme.Colors.terminalBackground
                    .ignoresSafeArea()
                
                if viewModel.isLoading && viewModel.sessions.isEmpty {
                    ProgressView("Loading sessions...")
                        .progressViewStyle(CircularProgressViewStyle(tint: Theme.Colors.primaryAccent))
                        .font(Theme.Typography.terminalSystem(size: 14))
                        .foregroundColor(Theme.Colors.terminalForeground)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if viewModel.sessions.isEmpty {
                    emptyStateView
                } else {
                    sessionList
                }
            }
            .navigationTitle("Sessions")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button(action: {
                        HapticFeedback.impact(.medium)
                        connectionManager.disconnect()
                    }) {
                        HStack(spacing: 4) {
                            Image(systemName: "xmark.circle")
                            Text("Disconnect")
                        }
                        .foregroundColor(Theme.Colors.errorAccent)
                    }
                }
                
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: {
                        HapticFeedback.impact(.light)
                        showingCreateSession = true
                    }) {
                        Image(systemName: "plus.circle.fill")
                            .font(.title3)
                            .foregroundColor(Theme.Colors.primaryAccent)
                    }
                }
            }
            .sheet(isPresented: $showingCreateSession) {
                SessionCreateView(isPresented: $showingCreateSession) { newSessionId in
                    Task {
                        await viewModel.loadSessions()
                        // Find and select the new session
                        if let newSession = viewModel.sessions.first(where: { $0.id == newSessionId }) {
                            selectedSession = newSession
                        }
                    }
                }
            }
            .sheet(item: $selectedSession) { session in
                TerminalView(session: session)
            }
            .refreshable {
                await viewModel.loadSessions()
            }
            .onAppear {
                viewModel.startAutoRefresh()
            }
            .onDisappear {
                viewModel.stopAutoRefresh()
            }
        }
        .navigationViewStyle(StackNavigationViewStyle())
        .preferredColorScheme(.dark)
        .environmentObject(connectionManager)
    }
    
    private var emptyStateView: some View {
        VStack(spacing: Theme.Spacing.xl) {
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
            
            VStack(spacing: Theme.Spacing.sm) {
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
                showingCreateSession = true
            }) {
                HStack(spacing: Theme.Spacing.sm) {
                    Image(systemName: "plus.circle")
                    Text("Create Session")
                }
                .font(Theme.Typography.terminalSystem(size: 16))
                .fontWeight(.medium)
            }
            .terminalButton()
        }
        .padding()
    }
    
    private var sessionList: some View {
        ScrollView {
            LazyVStack(spacing: Theme.Spacing.md) {
                // Clean up all button if there are exited sessions
                if viewModel.sessions.contains(where: { !$0.isRunning }) {
                    Button(action: {
                        HapticFeedback.impact(.medium)
                        Task {
                            await viewModel.cleanupAllExited()
                        }
                    }) {
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
                                .fill(Theme.Colors.warningAccent.opacity(0.1))
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: Theme.CornerRadius.card)
                                .stroke(Theme.Colors.warningAccent.opacity(0.3), lineWidth: 1)
                        )
                    }
                    .buttonStyle(PlainButtonStyle())
                    .transition(.asymmetric(
                        insertion: .scale.combined(with: .opacity),
                        removal: .scale.combined(with: .opacity)
                    ))
                }
                
                ForEach(viewModel.sessions) { session in
                    SessionCardView(session: session) {
                        HapticFeedback.selection()
                        selectedSession = session
                    } onKill: {
                        HapticFeedback.impact(.medium)
                        Task {
                            await viewModel.killSession(session.id)
                        }
                    } onCleanup: {
                        HapticFeedback.impact(.medium)
                        Task {
                            await viewModel.cleanupSession(session.id)
                        }
                    }
                    .transition(.asymmetric(
                        insertion: .scale(scale: 0.8).combined(with: .opacity),
                        removal: .scale(scale: 0.8).combined(with: .opacity)
                    ))
                }
            }
            .padding()
            .animation(Theme.Animation.smooth, value: viewModel.sessions)
        }
    }
}

@MainActor
class SessionListViewModel: ObservableObject {
    @Published var sessions: [Session] = []
    @Published var isLoading = false
    @Published var errorMessage: String?
    
    private var refreshTimer: Timer?
    private let sessionService = SessionService.shared
    
    func startAutoRefresh() {
        Task {
            await loadSessions()
        }
        
        // Refresh every 3 seconds
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 3.0, repeats: true) { _ in
            Task { @MainActor in
                await self.loadSessions()
            }
        }
    }
    
    func stopAutoRefresh() {
        refreshTimer?.invalidate()
        refreshTimer = nil
    }
    
    func loadSessions() async {
        if sessions.isEmpty {
            isLoading = true
        }
        
        do {
            sessions = try await sessionService.getSessions()
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
        
        isLoading = false
    }
    
    func killSession(_ sessionId: String) async {
        do {
            try await sessionService.killSession(sessionId)
            await loadSessions()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
    
    func cleanupSession(_ sessionId: String) async {
        do {
            try await sessionService.cleanupSession(sessionId)
            await loadSessions()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
    
    func cleanupAllExited() async {
        do {
            let cleaned = try await sessionService.cleanupAllExitedSessions()
            await loadSessions()
            HapticFeedback.notification(.success)
        } catch {
            errorMessage = error.localizedDescription
            HapticFeedback.notification(.error)
        }
    }
}