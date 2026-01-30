import SwiftUI

/// Login view for authenticating with the VibeTunnel server
struct LoginView: View {
    @Environment(\.dismiss)
    private var dismiss

    @Binding var isPresented: Bool

    let serverConfig: ServerConfig
    let authenticationService: AuthenticationService
    let onSuccess: (String, String) -> Void // (username, password) -> Void

    @State private var username = ""
    @State private var password = ""
    @State private var isAuthenticating = false
    @State private var errorMessage: String?
    @State private var authConfig: AuthenticationService.AuthConfig?
    @FocusState private var focusedField: Field?

    private enum Field: Hashable {
        case username
        case password
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                // Server info
                VStack(spacing: 8) {
                    Image(systemName: "server.rack")
                        .font(.system(size: 48))
                        .foregroundStyle(.accent)

                    Text(self.serverConfig.displayName)
                        .font(.headline)
                        .foregroundStyle(.primary)

                    Text("Authentication Required")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .padding(.top, 24)

                // Login form
                VStack(spacing: 16) {
                    TextField("Username", text: self.$username)
                        .textFieldStyle(.roundedBorder)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused(self.$focusedField, equals: .username)
                        .onSubmit {
                            self.focusedField = .password
                        }

                    SecureField("Password", text: self.$password)
                        .textFieldStyle(.roundedBorder)
                        .focused(self.$focusedField, equals: .password)
                        .onSubmit {
                            self.authenticate()
                        }

                    if let error = errorMessage {
                        HStack {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundStyle(.red)
                            Text(error)
                                .font(.caption)
                                .foregroundStyle(.red)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding(.horizontal)

                // Action buttons
                HStack(spacing: 12) {
                    Button("Cancel") {
                        self.dismiss()
                        self.isPresented = false
                    }
                    .buttonStyle(.bordered)
                    .disabled(self.isAuthenticating)

                    Button(action: self.authenticate) {
                        if self.isAuthenticating {
                            ProgressView()
                                .progressViewStyle(CircularProgressViewStyle())
                                .scaleEffect(0.8)
                        } else {
                            Text("Login")
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(self.username.isEmpty || self.password.isEmpty || self.isAuthenticating)
                }
                .padding(.horizontal)

                Spacer()

                // Auth method info
                if let config = authConfig {
                    VStack(spacing: 4) {
                        if config.noAuth {
                            Label("No authentication required", systemImage: "checkmark.shield")
                                .font(.caption)
                                .foregroundStyle(.green)
                        } else {
                            if config.enableSSHKeys, !config.disallowUserPassword {
                                Text("Password or SSH key authentication")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            } else if config.disallowUserPassword {
                                Text("SSH key authentication only")
                                    .font(.caption)
                                    .foregroundStyle(.orange)
                            } else {
                                Text("Password authentication")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                    .padding()
                    .background(Color(.systemGray6))
                    .cornerRadius(8)
                    .padding(.horizontal)
                }
            }
            .navigationTitle("Login")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        self.dismiss()
                        self.isPresented = false
                    }
                    .disabled(self.isAuthenticating)
                }
            }
        }
        .interactiveDismissDisabled(self.isAuthenticating)
        .task {
            // Get current username
            do {
                self.username = try await self.authenticationService.getCurrentUsername()
            } catch {
                // If we can't get username, leave it empty
            }

            // Get auth configuration
            do {
                self.authConfig = try await self.authenticationService.getAuthConfig()

                // If no auth required, dismiss immediately
                if self.authConfig?.noAuth == true {
                    self.dismiss()
                    self.onSuccess("", "") // No credentials needed
                }
            } catch {
                // Continue with password auth
            }

            // Focus username field if empty, otherwise password
            if self.username.isEmpty {
                self.focusedField = .username
            } else {
                self.focusedField = .password
            }
        }
    }

    private func authenticate() {
        guard !self.username.isEmpty, !self.password.isEmpty else { return }

        Task { @MainActor in
            self.isAuthenticating = true
            self.errorMessage = nil

            do {
                try await self.authenticationService.authenticateWithPassword(
                    username: self.username,
                    password: self.password)

                // Success - dismiss and call completion with credentials
                self.dismiss()
                self.isPresented = false
                self.onSuccess(self.username, self.password)
            } catch {
                // Show error
                if let apiError = error as? APIError {
                    self.errorMessage = apiError.localizedDescription
                } else {
                    self.errorMessage = error.localizedDescription
                }

                // Clear password on error
                self.password = ""
                self.focusedField = .password
            }

            self.isAuthenticating = false
        }
    }
}

// MARK: - Preview

#if DEBUG
struct LoginView_Previews: PreviewProvider {
    static var previews: some View {
        LoginView(
            isPresented: .constant(true),
            serverConfig: ServerConfig(
                host: "localhost",
                port: 3000,
                name: "Test Server"),
            authenticationService: AuthenticationService(
                apiClient: APIClient.shared,
                serverConfig: ServerConfig(host: "localhost", port: 3000))) { _, _ in }
    }
}
#endif
