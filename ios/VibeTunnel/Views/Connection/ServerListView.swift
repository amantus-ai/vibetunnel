import SwiftUI

/// View for listing and connecting to saved servers
struct ServerListView: View {
    @State private var viewModel: ServerListViewModel
    @State private var logoScale: CGFloat = 0.8
    @State private var contentOpacity: Double = 0
    @State private var showingAddServer = false
    @State private var selectedProfile: ServerProfile?
    @State private var showingProfileEditor = false
    @State private var discoveryService = BonjourDiscoveryService.shared
    @State private var showingDiscoverySheet = false
    @State private var selectedDiscoveredServer: DiscoveredServer?
    @State private var serverToAdd: DiscoveredServer?

    /// Inject ViewModel directly - clean separation
    init(viewModel: ServerListViewModel = ServerListViewModel()) {
        _viewModel = State(initialValue: viewModel)
    }

    #if targetEnvironment(macCatalyst)
    @State private var windowManager = MacCatalystWindowManager.shared
    #endif

    var body: some View {
        NavigationStack {
            ZStack {
                ScrollView {
                    VStack(spacing: Theme.Spacing.extraLarge) {
                        // Logo and Title
                        self.headerView
                            .padding(.top, {
                                #if targetEnvironment(macCatalyst)
                                return self.windowManager.windowStyle == .inline ? 60 : 40
                                #else
                                return 40
                                #endif
                            }())

                        // Server List Section
                        if !self.viewModel.profiles.isEmpty {
                            self.serverListSection
                                .opacity(self.contentOpacity)
                                .onAppear {
                                    withAnimation(Theme.Animation.smooth.delay(0.3)) {
                                        self.contentOpacity = 1.0
                                    }
                                }
                        } else {
                            self.emptyStateView
                                .opacity(self.contentOpacity)
                                .onAppear {
                                    withAnimation(Theme.Animation.smooth.delay(0.3)) {
                                        self.contentOpacity = 1.0
                                    }
                                }
                        }

                        // Discovered servers section
                        if self.discoveryService.isDiscovering || !self.filteredDiscoveredServers.isEmpty {
                            self.discoveredServersSection
                                .padding(.top, Theme.Spacing.large)
                        }

                        Spacer(minLength: 50)
                    }
                    .padding()
                }
                .scrollBounceBehavior(.basedOnSize)
            }
            .toolbar(.hidden, for: .navigationBar)
            .background(Theme.Colors.terminalBackground.ignoresSafeArea())
            .sheet(item: self.$selectedProfile) { profile in
                ServerProfileEditView(
                    profile: profile,
                    onSave: { updatedProfile, password in
                        Task {
                            try await self.viewModel.updateProfile(updatedProfile, password: password)
                            self.selectedProfile = nil
                        }
                    },
                    onDelete: {
                        Task {
                            try await self.viewModel.deleteProfile(profile)
                            self.selectedProfile = nil
                        }
                    })
            }
            .sheet(
                isPresented: self.$showingAddServer,
                onDismiss: {
                    // Clear the selected discovered server when sheet is dismissed
                    self.selectedDiscoveredServer = nil
                },
                content: {
                    AddServerView(
                        initialHost: self.selectedDiscoveredServer?.host,
                        initialPort: self.selectedDiscoveredServer.map { String($0.port) },
                        initialName: self.selectedDiscoveredServer?.displayName)
                    { _ in
                        self.viewModel.loadProfiles()
                    }
                })
            .sheet(item: self.$serverToAdd) { server in
                AddServerView(
                    initialHost: server.host,
                    initialPort: String(server.port),
                    initialName: server.displayName)
                { _ in
                    self.viewModel.loadProfiles()
                    self.serverToAdd = nil
                }
            }
            .sheet(isPresented: self.$viewModel.showLoginView) {
                if let config = viewModel.connectionManager.serverConfig,
                   let authService = viewModel.connectionManager.authenticationService
                {
                    LoginView(
                        isPresented: self.$viewModel.showLoginView,
                        serverConfig: config,
                        authenticationService: authService)
                    { username, password in
                        // Delegate to ViewModel to handle login success
                        Task { @MainActor in
                            do {
                                try await self.viewModel.handleLoginSuccess(username: username, password: password)
                            } catch {
                                self.viewModel.errorMessage = "Failed to save credentials: \(error.localizedDescription)"
                            }
                        }
                    }
                }
            }
        }
        .navigationViewStyle(StackNavigationViewStyle())
        .onAppear {
            self.viewModel.loadProfiles()
            self.discoveryService.startDiscovery()
        }
        .onDisappear {
            self.discoveryService.stopDiscovery()
        }
        .sheet(isPresented: self.$showingDiscoverySheet) {
            DiscoveryDetailSheet(
                discoveredServers: self.filteredDiscoveredServers)
            { _ in
                self.showingDiscoverySheet = false
                // Auto-fill add server form with discovered server
                self.showingAddServer = true
            }
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
            .scaleEffect(self.logoScale)
            .onAppear {
                withAnimation(Theme.Animation.smooth.delay(0.1)) {
                    self.logoScale = 1.0
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

                Button {
                    self.selectedDiscoveredServer = nil // Clear any discovered server
                    self.showingAddServer = true
                } label: {
                    Image(systemName: "plus.circle")
                        .font(.system(size: 20))
                        .foregroundColor(Theme.Colors.primaryAccent)
                }
            }

            VStack(spacing: Theme.Spacing.small) {
                ForEach(self.viewModel.profiles) { profile in
                    ServerProfileCard(
                        profile: profile,
                        isLoading: self.viewModel.isLoading,
                        onConnect: {
                            self.connectToProfile(profile)
                        },
                        onEdit: {
                            self.selectedProfile = profile
                        })
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

            Button {
                self.selectedDiscoveredServer = nil // Clear any discovered server
                self.showingAddServer = true
            } label: {
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
                        .fill(Theme.Colors.terminalBackground))
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.CornerRadius.medium)
                        .stroke(Theme.Colors.primaryAccent, lineWidth: 2))
            }
        }
        .padding(.horizontal)
    }

    // MARK: - Discovered Servers Section

    private var filteredDiscoveredServers: [DiscoveredServer] {
        let profiles = self.viewModel.profiles
        let discovered = self.discoveryService.discoveredServers

        var filtered: [DiscoveredServer] = []
        for server in discovered {
            // Filter out servers that are already saved
            var isAlreadySaved = false
            for profile in profiles {
                // Extract host and port from profile URL
                if let urlComponents = URLComponents(string: profile.url),
                   let profileHost = urlComponents.host
                {
                    let defaultPort = urlComponents.scheme?.lowercased() == "https" ? 443 : 80
                    let profilePort = urlComponents.port ?? defaultPort

                    if profileHost == server.host, profilePort == server.port {
                        isAlreadySaved = true
                        break
                    }
                }
            }
            if !isAlreadySaved {
                filtered.append(server)
            }
        }
        return filtered
    }

    @ViewBuilder private var discoveredServersSection: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.medium) {
            // Header
            self.discoveryHeader

            // Content
            if self.filteredDiscoveredServers.isEmpty, self.discoveryService.isDiscovering {
                self.searchingView
            } else if !self.filteredDiscoveredServers.isEmpty {
                self.discoveredServersList
            }
        }
    }

    private var discoveryHeader: some View {
        HStack {
            Label("Discovered Servers", systemImage: "bonjour")
                .font(Theme.Typography.terminalSystem(size: 18, weight: .semibold))
                .foregroundColor(Theme.Colors.terminalForeground)

            Spacer()

            if self.discoveryService.isDiscovering {
                ProgressView()
                    .scaleEffect(0.7)
            }
        }
    }

    private var searchingView: some View {
        HStack {
            Text("Searching for local servers...")
                .font(Theme.Typography.terminalSystem(size: 14))
                .foregroundColor(Theme.Colors.secondaryText)
            Spacer()
        }
        .padding(Theme.Spacing.medium)
        .background(Theme.Colors.cardBackground.opacity(0.5))
        .cornerRadius(Theme.CornerRadius.small)
    }

    private var discoveredServersList: some View {
        VStack(spacing: Theme.Spacing.small) {
            ForEach(Array(self.filteredDiscoveredServers.prefix(3))) { server in
                DiscoveredServerCard(
                    server: server)
                {
                    self.connectToDiscoveredServer(server)
                }
            }

            if self.filteredDiscoveredServers.count > 3 {
                self.viewMoreButton
            }
        }
    }

    private var viewMoreButton: some View {
        Button {
            self.showingDiscoverySheet = true
        } label: {
            HStack {
                Text("View \(self.filteredDiscoveredServers.count - 3) more...")
                    .font(Theme.Typography.terminalSystem(size: 14))
                Image(systemName: "chevron.right")
                    .font(.system(size: 12))
            }
            .foregroundColor(Theme.Colors.primaryAccent)
        }
        .padding(.top, Theme.Spacing.small)
    }

    // MARK: - Actions

    private func connectToProfile(_ profile: ServerProfile) {
        Task {
            await self.viewModel.initiateConnectionToProfile(profile)
        }
    }

    private func connectToDiscoveredServer(_ server: DiscoveredServer) {
        // Use item binding to ensure server data is available when sheet opens
        self.serverToAdd = server
    }
}

// MARK: - Server Profile Card (moved from EnhancedConnectionView)

/// Card component displaying server profile information.
/// Shows server name, URL, authentication status, and last connection time.
struct ServerProfileCard: View {
    let profile: ServerProfile
    let isLoading: Bool
    let onConnect: () -> Void
    let onEdit: () -> Void

    @State private var isPressed = false

    var body: some View {
        HStack(spacing: Theme.Spacing.medium) {
            // Icon
            Image(systemName: self.profile.iconSymbol)
                .font(.system(size: 24))
                .foregroundColor(Theme.Colors.primaryAccent)
                .frame(width: 40, height: 40)
                .background(Theme.Colors.primaryAccent.opacity(0.1))
                .cornerRadius(Theme.CornerRadius.small)

            // Server Info
            VStack(alignment: .leading, spacing: 2) {
                Text(self.profile.name)
                    .font(Theme.Typography.terminalSystem(size: 16, weight: .medium))
                    .foregroundColor(Theme.Colors.terminalForeground)

                HStack(spacing: 4) {
                    Text(self.profile.url)
                        .font(Theme.Typography.terminalSystem(size: 12))
                        .foregroundColor(Theme.Colors.secondaryText)

                    if self.profile.requiresAuth {
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
                Button(action: self.onEdit) {
                    Image(systemName: "ellipsis.circle")
                        .font(.system(size: 20))
                        .foregroundColor(Theme.Colors.secondaryText)
                }
                .buttonStyle(.plain)

                Button(action: self.onConnect) {
                    HStack(spacing: 4) {
                        if self.isLoading {
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
                .disabled(self.isLoading)
            }
        }
        .padding(Theme.Spacing.medium)
        .background(Theme.Colors.cardBackground)
        .cornerRadius(Theme.CornerRadius.card)
        .overlay(
            RoundedRectangle(cornerRadius: Theme.CornerRadius.card)
                .stroke(Theme.Colors.cardBorder, lineWidth: 1))
        .scaleEffect(self.isPressed ? 0.98 : 1.0)
        .animation(.easeInOut(duration: 0.1), value: self.isPressed)
        .onTapGesture {
            self.onConnect()
        }
        .simultaneousGesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in self.isPressed = true }
                .onEnded { _ in self.isPressed = false })
    }
}

#Preview {
    ServerListView()
        .environment(ConnectionManager.shared)
}
