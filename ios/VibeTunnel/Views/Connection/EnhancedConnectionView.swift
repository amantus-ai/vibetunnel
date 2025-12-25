import SwiftUI

/// Enhanced connection view with server profiles support
struct EnhancedConnectionView: View {
    @Environment(ConnectionManager.self)
    var connectionManager
    @State private var networkMonitor = NetworkMonitor.shared
    @State private var viewModel = ConnectionViewModel()
    @State private var profilesViewModel = ServerListViewModel()
    @State private var logoScale: CGFloat = 0.8
    @State private var contentOpacity: Double = 0
    @State private var showingNewServerForm = false
    @State private var selectedProfile: ServerProfile?
    @State private var showingProfileEditor = false

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

                        // Quick Connect Section
                        if !self.profilesViewModel.profiles.isEmpty && !self.showingNewServerForm {
                            self.quickConnectSection
                                .opacity(self.contentOpacity)
                                .onAppear {
                                    withAnimation(Theme.Animation.smooth.delay(0.3)) {
                                        self.contentOpacity = 1.0
                                    }
                                }
                        }

                        // New Connection Form
                        if self.showingNewServerForm || self.profilesViewModel.profiles.isEmpty {
                            self.newConnectionSection
                                .opacity(self.contentOpacity)
                                .onAppear {
                                    withAnimation(Theme.Animation.smooth.delay(0.3)) {
                                        self.contentOpacity = 1.0
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
            .sheet(item: self.$selectedProfile) { profile in
                ServerProfileEditView(
                    profile: profile,
                    onSave: { updatedProfile, password in
                        Task {
                            try await self.profilesViewModel.updateProfile(updatedProfile, password: password)
                            self.selectedProfile = nil
                        }
                    },
                    onDelete: {
                        Task {
                            try await self.profilesViewModel.deleteProfile(profile)
                            self.selectedProfile = nil
                        }
                    })
            }
            .sheet(isPresented: self.$viewModel.showLoginView) {
                if let config = connectionManager.serverConfig,
                   let authService = connectionManager.authenticationService
                {
                    LoginView(
                        isPresented: self.$viewModel.showLoginView,
                        serverConfig: config,
                        authenticationService: authService)
                    { _, _ in
                        // Authentication successful, mark as connected
                        self.connectionManager.isConnected = true
                    }
                }
            }
        }
        .navigationViewStyle(StackNavigationViewStyle())
        .onAppear {
            self.profilesViewModel.loadProfiles()
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

    // MARK: - Quick Connect Section

    private var quickConnectSection: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.medium) {
            HStack {
                Text("Saved Servers")
                    .font(Theme.Typography.terminalSystem(size: 18, weight: .semibold))
                    .foregroundColor(Theme.Colors.terminalForeground)

                Spacer()

                Button {
                    withAnimation {
                        self.showingNewServerForm.toggle()
                    }
                } label: {
                    Image(systemName: self.showingNewServerForm ? "minus.circle" : "plus.circle")
                        .font(.system(size: 20))
                        .foregroundColor(Theme.Colors.primaryAccent)
                }
            }

            VStack(spacing: Theme.Spacing.small) {
                ForEach(self.profilesViewModel.profiles) { profile in
                    ServerProfileCard(
                        profile: profile,
                        isLoading: self.profilesViewModel.isLoading,
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

    // MARK: - New Connection Section

    private var newConnectionSection: some View {
        VStack(spacing: Theme.Spacing.large) {
            if !self.profilesViewModel.profiles.isEmpty {
                HStack {
                    Text("New Server Connection")
                        .font(Theme.Typography.terminalSystem(size: 18, weight: .semibold))
                        .foregroundColor(Theme.Colors.terminalForeground)

                    Spacer()
                }
            }

            ServerConfigForm(
                host: self.$viewModel.host,
                port: self.$viewModel.port,
                name: self.$viewModel.name,
                username: self.$viewModel.username,
                password: self.$viewModel.password,
                isConnecting: self.viewModel.isConnecting,
                errorMessage: self.viewModel.errorMessage,
                onConnect: self.saveAndConnect)

            if !self.profilesViewModel.profiles.isEmpty {
                Button {
                    withAnimation {
                        self.showingNewServerForm = false
                    }
                } label: {
                    Text("Cancel")
                        .font(Theme.Typography.terminalSystem(size: 16))
                        .foregroundColor(Theme.Colors.secondaryText)
                }
                .padding(.top, Theme.Spacing.small)
            }
        }
    }

    // MARK: - Actions

    private func connectToProfile(_ profile: ServerProfile) {
        guard self.networkMonitor.isConnected else {
            self.viewModel.errorMessage = "No internet connection available"
            return
        }

        Task {
            do {
                try await self.profilesViewModel.connectToProfile(profile)
                // Connection successful - no further action needed
            } catch _ as AuthenticationError {
                // Auto-login failed, show login modal for manual authentication
                self.viewModel.showLoginView = true
            } catch {
                // Network, server, or other errors
                self.viewModel.errorMessage = "Failed to connect: \(error.localizedDescription)"
            }
        }
    }

    private func saveAndConnect() {
        guard self.networkMonitor.isConnected else {
            self.viewModel.errorMessage = "No internet connection available"
            return
        }

        // Create profile from form data
        let urlString = self.viewModel.port.isEmpty ? self.viewModel.host : "\(self.viewModel.host):\(self.viewModel.port)"
        guard let profile = profilesViewModel.createProfileFromURL(urlString) else {
            self.viewModel.errorMessage = "Invalid server URL"
            return
        }

        var updatedProfile = profile
        updatedProfile.name = self.viewModel.name.isEmpty ? profile.name : self.viewModel.name
        updatedProfile.requiresAuth = !self.viewModel.password.isEmpty
        updatedProfile.username = updatedProfile
            .requiresAuth ? (self.viewModel.username.isEmpty ? "admin" : self.viewModel.username) : nil

        // Save profile and password
        Task {
            try await self.profilesViewModel.addProfile(updatedProfile, password: self.viewModel.password)

            // Connect
            self.connectToProfile(updatedProfile)
        }

        // Reset form
        self.viewModel = ConnectionViewModel()
        self.showingNewServerForm = false
    }
}

// MARK: - Server Profile Edit View

/// Form view for editing server profile details.
/// Allows modification of server name, URL, and authentication settings.
struct ServerProfileEditView: View {
    @State var profile: ServerProfile
    let onSave: (ServerProfile, String?) -> Void
    let onDelete: () -> Void

    @State private var password: String = ""
    @State private var showingDeleteConfirmation = false
    @Environment(\.dismiss)
    private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Server Details") {
                    HStack {
                        Text("Icon")
                        Spacer()
                        Image(systemName: self.profile.iconSymbol)
                            .font(.system(size: 24))
                            .foregroundColor(Theme.Colors.primaryAccent)
                    }

                    TextField("Name", text: self.$profile.name)
                    TextField("URL", text: self.$profile.url)

                    Toggle("Requires Authentication", isOn: self.$profile.requiresAuth)

                    if self.profile.requiresAuth {
                        TextField("Username", text: Binding(
                            get: { self.profile.username ?? "admin" },
                            set: { self.profile.username = $0 }))
                        SecureField("Password", text: self.$password)
                            .textContentType(.password)
                    }
                }

                Section {
                    Button(role: .destructive) {
                        self.showingDeleteConfirmation = true
                    } label: {
                        Label("Delete Server", systemImage: "trash")
                            .foregroundColor(.red)
                    }
                }
            }
            .navigationTitle("Edit Server")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") {
                        self.dismiss()
                    }
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Save") {
                        self.onSave(self.profile, self.profile.requiresAuth ? self.password : nil)
                        self.dismiss()
                    }
                    .fontWeight(.semibold)
                }
            }
            .alert("Delete Server?", isPresented: self.$showingDeleteConfirmation) {
                Button("Delete", role: .destructive) {
                    self.onDelete()
                    self.dismiss()
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Are you sure you want to delete \"\(self.profile.name)\"? This action cannot be undone.")
            }
        }
        .task {
            // Load existing password from keychain
            if self.profile.requiresAuth,
               let existingPassword = try? KeychainService().getPassword(for: profile.id)
            {
                self.password = existingPassword
            }
        }
    }
}

// MARK: - Preview

#Preview {
    EnhancedConnectionView()
        .environment(ConnectionManager.shared)
}
