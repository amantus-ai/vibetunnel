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
    @State private var tailscaleDiscovery = TailscaleDiscoveryService.shared
    @State private var tailscaleService = TailscaleService.shared
    @State private var showingDiscoverySheet = false
    @State private var selectedDiscoveredServer: DiscoveredServer?
    @State private var serverToAdd: DiscoveredServer?
    @State private var showingSettings = false
    @State private var settingsInitialTab: SettingsView.SettingsTab = .general

    private let logger = Logger(category: "ServerListView")

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
                // Settings button (top right corner)
                VStack {
                    HStack {
                        Spacer()
                        Button {
                            self.settingsInitialTab = .general
                            self.showingSettings = true
                        } label: {
                            Image(systemName: "gearshape.fill")
                                .font(.system(size: 22))
                                .foregroundColor(Theme.Colors.secondaryText)
                        }
                        .padding()
                    }
                    Spacer()
                }
                .zIndex(1)

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

                        // Tailscale servers section - Always show for demo
                        self.tailscaleServersSection
                            .padding(.top, Theme.Spacing.large)

                        Spacer(minLength: 50)
                    }
                    .padding()
                }
                .scrollBounceBehavior(.basedOnSize)
            }
            .toolbar(.hidden, for: .navigationBar)
            .background(Theme.Colors.terminalBackground.ignoresSafeArea())
            .task {
                // Refresh Tailscale status first
                await self.tailscaleService.refreshStatus()

                // Now start discovery if Tailscale is running
                if self.tailscaleService.isRunning {
                    self.tailscaleDiscovery.startDiscovery()
                }
            }
            .onReceive(
                NotificationCenter.default
                    .publisher(for: Notification.Name("TailscaleCredentialsCleared")))
            { _ in
                // When Tailscale is reset, clear the discovered servers from view
                // Force refresh the service references to get cleared state
                Task { @MainActor in
                    self.tailscaleDiscovery = TailscaleDiscoveryService.shared
                    self.tailscaleService = TailscaleService.shared

                    // Remove any saved servers that are Tailscale-based
                    let tailscaleProfiles = self.viewModel.profiles
                        .filter { $0.isTailscaleEnabled || $0.tailscaleHostname != nil }
                    for profile in tailscaleProfiles {
                        try? await self.viewModel.deleteProfile(profile)
                    }
                }
            }
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
                .sheet(
                    isPresented: self.$showingSettings,
                    onDismiss: {
                        // Reset to general tab after dismissal
                        self.settingsInitialTab = .general

                        // Reload profiles immediately to show newly added servers
                        self.viewModel.loadProfiles()

                        // Refresh Tailscale discovery after settings close
                        // in case user configured Tailscale
                        Task {
                            await self.tailscaleService.refreshStatus()
                            if self.tailscaleService.isConfigured, self.tailscaleService.isRunning {
                                self.tailscaleDiscovery.startDiscovery()
                            }
                        }
                    },
                    content: {
                        SettingsView(selectedTab: self.$settingsInitialTab)
                    })
                .overlay(alignment: .top) {
                    if let statusMessage = viewModel.connectionStatusMessage {
                        HStack {
                            Image(systemName: "info.circle.fill")
                                .foregroundColor(.orange)
                            Text(statusMessage)
                                .font(.system(size: 14))
                        }
                        .padding()
                        .background(Theme.Colors.terminalBackground.opacity(0.95))
                        .cornerRadius(8)
                        .overlay(
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(Color.orange.opacity(0.3), lineWidth: 1))
                        .padding(.top, 50)
                        .transition(.move(edge: .top).combined(with: .opacity))
                    }
                }
        }
        .navigationViewStyle(StackNavigationViewStyle())
        .onAppear {
            self.viewModel.loadProfilesAndCheckHealth()
            self.discoveryService.startDiscovery()

            // Also reload profiles in case they were added from settings
            self.viewModel.loadProfiles()
        }
        .alert("Connection Failed", isPresented: .constant(self.viewModel.errorMessage != nil)) {
            Button("OK") {
                self.viewModel.errorMessage = nil
            }
        } message: {
            Text(self.viewModel.errorMessage ?? "")
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

                // Refresh button
                Button {
                    Task {
                        await self.viewModel.checkAndUpdateAllProfiles()
                    }
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 18))
                        .foregroundColor(Theme.Colors.secondaryText)
                }

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

    private var discoveredServersSection: some View {
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

    // MARK: - Tailscale Servers Section

    private var tailscaleServersSection: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.medium) {
            // Header
            HStack {
                Label("Tailscale Network", systemImage: "lock.shield")
                    .font(Theme.Typography.terminalSystem(size: 18, weight: .semibold))
                    .foregroundColor(Theme.Colors.terminalForeground)

                Spacer()

                if self.tailscaleDiscovery.isDiscovering {
                    ProgressView()
                        .scaleEffect(0.7)
                } else {
                    Button {
                        Task {
                            await self.tailscaleDiscovery.refresh()
                        }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                            .font(.system(size: 14))
                            .foregroundColor(Theme.Colors.secondaryText)
                    }
                }
            }

            // Content
            if !self.tailscaleService.isInstalled {
                VStack(alignment: .leading, spacing: Theme.Spacing.small) {
                    Text("Tailscale not installed")
                        .font(Theme.Typography.terminalSystem(size: 14))
                        .foregroundColor(Theme.Colors.secondaryText)
                    Button {
                        self.settingsInitialTab = .tailscale
                        self.showingSettings = true
                    } label: {
                        Text("Configure Tailscale →")
                            .font(Theme.Typography.terminalSystem(size: 14))
                            .foregroundColor(Theme.Colors.primaryAccent)
                    }
                }
                .padding(Theme.Spacing.medium)
            } else if !self.tailscaleService.isRunning {
                VStack(alignment: .leading, spacing: Theme.Spacing.small) {
                    Text("Tailscale not running")
                        .font(Theme.Typography.terminalSystem(size: 14))
                        .foregroundColor(Theme.Colors.secondaryText)
                    Button {
                        self.settingsInitialTab = .tailscale
                        self.showingSettings = true
                    } label: {
                        Text("Open Tailscale Settings →")
                            .font(Theme.Typography.terminalSystem(size: 14))
                            .foregroundColor(Theme.Colors.primaryAccent)
                    }
                }
                .padding(Theme.Spacing.medium)
            } else if self.tailscaleDiscovery.discoveredServers.isEmpty, self.tailscaleDiscovery.isDiscovering {
                HStack {
                    Text("Searching for Tailscale servers...")
                        .font(Theme.Typography.terminalSystem(size: 14))
                        .foregroundColor(Theme.Colors.secondaryText)
                    Spacer()
                }
                .padding(Theme.Spacing.medium)
            } else if !self.tailscaleDiscovery.discoveredServers.isEmpty {
                let filteredServers = self.tailscaleDiscovery.discoveredServers.filter { server in
                    // Check if this server is already saved
                    !self.viewModel.profiles.contains { profile in
                        // Match by Tailscale hostname
                        if let profileTailscaleHostname = profile.tailscaleHostname,
                           profileTailscaleHostname == server.hostname
                        {
                            return true
                        }

                        // Match by IP address
                        if let profileTailscaleIP = profile.tailscaleIP,
                           let serverIP = server.ip,
                           profileTailscaleIP == serverIP
                        {
                            return true
                        }

                        // Match by regular host/port combination
                        if profile.host == (server.ip ?? server.hostname), profile.port == server.port {
                            return true
                        }

                        return false
                    }
                }

                if !filteredServers.isEmpty {
                    VStack(spacing: Theme.Spacing.small) {
                        ForEach(filteredServers) { server in
                            TailscaleServerCard(
                                server: server)
                            {
                                self.addTailscaleServer(server)
                            }
                        }
                    }
                }
            }
        }
    }

    private func addTailscaleServer(_ server: TailscaleDiscoveryService.TailscaleServer) {
        // Use HTTPS URL if available, otherwise construct HTTP URL
        let url: String = if let httpsUrl = server.httpsUrl {
            httpsUrl
        } else {
            "http://\(server.ip ?? server.hostname):\(server.port)"
        }

        // Check for existing profile with the same Tailscale hostname — update it
        // instead of creating a duplicate.
        let existingProfile = self.viewModel.profiles.first { $0.tailscaleHostname == server.hostname }

        var profile: ServerProfile
        if var existing = existingProfile {
            existing.url = url
            existing.host = server.ip ?? server.hostname
            existing.port = server.port
            existing.tailscaleIP = server.ip
            existing.httpsAvailable = server.httpsUrl != nil
            existing.isPublic = server.isPublic
            existing.preferSSL = server.httpsUrl != nil
            existing.updatedAt = Date()
            profile = existing
        } else {
            profile = ServerProfile(
                id: UUID(),
                name: server.displayName,
                url: url,
                host: server.ip ?? server.hostname,
                port: server.port,
                tailscaleHostname: server.hostname,
                tailscaleIP: server.ip,
                isTailscaleEnabled: true,
                preferTailscale: true,
                httpsAvailable: server.httpsUrl != nil,
                isPublic: server.isPublic,
                preferSSL: server.httpsUrl != nil)
        }

        Task {
            do {
                if existingProfile != nil {
                    try await self.viewModel.updateProfile(profile)
                } else {
                    try await self.viewModel.addProfile(profile, password: nil)
                }
                self.tailscaleDiscovery.addKnownServer(hostname: server.hostname)
            } catch {
                self.logger.error("Failed to save Tailscale server: \(error)")
            }
        }
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
                HStack(spacing: 4) {
                    Text(self.profile.name)
                        .font(Theme.Typography.terminalSystem(size: 16, weight: .medium))
                        .foregroundColor(Theme.Colors.terminalForeground)

                    if self.profile.isPublic {
                        // Public (Funnel) indicator
                        Text("🌐")
                            .font(.system(size: 12))
                    }

                    // Tailscale indicator
                    if self.profile.isTailscaleEnabled {
                        Text("🔗")
                            .font(.system(size: 12))
                    }
                }

                // Show appropriate URL with security indicator
                HStack(spacing: 4) {
                    // Security indicators next to URL
                    if self.profile.httpsAvailable, self.profile.preferSSL {
                        // HTTPS/SSL indicator - locked
                        Image(systemName: "lock.fill")
                            .font(.system(size: 10))
                            .foregroundColor(Theme.Colors.successAccent)
                    } else {
                        // HTTP indicator - unlocked
                        Image(systemName: "lock.open.fill")
                            .font(.system(size: 10))
                            .foregroundColor(Theme.Colors.secondaryText)
                    }

                    // Show appropriate URL based on Tailscale status
                    if self.profile.preferTailscale, self.profile.tailscaleHostname != nil {
                        Text(self.profile.tailscaleHostname ?? self.profile.url)
                            .font(Theme.Typography.terminalSystem(size: 12))
                            .foregroundColor(Theme.Colors.secondaryText)
                    } else {
                        Text(self.profile.url)
                            .font(Theme.Typography.terminalSystem(size: 12))
                            .foregroundColor(Theme.Colors.secondaryText)
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
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.borderless)
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
        .contentShape(Rectangle())
        .onTapGesture {
            self.onConnect()
        }
    }
}

/// Card component for displaying discovered Tailscale servers
struct TailscaleServerCard: View {
    let server: TailscaleDiscoveryService.TailscaleServer
    let onAdd: () -> Void

    @State private var isAdded = false

    var body: some View {
        HStack(spacing: Theme.Spacing.medium) {
            // Icon
            Image(systemName: self.server.isPublic ? "globe.badge.chevron.backward" : "lock.shield.fill")
                .font(.system(size: 24))
                .foregroundColor(self.server.isPublic ? .purple : .blue)
                .frame(width: 40, height: 40)
                .background((self.server.isPublic ? Color.purple : Color.blue).opacity(0.1))
                .cornerRadius(Theme.CornerRadius.small)

            // Server Info
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 4) {
                    Text(self.server.displayName)
                        .font(Theme.Typography.terminalSystem(size: 16, weight: .medium))
                        .foregroundColor(Theme.Colors.terminalForeground)

                    // Show public/private indicator
                    if self.server.isPublic {
                        Text("Public")
                            .font(Theme.Typography.terminalSystem(size: 10))
                            .fontWeight(.semibold)
                            .foregroundColor(.purple)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.purple.opacity(0.15))
                            .cornerRadius(4)
                    }
                }

                VStack(alignment: .leading, spacing: 2) {
                    // Show HTTPS URL if available
                    if let httpsUrl = server.httpsUrl {
                        HStack(spacing: 4) {
                            Image(systemName: "lock.fill")
                                .font(.system(size: 10))
                                .foregroundColor(.green)
                            Text(httpsUrl)
                                .font(Theme.Typography.terminalSystem(size: 12))
                                .foregroundColor(Theme.Colors.secondaryText)
                                .lineLimit(1)
                                .truncationMode(.middle)
                        }
                    }

                    // Always show HTTP connection info
                    HStack(spacing: 8) {
                        if let ip = server.ip {
                            Text("\(ip):\(String(self.server.port))")
                                .font(Theme.Typography.terminalSystem(size: 12))
                                .foregroundColor(Theme.Colors.secondaryText
                                    .opacity(self.server.httpsUrl != nil ? 0.7 : 1.0))
                        } else {
                            Text("\(self.server.hostname):\(String(self.server.port))")
                                .font(Theme.Typography.terminalSystem(size: 12))
                                .foregroundColor(Theme.Colors.secondaryText
                                    .opacity(self.server.httpsUrl != nil ? 0.7 : 1.0))
                        }

                        if self.server.isReachable {
                            Circle()
                                .fill(Color.green)
                                .frame(width: 6, height: 6)
                        } else {
                            Circle()
                                .fill(Color.orange)
                                .frame(width: 6, height: 6)
                        }
                    }
                }
            }

            Spacer()

            // Add Button
            if self.isAdded {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 20))
                    .foregroundColor(.green)
            } else {
                Button {
                    withAnimation {
                        self.isAdded = true
                        self.onAdd()
                    }
                } label: {
                    Text("Add")
                        .font(Theme.Typography.terminalSystem(size: 14))
                        .fontWeight(.medium)
                        .foregroundColor(.white)
                        .padding(.horizontal, Theme.Spacing.medium)
                        .padding(.vertical, Theme.Spacing.small)
                        .background(Theme.Colors.primaryAccent)
                        .cornerRadius(Theme.CornerRadius.small)
                }
            }
        }
        .padding(Theme.Spacing.medium)
        .background(Theme.Colors.cardBackground)
        .cornerRadius(Theme.CornerRadius.medium)
        .overlay(
            RoundedRectangle(cornerRadius: Theme.CornerRadius.medium)
                .stroke(self.server.isPublic ? Color.purple.opacity(0.3) : Color.blue.opacity(0.3), lineWidth: 1))
    }
}

#Preview {
    ServerListView()
        .environment(ConnectionManager.shared)
}
