import Observation
import SwiftUI

/// View for establishing connection to a VibeTunnel server.
///
/// Displays the app branding and provides interface for entering
/// server connection details with saved server management.
struct ConnectionView: View {
    @Environment(ConnectionManager.self)
    var connectionManager
    @State private var networkMonitor = NetworkMonitor.shared
    @State private var viewModel = ConnectionViewModel()
    @State private var logoScale: CGFloat = 0.8
    @State private var contentOpacity: Double = 0

    var body: some View {
        NavigationStack {
            ScrollView {
                // Content
                VStack(spacing: Theme.Spacing.extraExtraLarge) {
                    // Logo and Title
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
                    .padding(.top, 60)

                    // Connection Form
                    ServerConfigForm(
                        host: $viewModel.host,
                        port: $viewModel.port,
                        name: $viewModel.name,
                        password: $viewModel.password,
                        isConnecting: viewModel.isConnecting,
                        errorMessage: viewModel.errorMessage,
                        onConnect: connectToServer
                    )
                    .opacity(contentOpacity)
                    .onAppear {
                        withAnimation(Theme.Animation.smooth.delay(0.3)) {
                            contentOpacity = 1.0
                        }
                    }

                    Spacer()
                }
                .padding()
            }
            .scrollBounceBehavior(.basedOnSize)
            .toolbar(.hidden, for: .navigationBar)
            .background {
                // Background
                Theme.Colors.terminalBackground
                    .ignoresSafeArea()
            }
        }
        .navigationViewStyle(StackNavigationViewStyle())
        .preferredColorScheme(.dark)
        .onAppear {
            viewModel.loadLastConnection()
        }
    }

    private func connectToServer() {
        guard networkMonitor.isConnected else {
            viewModel.errorMessage = "No internet connection available"
            return
        }

        Task {
            await viewModel.testConnection { config in
                connectionManager.saveConnection(config)
                connectionManager.isConnected = true
            }
        }
    }
}

/// View model for managing connection form state and validation.
@Observable
class ConnectionViewModel {
    var host: String = "127.0.0.1"
    var port: String = "4020"
    var name: String = ""
    var password: String = ""
    var isConnecting: Bool = false
    var errorMessage: String?

    func loadLastConnection() {
        if let config = UserDefaults.standard.data(forKey: "savedServerConfig"),
           let serverConfig = try? JSONDecoder().decode(ServerConfig.self, from: config)
        {
            self.host = serverConfig.host
            self.port = String(serverConfig.port)
            self.name = serverConfig.name ?? ""
            self.password = serverConfig.password ?? ""
        }
    }

    @MainActor
    func testConnection(onSuccess: @escaping (ServerConfig) -> Void) async {
        errorMessage = nil

        guard !host.isEmpty else {
            errorMessage = "Please enter a server address"
            return
        }

        guard let portNumber = Int(port), portNumber > 0, portNumber <= 65_535 else {
            errorMessage = "Please enter a valid port number"
            return
        }

        isConnecting = true

        let config = ServerConfig(
            host: host,
            port: portNumber,
            name: name.isEmpty ? nil : name,
            password: password.isEmpty ? nil : password
        )

        do {
            // Test connection by fetching sessions
            let url = config.baseURL.appendingPathComponent("api/sessions")
            var request = URLRequest(url: url)
            if let authHeader = config.authorizationHeader {
                request.setValue(authHeader, forHTTPHeaderField: "Authorization")
            }
            let (_, response) = try await URLSession.shared.data(for: request)

            if let httpResponse = response as? HTTPURLResponse,
               httpResponse.statusCode == 200
            {
                onSuccess(config)
            } else {
                errorMessage = "Failed to connect to server"
            }
        } catch {
            errorMessage = "Connection failed: \(error.localizedDescription)"
        }

        isConnecting = false
    }
}
