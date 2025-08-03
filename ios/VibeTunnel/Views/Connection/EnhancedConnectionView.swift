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
                        headerView
                            .padding(.top, {
                                #if targetEnvironment(macCatalyst)
                                    return windowManager.windowStyle == .inline ? 60 : 40
                                #else
                                    return 40
                                #endif
                            }())

                        // Quick Connect Section
                        if !profilesViewModel.profiles.isEmpty && !showingNewServerForm {
                            quickConnectSection
                                .opacity(contentOpacity)
                                .onAppear {
                                    withAnimation(Theme.Animation.smooth.delay(0.3)) {
                                        contentOpacity = 1.0
                                    }
                                }
                        }

                        // New Connection Form
                        if showingNewServerForm || profilesViewModel.profiles.isEmpty {
                            newConnectionSection
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
                            try await profilesViewModel.updateProfile(updatedProfile, password: password)
                            selectedProfile = nil
                        }
                    },
                    onDelete: {
                        Task {
                            try await profilesViewModel.deleteProfile(profile)
                            selectedProfile = nil
                        }
                    }
                )
            }
            .sheet(isPresented: $viewModel.showLoginView) {
                if let config = connectionManager.serverConfig,
                   let authService = connectionManager.authenticationService
                {
                    LoginView(
                        isPresented: $viewModel.showLoginView,
                        serverConfig: config,
                        authenticationService: authService
                    ) { _, _ in
                        // Authentication successful, mark as connected
                        connectionManager.isConnected = true
                    }
                }
            }
        }
        .navigationViewStyle(StackNavigationViewStyle())
        .onAppear {
            profilesViewModel.loadProfiles()
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
                        showingNewServerForm.toggle()
                    }
                } label: {
                    Image(systemName: showingNewServerForm ? "minus.circle" : "plus.circle")
                        .font(.system(size: 20))
                        .foregroundColor(Theme.Colors.primaryAccent)
                }
            }

            VStack(spacing: Theme.Spacing.small) {
                ForEach(profilesViewModel.profiles) { profile in
                    ServerProfileCard(
                        profile: profile,
                        isLoading: profilesViewModel.isLoading,
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

    // MARK: - New Connection Section

    private var newConnectionSection: some View {
        VStack(spacing: Theme.Spacing.large) {
            if !profilesViewModel.profiles.isEmpty {
                HStack {
                    Text("New Server Connection")
                        .font(Theme.Typography.terminalSystem(size: 18, weight: .semibold))
                        .foregroundColor(Theme.Colors.terminalForeground)

                    Spacer()
                }
            }

            ServerConfigForm(
                host: $viewModel.host,
                port: $viewModel.port,
                name: $viewModel.name,
                username: $viewModel.username,
                password: $viewModel.password,
                isConnecting: viewModel.isConnecting,
                errorMessage: viewModel.errorMessage,
                onConnect: saveAndConnect
            )

            if !profilesViewModel.profiles.isEmpty {
                Button {
                    withAnimation {
                        showingNewServerForm = false
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
        guard networkMonitor.isConnected else {
            viewModel.errorMessage = "No internet connection available"
            return
        }

        Task {
            do {
                try await profilesViewModel.connectToProfile(profile)
                // Connection successful - no further action needed
            } catch _ as AuthenticationError {
                // Auto-login failed, show login modal for manual authentication
                viewModel.showLoginView = true
            } catch {
                // Network, server, or other errors
                viewModel.errorMessage = "Failed to connect: \(error.localizedDescription)"
            }
        }
    }

    private func saveAndConnect() {
        guard networkMonitor.isConnected else {
            viewModel.errorMessage = "No internet connection available"
            return
        }

        // Create profile from form data
        let urlString = viewModel.port.isEmpty ? viewModel.host : "\(viewModel.host):\(viewModel.port)"
        guard let profile = profilesViewModel.createProfileFromURL(urlString) else {
            viewModel.errorMessage = "Invalid server URL"
            return
        }

        var updatedProfile = profile
        updatedProfile.name = viewModel.name.isEmpty ? profile.name : viewModel.name
        updatedProfile.requiresAuth = !viewModel.password.isEmpty
        updatedProfile.username = updatedProfile
            .requiresAuth ? (viewModel.username.isEmpty ? "admin" : viewModel.username) : nil

        // Save profile and password
        Task {
            try await profilesViewModel.addProfile(updatedProfile, password: viewModel.password)

            // Connect
            connectToProfile(updatedProfile)
        }

        // Reset form
        viewModel = ConnectionViewModel()
        showingNewServerForm = false
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
                        Image(systemName: profile.iconSymbol)
                            .font(.system(size: 24))
                            .foregroundColor(Theme.Colors.primaryAccent)
                    }

                    TextField("Name", text: $profile.name)
                    TextField("URL", text: $profile.url)

                    Toggle("Requires Authentication", isOn: $profile.requiresAuth)

                    if profile.requiresAuth {
                        TextField("Username", text: Binding(
                            get: { profile.username ?? "admin" },
                            set: { profile.username = $0 }
                        ))
                        SecureField("Password", text: $password)
                            .textContentType(.password)
                    }
                }

                Section {
                    Button(role: .destructive) {
                        showingDeleteConfirmation = true
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
                        dismiss()
                    }
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Save") {
                        onSave(profile, profile.requiresAuth ? password : nil)
                        dismiss()
                    }
                    .fontWeight(.semibold)
                }
            }
            .alert("Delete Server?", isPresented: $showingDeleteConfirmation) {
                Button("Delete", role: .destructive) {
                    onDelete()
                    dismiss()
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Are you sure you want to delete \"\(profile.name)\"? This action cannot be undone.")
            }
        }
        .task {
            // Load existing password from keychain
            if profile.requiresAuth,
               let existingPassword = try? KeychainService().getPassword(for: profile.id)
            {
                password = existingPassword
            }
        }
    }
}

// MARK: - Preview

#Preview {
    EnhancedConnectionView()
        .environment(ConnectionManager.shared)
}
