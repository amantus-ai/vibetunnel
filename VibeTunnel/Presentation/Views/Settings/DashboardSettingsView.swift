import AppKit
import os.log
import SwiftUI

/// Dashboard settings tab for server and access configuration
struct DashboardSettingsView: View {
    @AppStorage("serverPort")
    private var serverPort = "4020"
    @AppStorage("ngrokEnabled")
    private var ngrokEnabled = false
    @AppStorage("dashboardPasswordEnabled")
    private var passwordEnabled = false
    @AppStorage("ngrokTokenPresent")
    private var ngrokTokenPresent = false
    @AppStorage("dashboardAccessMode")
    private var accessModeString = DashboardAccessMode.localhost.rawValue

    @State private var password = ""
    @State private var confirmPassword = ""
    @State private var showPasswordFields = false
    @State private var passwordError: String?
    @State private var passwordSaved = false

    @StateObject private var permissionManager = AppleScriptPermissionManager.shared

    @State private var ngrokAuthToken = ""
    @State private var ngrokStatus: NgrokTunnelStatus?
    @State private var isStartingNgrok = false
    @State private var ngrokError: String?
    @State private var showingAuthTokenAlert = false
    @State private var showingKeychainAlert = false
    @State private var showingServerErrorAlert = false
    @State private var serverErrorMessage = ""
    @State private var isTokenRevealed = false
    @State private var maskedToken = ""
    @State private var localIPAddress: String?

    private let dashboardKeychain = DashboardKeychain.shared
    private let ngrokService = NgrokService.shared
    private let logger = Logger(subsystem: "com.steipete.VibeTunnel", category: "DashboardSettings")

    private var accessMode: DashboardAccessMode {
        DashboardAccessMode(rawValue: accessModeString) ?? .localhost
    }

    var body: some View {
        NavigationStack {
            Form {
                SecuritySection(
                    passwordEnabled: $passwordEnabled,
                    password: $password,
                    confirmPassword: $confirmPassword,
                    showPasswordFields: $showPasswordFields,
                    passwordError: $passwordError,
                    passwordSaved: $passwordSaved,
                    dashboardKeychain: dashboardKeychain,
                    savePassword: savePassword
                )

                ServerConfigurationSection(
                    accessMode: accessMode,
                    accessModeString: $accessModeString,
                    serverPort: $serverPort,
                    localIPAddress: localIPAddress,
                    restartServerWithNewBindAddress: restartServerWithNewBindAddress,
                    restartServerWithNewPort: restartServerWithNewPort
                )

                NgrokIntegrationSection(
                    ngrokEnabled: $ngrokEnabled,
                    ngrokAuthToken: $ngrokAuthToken,
                    ngrokTokenPresent: $ngrokTokenPresent,
                    isTokenRevealed: $isTokenRevealed,
                    maskedToken: $maskedToken,
                    isStartingNgrok: isStartingNgrok,
                    ngrokError: ngrokError,
                    ngrokService: ngrokService,
                    checkAndStartNgrok: checkAndStartNgrok,
                    stopNgrok: stopNgrok,
                    toggleTokenVisibility: toggleTokenVisibility
                )
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
            .navigationTitle("Dashboard Settings")
        }
        .onAppear {
            onAppearSetup()
        }
        .onChange(of: accessMode) { _, _ in
            updateLocalIPAddress()
        }
        .alert("ngrok Auth Token Required", isPresented: $showingAuthTokenAlert) {
            Button("OK") {}
        } message: {
            Text(
                "Please enter your ngrok auth token before enabling the tunnel. You can get a free auth token at ngrok.com"
            )
        }
        .alert("Keychain Access Error", isPresented: $showingKeychainAlert) {
            Button("OK") {}
        } message: {
            Text("Failed to save the auth token to the keychain. Please check your keychain permissions and try again.")
        }
        .alert("Failed to Restart Server", isPresented: $showingServerErrorAlert) {
            Button("OK") {}
        } message: {
            Text(serverErrorMessage)
        }
    }

    // MARK: - Private Methods

    private func onAppearSetup() {
        // Check password status
        if dashboardKeychain.hasPassword() {
            passwordSaved = true
            passwordEnabled = true
        }

        // Check if token exists without triggering keychain
        if ngrokService.hasAuthToken && !ngrokTokenPresent {
            ngrokTokenPresent = true
        }

        // Update masked field based on token presence
        if ngrokTokenPresent && !isTokenRevealed {
            maskedToken = String(repeating: "•", count: 12)
        }

        // Get local IP address
        updateLocalIPAddress()
    }

    private func savePassword() {
        passwordError = nil

        guard !password.isEmpty else {
            passwordError = "Password cannot be empty"
            return
        }

        guard password == confirmPassword else {
            passwordError = "Passwords do not match"
            return
        }

        guard password.count >= 4 else {
            passwordError = "Password must be at least 4 characters"
            return
        }

        if dashboardKeychain.setPassword(password) {
            passwordSaved = true
            showPasswordFields = false
            password = ""
            confirmPassword = ""

            // Clear cached password in LazyBasicAuthMiddleware
            Task {
                await ServerManager.shared.clearAuthCache()
            }

            // When password is set for the first time, automatically switch to network mode
            if accessMode == .localhost {
                accessModeString = DashboardAccessMode.network.rawValue
                restartServerWithNewBindAddress()
            }
        } else {
            passwordError = "Failed to save password to keychain"
        }
    }

    private func restartServerWithNewPort(_ port: Int) {
        Task {
            // Update the port in ServerManager and restart
            ServerManager.shared.port = String(port)
            await ServerManager.shared.restart()
            logger.info("Server restarted on port \(port)")

            // Wait for server to be fully ready before restarting session monitor
            try? await Task.sleep(for: .seconds(1))

            // Restart session monitoring with new port
            SessionMonitor.shared.stopMonitoring()
            SessionMonitor.shared.startMonitoring()
        }
    }

    private func restartServerWithNewBindAddress() {
        Task {
            // Update the bind address in ServerManager and restart
            ServerManager.shared.bindAddress = accessMode.bindAddress
            await ServerManager.shared.restart()
            logger.info("Server restarted with bind address \(accessMode.bindAddress)")

            // Wait for server to be fully ready before restarting session monitor
            try? await Task.sleep(for: .seconds(1))

            // Restart session monitoring
            SessionMonitor.shared.stopMonitoring()
            SessionMonitor.shared.startMonitoring()
        }
    }

    private func checkAndStartNgrok() {
        logger.debug("checkAndStartNgrok called")

        // Check if we have a token in the keychain without accessing it
        guard ngrokTokenPresent || ngrokService.hasAuthToken else {
            logger.debug("No auth token stored")
            ngrokError = "Please enter your ngrok auth token first"
            ngrokEnabled = false
            showingAuthTokenAlert = true
            return
        }

        // If token hasn't been revealed yet, we need to access it from keychain
        if !isTokenRevealed && ngrokAuthToken.isEmpty {
            // This will trigger keychain access
            if let token = ngrokService.authToken {
                ngrokAuthToken = token
                logger.debug("Retrieved token from keychain for ngrok start")
            } else {
                logger.error("Failed to retrieve token from keychain")
                ngrokError = "Failed to access auth token. Please try again."
                ngrokEnabled = false
                showingKeychainAlert = true
                return
            }
        }

        logger.debug("Starting ngrok with auth token present")
        isStartingNgrok = true
        ngrokError = nil

        Task {
            do {
                let port = Int(serverPort) ?? 4_020
                logger.info("Starting ngrok on port \(port)")
                _ = try await ngrokService.start(port: port)
                isStartingNgrok = false
                ngrokStatus = await ngrokService.getStatus()
                logger.info("ngrok started successfully")
            } catch {
                logger.error("ngrok start error: \(error)")
                isStartingNgrok = false
                ngrokError = error.localizedDescription
                ngrokEnabled = false
            }
        }
    }

    private func stopNgrok() {
        Task {
            try? await ngrokService.stop()
            ngrokStatus = nil
            // Don't clear the error here - let it remain visible
        }
    }

    private func toggleTokenVisibility() {
        if isTokenRevealed {
            // Hide the token
            isTokenRevealed = false
            ngrokAuthToken = ""
            if ngrokTokenPresent {
                maskedToken = String(repeating: "•", count: 12)
            }
        } else {
            // Reveal the token - this will trigger keychain access
            if let token = ngrokService.authToken {
                ngrokAuthToken = token
                isTokenRevealed = true
            } else {
                // No token stored, just reveal the empty field
                ngrokAuthToken = ""
                isTokenRevealed = true
            }
        }
    }

    private func updateLocalIPAddress() {
        Task {
            if accessMode == .network {
                localIPAddress = NetworkUtility.getLocalIPAddress()
            } else {
                localIPAddress = nil
            }
        }
    }
}

// MARK: - Security Section

private struct SecuritySection: View {
    @Binding var passwordEnabled: Bool
    @Binding var password: String
    @Binding var confirmPassword: String
    @Binding var showPasswordFields: Bool
    @Binding var passwordError: String?
    @Binding var passwordSaved: Bool
    let dashboardKeychain: DashboardKeychain
    let savePassword: () -> Void

    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: 12) {
                Toggle("Password protect dashboard", isOn: $passwordEnabled)
                    .onChange(of: passwordEnabled) { _, newValue in
                        if newValue && !dashboardKeychain.hasPassword() {
                            showPasswordFields = true
                        } else if !newValue {
                            // Clear password when disabled
                            _ = dashboardKeychain.deletePassword()
                            showPasswordFields = false
                            passwordSaved = false
                            // Clear cached password in LazyBasicAuthMiddleware
                            Task {
                                await ServerManager.shared.clearAuthCache()
                            }
                        }
                    }

                Text("Require a password to access the dashboard from remote connections.")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                if showPasswordFields || (passwordEnabled && !passwordSaved) {
                    PasswordFieldsView(
                        password: $password,
                        confirmPassword: $confirmPassword,
                        passwordError: $passwordError,
                        showPasswordFields: $showPasswordFields,
                        passwordEnabled: $passwordEnabled,
                        savePassword: savePassword
                    )
                }

                if passwordSaved {
                    SavedPasswordView(
                        showPasswordFields: $showPasswordFields,
                        passwordSaved: $passwordSaved,
                        password: $password,
                        confirmPassword: $confirmPassword
                    )
                }
            }
        } header: {
            Text("Security")
                .font(.headline)
        } footer: {
            Text("Localhost always accessible without password. Username is ignored in remote connections.")
                .font(.caption)
                .frame(maxWidth: .infinity)
                .multilineTextAlignment(.center)
        }
    }
}

// MARK: - Password Fields View

private struct PasswordFieldsView: View {
    @Binding var password: String
    @Binding var confirmPassword: String
    @Binding var passwordError: String?
    @Binding var showPasswordFields: Bool
    @Binding var passwordEnabled: Bool
    let savePassword: () -> Void

    var body: some View {
        VStack(spacing: 8) {
            SecureField("Password", text: $password)
                .textFieldStyle(.roundedBorder)
            SecureField("Confirm Password", text: $confirmPassword)
                .textFieldStyle(.roundedBorder)

            if let error = passwordError {
                Text(error)
                    .font(.caption)
                    .foregroundColor(.red)
            }

            HStack {
                Button("Cancel") {
                    showPasswordFields = false
                    passwordEnabled = false
                    password = ""
                    confirmPassword = ""
                    passwordError = nil
                }
                .buttonStyle(.bordered)

                Button("Save Password") {
                    savePassword()
                }
                .buttonStyle(.borderedProminent)
                .disabled(password.isEmpty)
            }
        }
        .padding(.top, 4)
    }
}

// MARK: - Saved Password View

private struct SavedPasswordView: View {
    @Binding var showPasswordFields: Bool
    @Binding var passwordSaved: Bool
    @Binding var password: String
    @Binding var confirmPassword: String

    var body: some View {
        HStack {
            Image(systemName: "checkmark.circle.fill")
                .foregroundColor(.green)
            Text("Password saved")
                .font(.caption)
            Spacer()
            Button("Remove Password") {
                showPasswordFields = true
                passwordSaved = false
                password = ""
                confirmPassword = ""
            }
            .buttonStyle(.link)
            .font(.caption)
        }
    }
}

// MARK: - Server Configuration Section

private struct ServerConfigurationSection: View {
    let accessMode: DashboardAccessMode
    @Binding var accessModeString: String
    @Binding var serverPort: String
    let localIPAddress: String?
    let restartServerWithNewBindAddress: () -> Void
    let restartServerWithNewPort: (Int) -> Void

    var body: some View {
        Section {
            AccessModeView(
                accessMode: accessMode,
                accessModeString: $accessModeString,
                serverPort: serverPort,
                localIPAddress: localIPAddress,
                restartServerWithNewBindAddress: restartServerWithNewBindAddress
            )

            PortConfigurationView(
                serverPort: $serverPort,
                restartServerWithNewPort: restartServerWithNewPort
            )
        } header: {
            Text("Server Configuration")
                .font(.headline)
        }
    }
}

// MARK: - Access Mode View

private struct AccessModeView: View {
    let accessMode: DashboardAccessMode
    @Binding var accessModeString: String
    let serverPort: String
    let localIPAddress: String?
    let restartServerWithNewBindAddress: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Allow accessing the dashboard from:")
                Spacer()
                Picker("", selection: Binding(
                    get: { accessMode },
                    set: { newMode in
                        accessModeString = newMode.rawValue
                        restartServerWithNewBindAddress()
                    }
                )) {
                    ForEach(DashboardAccessMode.allCases, id: \.self) { mode in
                        Text(mode.displayName).tag(mode)
                    }
                }
                .pickerStyle(.menu)
                .labelsHidden()
            }
            HStack(spacing: 8) {
                Text(accessMode.description)
                    .font(.caption)
                    .foregroundStyle(.secondary)

                // Show IP address when network access is enabled
                if accessMode == .network {
                    if let ipAddress = localIPAddress {
                        Spacer()

                        Button(
                            action: {
                                let urlString = "http://\(ipAddress):\(serverPort)"
                                if let url = URL(string: urlString) {
                                    NSWorkspace.shared.open(url)
                                }
                            },
                            label: {
                                Text("http://\(ipAddress):\(serverPort)")
                                    .font(.caption)
                                    .foregroundStyle(.blue)
                                    .underline()
                            }
                        )
                        .buttonStyle(.plain)
                        .pointingHandCursor()

                        Button(
                            action: {
                                let urlString = "http://\(ipAddress):\(serverPort)"
                                NSPasteboard.general.clearContents()
                                NSPasteboard.general.setString(urlString, forType: .string)
                            },
                            label: {
                                Image(systemName: "doc.on.doc")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        )
                        .buttonStyle(.plain)
                        .help("Copy URL")
                    } else {
                        Spacer()
                        Text("Unable to determine local IP address")
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
                }
            }
        }
    }
}

// MARK: - Port Configuration View

private struct PortConfigurationView: View {
    @Binding var serverPort: String
    let restartServerWithNewPort: (Int) -> Void

    @State private var portNumber: Int = 4_020

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("Server port:")
                Spacer()
                HStack(spacing: 4) {
                    TextField("", text: $serverPort)
                        .textFieldStyle(.roundedBorder)
                        .frame(width: 80)
                        .multilineTextAlignment(.center)
                        .onChange(of: serverPort) { _, newValue in
                            // Validate port number
                            if let port = Int(newValue), port > 0, port < 65_536 {
                                portNumber = port
                                restartServerWithNewPort(port)
                            }
                        }

                    VStack(spacing: 0) {
                        Button(
                            action: {
                                if portNumber < 65_535 {
                                    portNumber += 1
                                    serverPort = String(portNumber)
                                    restartServerWithNewPort(portNumber)
                                }
                            },
                            label: {
                                Image(systemName: "chevron.up")
                                    .font(.system(size: 10))
                                    .frame(width: 16, height: 12)
                            }
                        )
                        .buttonStyle(.plain)
                        .help("Increase port number")

                        Button(
                            action: {
                                if portNumber > 1 {
                                    portNumber -= 1
                                    serverPort = String(portNumber)
                                    restartServerWithNewPort(portNumber)
                                }
                            },
                            label: {
                                Image(systemName: "chevron.down")
                                    .font(.system(size: 10))
                                    .frame(width: 16, height: 12)
                            }
                        )
                        .buttonStyle(.plain)
                        .help("Decrease port number")
                    }
                }
                .onAppear {
                    portNumber = Int(serverPort) ?? 4_020
                }
            }
            Text("The server will automatically restart when the port is changed.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}

// MARK: - Ngrok Integration Section

private struct NgrokIntegrationSection: View {
    @Binding var ngrokEnabled: Bool
    @Binding var ngrokAuthToken: String
    @Binding var ngrokTokenPresent: Bool
    @Binding var isTokenRevealed: Bool
    @Binding var maskedToken: String
    let isStartingNgrok: Bool
    let ngrokError: String?
    let ngrokService: NgrokService
    let checkAndStartNgrok: () -> Void
    let stopNgrok: () -> Void
    let toggleTokenVisibility: () -> Void

    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: 12) {
                // ngrok Enable Toggle
                NgrokToggleView(
                    ngrokEnabled: $ngrokEnabled,
                    checkAndStartNgrok: checkAndStartNgrok,
                    stopNgrok: stopNgrok
                )

                // Auth Token
                NgrokAuthTokenView(
                    ngrokAuthToken: $ngrokAuthToken,
                    ngrokTokenPresent: $ngrokTokenPresent,
                    isTokenRevealed: $isTokenRevealed,
                    maskedToken: $maskedToken,
                    ngrokService: ngrokService,
                    toggleTokenVisibility: toggleTokenVisibility
                )

                // Status
                if ngrokEnabled {
                    NgrokStatusView(
                        ngrokService: ngrokService,
                        isStartingNgrok: isStartingNgrok
                    )
                }

                // Error display
                if let error = ngrokError {
                    NgrokErrorView(error: error)
                }
            }
        } header: {
            Text("ngrok Integration")
                .font(.headline)
        } footer: {
            Text(
                "Alternatively, we recommend [Tailscale](https://tailscale.com/) to create a virtual network to access your Mac."
            )
            .font(.caption)
            .foregroundStyle(.secondary)
            .tint(.blue)
            .frame(maxWidth: .infinity)
            .multilineTextAlignment(.center)
        }
    }
}

// MARK: - Ngrok Toggle View

private struct NgrokToggleView: View {
    @Binding var ngrokEnabled: Bool
    let checkAndStartNgrok: () -> Void
    let stopNgrok: () -> Void

    private let logger = Logger(subsystem: "com.steipete.VibeTunnel", category: "NgrokToggle")

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Toggle("Enable ngrok tunnel", isOn: $ngrokEnabled)
                .onChange(of: ngrokEnabled) { oldValue, newValue in
                    logger.debug("ngrok toggle changed from \(oldValue) to \(newValue)")
                    if newValue {
                        // Add a small delay to ensure auth token is saved to keychain
                        Task {
                            try? await Task.sleep(for: .milliseconds(100))
                            await MainActor.run {
                                checkAndStartNgrok()
                            }
                        }
                    } else {
                        stopNgrok()
                    }
                }
            Text("Expose VibeTunnel to the internet using ngrok.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}

// MARK: - Ngrok Auth Token View

private struct NgrokAuthTokenView: View {
    @Binding var ngrokAuthToken: String
    @Binding var ngrokTokenPresent: Bool
    @Binding var isTokenRevealed: Bool
    @Binding var maskedToken: String
    let ngrokService: NgrokService
    let toggleTokenVisibility: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("Auth token:")
                Spacer()
                HStack(spacing: 4) {
                    if isTokenRevealed {
                        SecureField("", text: $ngrokAuthToken)
                            .frame(width: 220)
                            .textFieldStyle(.roundedBorder)
                            .onChange(of: ngrokAuthToken) { _, newValue in
                                ngrokService.authToken = newValue.isEmpty ? nil : newValue
                                ngrokTokenPresent = !newValue.isEmpty
                            }
                    } else {
                        TextField("", text: $maskedToken)
                            .frame(width: 220)
                            .textFieldStyle(.roundedBorder)
                            .disabled(true)
                            .onAppear {
                                // Show masked placeholder if token exists
                                if ngrokTokenPresent {
                                    maskedToken = String(repeating: "•", count: 12)
                                } else {
                                    maskedToken = ""
                                }
                            }
                    }
                    Button(action: {
                        toggleTokenVisibility()
                    }, label: {
                        Image(systemName: isTokenRevealed ? "eye.slash" : "eye")
                    })
                    .buttonStyle(.plain)
                    .help(isTokenRevealed ? "Hide token" : "Reveal token")
                }
            }
            HStack {
                Text("Get your free auth token at")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Button("ngrok.com") {
                    if let url = URL(string: "https://dashboard.ngrok.com/auth/your-authtoken") {
                        NSWorkspace.shared.open(url)
                    }
                }
                .buttonStyle(.link)
                .font(.caption)
            }
        }
    }
}

// MARK: - Ngrok Status View

private struct NgrokStatusView: View {
    let ngrokService: NgrokService
    let isStartingNgrok: Bool

    var body: some View {
        if let publicUrl = ngrokService.publicUrl {
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundColor(.green)
                    Text("Tunnel active")
                        .font(.caption)
                    Spacer()
                    Image(systemName: "doc.on.doc")
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .help("Copy URL")
                        .onTapGesture {
                            NSPasteboard.general.clearContents()
                            NSPasteboard.general.setString(publicUrl, forType: .string)
                        }

                    Button("Open Browser") {
                        if let url = URL(string: publicUrl) {
                            NSWorkspace.shared.open(url)
                        }
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }
                Text(publicUrl)
                    .font(.caption)
                    .textSelection(.enabled)
                    .foregroundStyle(.secondary)
            }
        } else if isStartingNgrok {
            HStack {
                ProgressView()
                    .scaleEffect(0.8)
                Text("Starting ngrok tunnel...")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

// MARK: - Ngrok Error View

private struct NgrokErrorView: View {
    let error: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundColor(.orange)
                Text("Error")
                    .font(.caption)
            }
            Text(error)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}
