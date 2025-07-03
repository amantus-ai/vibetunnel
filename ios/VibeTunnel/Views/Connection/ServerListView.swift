import SwiftUI

/// View for listing and connecting to saved servers
struct ServerListView: View {
    @State private var viewModel: ServerListViewModel
    @State private var logoScale: CGFloat = 0.8
    @State private var contentOpacity: Double = 0
    @State private var showingAddServer = false
    @State private var selectedProfile: ServerProfile?
    @State private var showingProfileEditor = false
    
    // Inject ViewModel directly - clean separation
    init(viewModel: ServerListViewModel = ServerListViewModel()) {
        _viewModel = State(initialValue: viewModel)
    }

    #if targetEnvironment(macCatalyst)
        @StateObject private var windowManager = MacCatalystWindowManager.shared
    #endif

    var body: some View {
        NavigationStack {
            ZStack {
                ScrollView {
                    VStack(spacing: Theme.Spacing.extraLarge) {
                        // Logo and Title
                        headerView
                            .padding(.top, {
                                #if targetEnvironment(macCatalyst)
                                    return windowManager.windowStyle == .inline ? 60 : 40
                                #else
                                    return 40
                                #endif
                            }())

                        // Server List Section
                        if !viewModel.profiles.isEmpty {
                            serverListSection
                                .opacity(contentOpacity)
                                .onAppear {
                                    withAnimation(Theme.Animation.smooth.delay(0.3)) {
                                        contentOpacity = 1.0
                                    }
                                }
                        } else {
                            emptyStateView
                                .opacity(contentOpacity)
                                .onAppear {
                                    withAnimation(Theme.Animation.smooth.delay(0.3)) {
                                        contentOpacity = 1.0
                                    }
                                }
                        }

                        Spacer(minLength: 50)
                    }
                    .padding()
                }
                .scrollBounceBehavior(.basedOnSize)
            }
            .toolbar(.hidden, for: .navigationBar)
            .background(Theme.Colors.terminalBackground.ignoresSafeArea())
            .sheet(item: $selectedProfile) { profile in
                ServerProfileEditView(
                    profile: profile,
                    onSave: { updatedProfile, password in
                        Task {
                            try await viewModel.updateProfile(updatedProfile, password: password)
                            selectedProfile = nil
                        }
                    },
                    onDelete: {
                        Task {
                            try await viewModel.deleteProfile(profile)
                            selectedProfile = nil
                        }
                    }
                )
            }
            .sheet(isPresented: $showingAddServer) {
                AddServerView { newProfile in
                    viewModel.loadProfiles()
                }
            }
            .sheet(isPresented: $viewModel.showLoginView) {
                if let config = viewModel.connectionManager.serverConfig,
                   let authService = viewModel.connectionManager.authenticationService
                {
                    LoginView(
                        isPresented: $viewModel.showLoginView,
                        serverConfig: config,
                        authenticationService: authService
                    ) { username, password in
                        // Delegate to ViewModel to handle login success
                        viewModel.handleLoginSuccess(username: username, password: password)
                    }
                }
            }
        }
        .navigationViewStyle(StackNavigationViewStyle())
        .onAppear {
            viewModel.loadProfiles()
        }
    }

    // MARK: - Header View

    private var headerView: some View {
        VStack(spacing: Theme.Spacing.large) {
            ZStack {
                // Glow effect
                Image(systemName: "terminal.fill")
                    .font(.system(size: 80))
                    .foregroundColor(Theme.Colors.primaryAccent)
                    .blur(radius: 20)
                    .opacity(0.5)

                // Main icon
                Image(systemName: "terminal.fill")
                    .font(.system(size: 80))
                    .foregroundColor(Theme.Colors.primaryAccent)
                    .glowEffect()
            }
            .scaleEffect(logoScale)
            .onAppear {
                withAnimation(Theme.Animation.smooth.delay(0.1)) {
                    logoScale = 1.0
                }
            }

            VStack(spacing: Theme.Spacing.small) {
                Text("VibeTunnel")
                    .font(.system(size: 42, weight: .bold, design: .rounded))
                    .foregroundColor(Theme.Colors.terminalForeground)

                Text("Terminal Multiplexer")
                    .font(Theme.Typography.terminalSystem(size: 16))
                    .foregroundColor(Theme.Colors.terminalForeground.opacity(0.7))
                    .tracking(2)

                // Network status
                ConnectionStatusView()
                    .padding(.top, Theme.Spacing.small)
            }
        }
    }

    // MARK: - Server List Section

    private var serverListSection: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.medium) {
            HStack {
                Text("Saved Servers")
                    .font(Theme.Typography.terminalSystem(size: 18, weight: .semibold))
                    .foregroundColor(Theme.Colors.terminalForeground)

                Spacer()

                Button(action: {
                    showingAddServer = true
                }) {
                    Image(systemName: "plus.circle")
                        .font(.system(size: 20))
                        .foregroundColor(Theme.Colors.primaryAccent)
                }
            }

            VStack(spacing: Theme.Spacing.small) {
                ForEach(viewModel.profiles) { profile in
                    ServerProfileCard(
                        profile: profile,
                        isLoading: viewModel.isLoading,
                        onConnect: {
                            connectToProfile(profile)
                        },
                        onEdit: {
                            selectedProfile = profile
                        }
                    )
                }
            }
        }
    }

    // MARK: - Empty State View

    private var emptyStateView: some View {
        VStack(spacing: Theme.Spacing.large) {
            VStack(spacing: Theme.Spacing.medium) {
                Image(systemName: "server.rack")
                    .font(.system(size: 60))
                    .foregroundColor(Theme.Colors.secondaryText)

                Text("No Servers Yet")
                    .font(.title2)
                    .fontWeight(.semibold)
                    .foregroundColor(Theme.Colors.terminalForeground)

                Text("Add your first server to get started with VibeTunnel")
                    .font(.body)
                    .foregroundColor(Theme.Colors.secondaryText)
                    .multilineTextAlignment(.center)
            }

            Button(action: {
                showingAddServer = true
            }) {
                HStack(spacing: Theme.Spacing.small) {
                    Image(systemName: "plus.circle.fill")
                    Text("Add Server")
                }
                .font(Theme.Typography.terminalSystem(size: 16))
                .fontWeight(.semibold)
                .foregroundColor(Theme.Colors.primaryAccent)
                .padding(.vertical, Theme.Spacing.medium)
                .padding(.horizontal, Theme.Spacing.large)
                .background(
                    RoundedRectangle(cornerRadius: Theme.CornerRadius.medium)
                        .fill(Theme.Colors.terminalBackground)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.CornerRadius.medium)
                        .stroke(Theme.Colors.primaryAccent, lineWidth: 2)
                )
            }
        }
        .padding(.horizontal)
    }

    // MARK: - Actions

    private func connectToProfile(_ profile: ServerProfile) {
        Task {
            await viewModel.initiateConnectionToProfile(profile)
        }
    }
}

// MARK: - Server Profile Card (moved from EnhancedConnectionView)

struct ServerProfileCard: View {
    let profile: ServerProfile
    let isLoading: Bool
    let onConnect: () -> Void
    let onEdit: () -> Void

    @State private var isPressed = false

    var body: some View {
        HStack(spacing: Theme.Spacing.medium) {
            // Icon
            Image(systemName: profile.iconSymbol)
                .font(.system(size: 24))
                .foregroundColor(Theme.Colors.primaryAccent)
                .frame(width: 40, height: 40)
                .background(Theme.Colors.primaryAccent.opacity(0.1))
                .cornerRadius(Theme.CornerRadius.small)

            // Server Info
            VStack(alignment: .leading, spacing: 2) {
                Text(profile.name)
                    .font(Theme.Typography.terminalSystem(size: 16, weight: .medium))
                    .foregroundColor(Theme.Colors.terminalForeground)

                HStack(spacing: 4) {
                    Text(profile.url)
                        .font(Theme.Typography.terminalSystem(size: 12))
                        .foregroundColor(Theme.Colors.secondaryText)

                    if profile.requiresAuth {
                        Image(systemName: "lock.fill")
                            .font(.system(size: 10))
                            .foregroundColor(Theme.Colors.warningAccent)
                    }
                }

                if let lastConnected = profile.lastConnected {
                    Text(RelativeDateTimeFormatter().localizedString(for: lastConnected, relativeTo: Date()))
                        .font(Theme.Typography.terminalSystem(size: 11))
                        .foregroundColor(Theme.Colors.secondaryText.opacity(0.7))
                }
            }

            Spacer()

            // Action Buttons
            HStack(spacing: Theme.Spacing.small) {
                Button(action: onEdit) {
                    Image(systemName: "ellipsis.circle")
                        .font(.system(size: 20))
                        .foregroundColor(Theme.Colors.secondaryText)
                }
                .buttonStyle(.plain)

                Button(action: onConnect) {
                    HStack(spacing: 4) {
                        if isLoading {
                            ProgressView()
                                .scaleEffect(0.8)
                        } else {
                            Image(systemName: "arrow.right.circle.fill")
                                .font(.system(size: 24))
                        }
                    }
                    .foregroundColor(Theme.Colors.primaryAccent)
                }
                .buttonStyle(.plain)
                .disabled(isLoading)
            }
        }
        .padding(Theme.Spacing.medium)
        .background(Theme.Colors.cardBackground)
        .cornerRadius(Theme.CornerRadius.card)
        .overlay(
            RoundedRectangle(cornerRadius: Theme.CornerRadius.card)
                .stroke(Theme.Colors.cardBorder, lineWidth: 1)
        )
        .scaleEffect(isPressed ? 0.98 : 1.0)
        .animation(.easeInOut(duration: 0.1), value: isPressed)
        .onTapGesture {
            onConnect()
        }
        .simultaneousGesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in isPressed = true }
                .onEnded { _ in isPressed = false }
        )
    }
}

#Preview {
    ServerListView()
        .environment(ConnectionManager.shared)
}