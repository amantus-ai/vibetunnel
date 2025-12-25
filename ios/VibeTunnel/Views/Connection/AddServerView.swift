import SwiftUI

/// View for adding a new server connection
struct AddServerView: View {
    @Environment(ConnectionManager.self)
    var connectionManager

    @Environment(\.dismiss)
    private var dismiss

    @State private var networkMonitor = NetworkMonitor.shared
    @State private var viewModel: ConnectionViewModel

    private let profileLogger = Logger(category: "AddServer.Profile")
    private let authLogger = Logger(category: "AddServer.Authentication")
    private let keychainLogger = Logger(category: "AddServer.Keychain")

    let onServerAdded: (ServerProfile) -> Void

    init(
        initialHost: String? = nil,
        initialPort: String? = nil,
        initialName: String? = nil,
        onServerAdded: @escaping (ServerProfile) -> Void)
    {
        // Initialize the view model with initial values
        let vm = ConnectionViewModel()
        if let host = initialHost {
            vm.host = host
        }
        if let port = initialPort {
            vm.port = port
        }
        if let name = initialName {
            vm.name = name
        }
        _viewModel = State(initialValue: vm)
        self.onServerAdded = onServerAdded
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: Theme.Spacing.extraLarge) {
                    // Header
                    VStack(spacing: Theme.Spacing.medium) {
                        Image(systemName: "plus.circle.fill")
                            .font(.system(size: 60))
                            .foregroundColor(Theme.Colors.primaryAccent)

                        Text("Add New Server")
                            .font(.title2)
                            .fontWeight(.semibold)
                            .foregroundColor(Theme.Colors.terminalForeground)

                        Text("Enter your server details to create a new connection")
                            .font(.body)
                            .foregroundColor(Theme.Colors.secondaryText)
                            .multilineTextAlignment(.center)
                    }
                    .padding(.top, Theme.Spacing.large)

                    // Server Configuration Form
                    ServerConfigForm(
                        host: self.$viewModel.host,
                        port: self.$viewModel.port,
                        name: self.$viewModel.name,
                        username: self.$viewModel.username,
                        password: self.$viewModel.password,
                        isConnecting: self.viewModel.isConnecting,
                        errorMessage: self.viewModel.errorMessage,
                        onConnect: self.saveServer)

                    Spacer(minLength: 50)
                }
                .padding()
            }
            .scrollBounceBehavior(.basedOnSize)
            .navigationTitle("New Server")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") {
                        self.dismiss()
                    }
                }
            }
            .background(Theme.Colors.terminalBackground.ignoresSafeArea())
            .sheet(isPresented: self.$viewModel.showLoginView) {
                if let config = viewModel.pendingServerConfig,
                   let authService = connectionManager.authenticationService
                {
                    LoginView(
                        isPresented: self.$viewModel.showLoginView,
                        serverConfig: config,
                        authenticationService: authService)
                    { _, _ in
                        // Authentication successful, mark as connected
                        self.connectionManager.isConnected = true
                        self.dismiss()
                    }
                }
            }
        }
    }

    private func saveServer() {
        guard self.networkMonitor.isConnected else {
            self.viewModel.errorMessage = "No internet connection available"
            return
        }

        // Create profile from form data
        let hostWithPort = self.viewModel.port.isEmpty ? self.viewModel.host : "\(self.viewModel.host):\(self.viewModel.port)"

        // Add http:// scheme if not present
        let urlString: String = if hostWithPort.hasPrefix("http://") || hostWithPort.hasPrefix("https://") {
            hostWithPort
        } else {
            "http://\(hostWithPort)"
        }

        // Basic URL validation
        guard !self.viewModel.host.isEmpty else {
            self.viewModel.errorMessage = "Please enter a server address"
            return
        }

        // Validate port if provided
        if !self.viewModel.port.isEmpty {
            guard let portNumber = Int(viewModel.port), portNumber > 0, portNumber <= 65535 else {
                self.viewModel.errorMessage = "Invalid port number. Must be between 1 and 65535."
                return
            }
        }

        // Create a temporary profile to validate URL format
        let tempProfile = ServerProfile(
            name: viewModel.name.isEmpty ? ServerProfile.suggestedName(for: urlString) : self.viewModel.name,
            url: urlString,
            requiresAuth: !self.viewModel.password.isEmpty,
            username: self.viewModel.username.isEmpty ? nil : self.viewModel.username)

        guard tempProfile.toServerConfig() != nil else {
            self.viewModel.errorMessage = "Invalid server URL format. Please check the address and port."
            return
        }

        // Create final profile
        var profile = tempProfile
        profile.requiresAuth = !self.viewModel.password.isEmpty
        profile.username = profile
            .requiresAuth ? (self.viewModel.username.isEmpty ? "admin" : self.viewModel.username) : nil

        // Save profile with password if provided
        Task {
            do {
                self.profileLogger.info("💾 Saving server profile: \(profile.name) (id: \(profile.id))")
                self.authLogger
                    .debug(
                        "💾 requiresAuth: \(profile.requiresAuth), password empty: \(self.viewModel.password.isEmpty)")
                self.authLogger.debug("💾 username: \(profile.username ?? "nil")")

                if profile.requiresAuth, !self.viewModel.password.isEmpty {
                    self.keychainLogger.info("💾 Saving password to keychain for profile id: \(profile.id)")
                    try KeychainService().savePassword(self.viewModel.password, for: profile.id)
                    self.keychainLogger.info("💾 Password saved successfully")
                } else {
                    self.authLogger.debug(
                        "💾 Skipping password save - requiresAuth: \(profile.requiresAuth), password empty: \(self.viewModel.password.isEmpty)")
                }

                // Save profile
                ServerProfile.save(profile)
                self.profileLogger.info("💾 Profile saved successfully")

                // Notify parent and dismiss
                self.onServerAdded(profile)
                self.dismiss()
            } catch {
                self.profileLogger.error("💾 Failed to save server: \(error)")
                self.viewModel.errorMessage = "Failed to save server: \(error.localizedDescription)"
            }
        }
    }
}

#Preview {
    AddServerView { _ in }
        .environment(ConnectionManager.shared)
}
