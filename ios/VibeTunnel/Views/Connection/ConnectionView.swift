import SwiftUI

struct ConnectionView: View {
    @EnvironmentObject var connectionManager: ConnectionManager
    @StateObject private var viewModel = ConnectionViewModel()
    @State private var logoScale: CGFloat = 0.8
    @State private var contentOpacity: Double = 0
    
    var body: some View {
        NavigationView {
            ZStack {
                // Background
                Theme.Colors.terminalBackground
                    .ignoresSafeArea()
                
                // Content
                VStack(spacing: Theme.Spacing.xxl) {
                    // Logo and Title
                    VStack(spacing: Theme.Spacing.lg) {
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
                        
                        VStack(spacing: Theme.Spacing.sm) {
                            Text("VibeTunnel")
                                .font(.system(size: 42, weight: .bold, design: .rounded))
                                .foregroundColor(Theme.Colors.terminalForeground)
                            
                            Text("Terminal Multiplexer")
                                .font(Theme.Typography.terminalSystem(size: 16))
                                .foregroundColor(Theme.Colors.terminalForeground.opacity(0.7))
                                .tracking(2)
                        }
                    }
                    .padding(.top, 60)
                    
                    // Connection Form
                    ServerConfigForm(
                        host: $viewModel.host,
                        port: $viewModel.port,
                        name: $viewModel.name,
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
            .navigationBarHidden(true)
        }
        .navigationViewStyle(StackNavigationViewStyle())
        .preferredColorScheme(.dark)
        .onAppear {
            viewModel.loadLastConnection()
        }
    }
    
    private func connectToServer() {
        Task {
            await viewModel.testConnection { config in
                connectionManager.saveConnection(config)
                connectionManager.isConnected = true
            }
        }
    }
}

class ConnectionViewModel: ObservableObject {
    @Published var host: String = "127.0.0.1"
    @Published var port: String = "4020"
    @Published var name: String = ""
    @Published var isConnecting: Bool = false
    @Published var errorMessage: String?
    
    func loadLastConnection() {
        if let config = UserDefaults.standard.data(forKey: "savedServerConfig"),
           let serverConfig = try? JSONDecoder().decode(ServerConfig.self, from: config) {
            self.host = serverConfig.host
            self.port = String(serverConfig.port)
            self.name = serverConfig.name ?? ""
        }
    }
    
    @MainActor
    func testConnection(onSuccess: @escaping (ServerConfig) -> Void) async {
        errorMessage = nil
        
        guard !host.isEmpty else {
            errorMessage = "Please enter a server address"
            return
        }
        
        guard let portNumber = Int(port), portNumber > 0, portNumber <= 65535 else {
            errorMessage = "Please enter a valid port number"
            return
        }
        
        isConnecting = true
        
        let config = ServerConfig(
            host: host,
            port: portNumber,
            name: name.isEmpty ? nil : name
        )
        
        do {
            // Test connection by fetching sessions
            let url = config.baseURL.appendingPathComponent("api/sessions")
            let (_, response) = try await URLSession.shared.data(from: url)
            
            if let httpResponse = response as? HTTPURLResponse,
               httpResponse.statusCode == 200 {
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