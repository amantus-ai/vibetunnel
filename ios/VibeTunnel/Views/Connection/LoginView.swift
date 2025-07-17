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

                    Text(serverConfig.displayName)
                        .font(.headline)
                        .foregroundStyle(.primary)

                    Text("Authentication Required")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .padding(.top, 24)

                // Login form
                VStack(spacing: 16) {
                    TextField("Username", text: $username)
                        .textFieldStyle(.roundedBorder)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($focusedField, equals: .username)
                        .onSubmit {
                            focusedField = .password
                        }

                    SecureField("Password", text: $password)
                        .textFieldStyle(.roundedBorder)
                        .focused($focusedField, equals: .password)
                        .onSubmit {
                            authenticate()
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
                        dismiss()
                        isPresented = false
                    }
                    .buttonStyle(.bordered)
                    .disabled(isAuthenticating)

                    Button(action: authenticate) {
                        if isAuthenticating {
                            ProgressView()
                                .progressViewStyle(CircularProgressViewStyle())
                                .scaleEffect(0.8)
                        } else {
                            Text("Login")
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(username.isEmpty || password.isEmpty || isAuthenticating)
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
                            if config.enableSSHKeys && !config.disallowUserPassword {
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
                        dismiss()
                        isPresented = false
                    }
                    .disabled(isAuthenticating)
                }
            }
        }
        .interactiveDismissDisabled(isAuthenticating)
        .task {
            // Get current username
            do {
                username = try await authenticationService.getCurrentUsername()
            } catch {
                // If we can't get username, leave it empty
            }

            // Get auth configuration
            do {
                authConfig = try await authenticationService.getAuthConfig()

                // If no auth required, dismiss immediately
                if authConfig?.noAuth == true {
                    dismiss()
                    onSuccess("", "") // No credentials needed
                }
            } catch {
                // Continue with password auth
            }

            // Focus username field if empty, otherwise password
            if username.isEmpty {
                focusedField = .username
            } else {
                focusedField = .password
            }
        }
    }

    private func authenticate() {
        guard !username.isEmpty && !password.isEmpty else { return }

        Task { @MainActor in
            isAuthenticating = true
            errorMessage = nil

            do {
                try await authenticationService.authenticateWithPassword(
                    username: username,
                    password: password
                )

                // Success - dismiss and call completion with credentials
                dismiss()
                isPresented = false
                onSuccess(username, password)
            } catch {
                // Show error
                if let apiError = error as? APIError {
                    errorMessage = apiError.localizedDescription
                } else {
                    errorMessage = error.localizedDescription
                }

                // Clear password on error
                password = ""
                focusedField = .password
            }

            isAuthenticating = false
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
                    port: 3_000,
                    name: "Test Server"
                ),
                authenticationService: AuthenticationService(
                    apiClient: APIClient.shared,
                    serverConfig: ServerConfig(host: "localhost", port: 3_000)
                )
            ) { _, _ in }
        }
    }
#endif
