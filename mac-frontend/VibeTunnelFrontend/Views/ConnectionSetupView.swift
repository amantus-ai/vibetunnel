import SwiftUI

struct ConnectionSetupView: View {
    @Environment(ConnectionManager.self)
    private var connectionManager
    @State private var serverURLString = ""
    @State private var authHeader = ""
    @State private var showAuthField = false
    @FocusState private var isURLFieldFocused: Bool
    
    var body: some View {
        VStack(spacing: Theme.Spacing.xl) {
            Image(systemName: "server.rack")
                .font(.system(size: 64))
                .foregroundStyle(Theme.Colors.accent)
                .symbolRenderingMode(.hierarchical)
            
            VStack(spacing: Theme.Spacing.sm) {
                Text("Connect to VibeTunnel Server")
                    .font(Theme.Typography.title)
                
                Text("Enter the URL of your VibeTunnel server to get started")
                    .font(Theme.Typography.body)
                    .foregroundStyle(Theme.Colors.secondaryText)
                    .multilineTextAlignment(.center)
            }
            
            VStack(spacing: Theme.Spacing.md) {
                VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                    Text("Server URL")
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Colors.secondaryText)
                    
                    HStack {
                        TextField("http://localhost:4020", text: $serverURLString)
                            .textFieldStyle(.roundedBorder)
                            .focused($isURLFieldFocused)
                            .onSubmit {
                                connect()
                            }
                        
                        Button {
                            showAuthField.toggle()
                        } label: {
                            Image(systemName: showAuthField ? "lock.fill" : "lock")
                                .foregroundStyle(showAuthField ? Theme.Colors.accent : Theme.Colors.secondaryText)
                        }
                        .buttonStyle(.plain)
                        .help("Toggle authentication")
                    }
                }
                
                if showAuthField {
                    VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                        Text("Authorization Header")
                            .font(Theme.Typography.caption)
                            .foregroundStyle(Theme.Colors.secondaryText)
                        
                        SecureField("Bearer token...", text: $authHeader)
                            .textFieldStyle(.roundedBorder)
                            .onSubmit {
                                connect()
                            }
                    }
                    .transition(.move(edge: .top).combined(with: .opacity))
                }
                
                if let error = connectionManager.error {
                    HStack {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(Theme.Colors.error)
                        
                        Text(error.localizedDescription)
                            .font(Theme.Typography.caption)
                            .foregroundStyle(Theme.Colors.error)
                        
                        Spacer()
                    }
                    .padding(Theme.Spacing.sm)
                    .background(Theme.Colors.error.opacity(0.1))
                    .cornerRadius(Theme.Sizes.cornerRadius)
                }
                
                Button {
                    connect()
                } label: {
                    if connectionManager.isConnecting {
                        ProgressView()
                            .progressViewStyle(.circular)
                            .scaleEffect(0.8)
                    } else {
                        Text("Connect")
                    }
                }
                .primaryButtonStyle()
                .disabled(serverURLString.isEmpty || connectionManager.isConnecting)
                .keyboardShortcut(.return, modifiers: .command)
            }
            .frame(maxWidth: 400)
            
            VStack(spacing: Theme.Spacing.xs) {
                Text("Local Development")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Colors.tertiaryText)
                
                HStack(spacing: Theme.Spacing.sm) {
                    Button("localhost:4020") {
                        quickConnect(to: "http://localhost:4020")
                    }
                    .secondaryButtonStyle()
                    
                    Button("localhost:4020") {
                        quickConnect(to: "http://localhost:4020")
                    }
                    .secondaryButtonStyle()
                    
                    Button("localhost:3033") {
                        quickConnect(to: "http://localhost:3033")
                    }
                    .secondaryButtonStyle()
                }
            }
        }
        .padding(Theme.Spacing.xxl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.Colors.background)
        .animation(Theme.Animation.standard, value: showAuthField)
        .onAppear {
            isURLFieldFocused = true
        }
    }
    
    private func connect() {
        guard !serverURLString.isEmpty else { return }
        
        // Clean up the URL string
        var cleanedURL = serverURLString.trimmingCharacters(in: .whitespacesAndNewlines)
        
        // Add http:// if no protocol is specified
        if !cleanedURL.lowercased().hasPrefix("http://") && !cleanedURL.lowercased().hasPrefix("https://") {
            cleanedURL = "http://" + cleanedURL
        }
        
        // Try to create URL
        guard let url = URL(string: cleanedURL) else {
            connectionManager.error = ConnectionError.invalidResponse
            return
        }
        
        Task {
            do {
                let authValue = authHeader.isEmpty ? nil : authHeader
                try await connectionManager.connect(to: url, authHeader: authValue)
            } catch {
                // Error is already set in ConnectionManager
            }
        }
    }
    
    private func quickConnect(to urlString: String) {
        serverURLString = urlString
        connect()
    }
}

#Preview {
    ConnectionSetupView()
        .environment(ConnectionManager())
        .frame(width: 800, height: 600)
}
