import SwiftUI

struct AuthLoginView: View {
    @Environment(ConnectionManager.self) private var connectionManager
    @State private var selectedMethod = AuthMethod.password
    @State private var password = ""
    @State private var selectedSSHKeyId: String?
    @State private var passphrase = ""
    @State private var isLoading = false
    @State private var error: Error?
    @State private var showSSHKeyManager = false
    @State private var availableKeys: [SSHKey] = []
    
    let onSuccess: () -> Void
    let onCancel: () -> Void
    
    var body: some View {
        VStack(spacing: 20) {
            // Header
            VStack(spacing: 8) {
                Image(systemName: "lock.shield")
                    .font(.system(size: 48))
                    .foregroundStyle(Theme.Colors.accent)
                
                Text("Authentication Required")
                    .font(.title2)
                    .fontWeight(.semibold)
                
                if let serverURL = connectionManager.serverURL {
                    Text(serverURL.host() ?? "Server")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.bottom)
            
            // Method Selection
            Picker("Authentication Method", selection: $selectedMethod) {
                ForEach(AuthMethod.allCases, id: \.self) { method in
                    Text(method.displayName).tag(method)
                }
            }
            .pickerStyle(.segmented)
            .disabled(isLoading)
            
            // Authentication Form
            Group {
                switch selectedMethod {
                case .password:
                    passwordForm
                case .sshKey:
                    sshKeyForm
                case .none:
                    EmptyView()
                }
            }
            .disabled(isLoading)
            
            // Error Display
            if let error {
                ErrorView(error: error, onRetry: {})
                    .transition(.opacity.combined(with: .scale))
            }
            
            // Action Buttons
            HStack(spacing: 12) {
                Button("Cancel") {
                    onCancel()
                }
                .keyboardShortcut(.escape)
                
                Button("Connect") {
                    authenticate()
                }
                .keyboardShortcut(.return)
                .disabled(!canAuthenticate)
                .buttonStyle(.borderedProminent)
            }
            .controlSize(.large)
        }
        .padding(40)
        .frame(width: 450)
        .background(Theme.Colors.secondaryBackground)
        .task {
            if selectedMethod == .sshKey {
                await loadSSHKeys()
            }
        }
        .onChange(of: selectedMethod) { _, newValue in
            if newValue == .sshKey {
                Task {
                    await loadSSHKeys()
                }
            }
        }
        .sheet(isPresented: $showSSHKeyManager) {
            SSHKeyManagerView { key in
                selectedSSHKeyId = key.id
                showSSHKeyManager = false
            }
        }
    }
    
    private var passwordForm: some View {
        VStack(spacing: 16) {
            SecureField("Password", text: $password)
                .textFieldStyle(.roundedBorder)
                .controlSize(.large)
                .onSubmit {
                    authenticate()
                }
        }
    }
    
    private var sshKeyForm: some View {
        VStack(spacing: 16) {
            // SSH Key Selection
            HStack {
                Picker("SSH Key", selection: $selectedSSHKeyId) {
                    Text("Select a key...").tag(nil as String?)
                    ForEach(availableKeys) { key in
                        Text(key.displayName).tag(key.id as String?)
                    }
                }
                .pickerStyle(.menu)
                .disabled(availableKeys.isEmpty)
                
                Button("Manage Keys") {
                    showSSHKeyManager = true
                }
            }
            
            // Passphrase if key is selected
            if selectedSSHKeyId != nil {
                SecureField("Passphrase (if needed)", text: $passphrase)
                    .textFieldStyle(.roundedBorder)
                    .controlSize(.large)
                    .onSubmit {
                        authenticate()
                    }
            }
            
            if availableKeys.isEmpty && !isLoading {
                Text("No SSH keys available. Add a key to continue.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
    
    private var canAuthenticate: Bool {
        switch selectedMethod {
        case .password:
            return !password.isEmpty
        case .sshKey:
            return selectedSSHKeyId != nil
        case .none:
            return true
        }
    }
    
    private func authenticate() {
        guard canAuthenticate else { return }
        
        Task {
            isLoading = true
            error = nil
            
            do {
                let credentials: String
                switch selectedMethod {
                case .password:
                    credentials = password
                case .sshKey:
                    guard let keyId = selectedSSHKeyId else { return }
                    // Format: keyId:passphrase
                    credentials = passphrase.isEmpty ? keyId : "\(keyId):\(passphrase)"
                case .none:
                    credentials = ""
                }
                
                guard let serverURL = connectionManager.serverURL else {
                    throw APIError.notConnected
                }
                
                try await AuthService.shared.login(
                    serverURL: serverURL,
                    method: selectedMethod,
                    credentials: credentials
                )
                
                // Update connection manager with auth
                connectionManager.authHeader = AuthService.shared.getAuthHeader()
                
                onSuccess()
            } catch {
                self.error = error
                if selectedMethod == .password {
                    password = ""
                } else if selectedMethod == .sshKey {
                    passphrase = ""
                }
            }
            
            isLoading = false
        }
    }
    
    private func loadSSHKeys() async {
        do {
            availableKeys = try await AuthService.shared.fetchSSHKeys()
            if availableKeys.count == 1 {
                selectedSSHKeyId = availableKeys.first?.id
            }
        } catch {
            // Keys might not be available without auth
            availableKeys = []
        }
    }
}

#Preview {
    AuthLoginView(
        onSuccess: { print("Success") },
        onCancel: { print("Cancel") }
    )
    .environment(ConnectionManager.shared)
}