import AppKit
import os.log
import SwiftUI
import UserNotifications

/// Dashboard settings tab for server and access configuration
struct DashboardSettingsView: View {
    @AppStorage("serverPort")
    private var serverPort = "4020"
    @AppStorage("ngrokEnabled")
    private var ngrokEnabled = false
    @AppStorage("authenticationMode")
    private var authModeString = "os"
    @AppStorage("ngrokTokenPresent")
    private var ngrokTokenPresent = false
    @AppStorage("dashboardAccessMode")
    private var accessModeString = DashboardAccessMode.network.rawValue

    @State private var authMode: SecuritySection.AuthenticationMode = .osAuth

    @Environment(SystemPermissionManager.self)
    private var permissionManager
    @Environment(ServerManager.self)
    private var serverManager
    @Environment(NgrokService.self)
    private var ngrokService
    @Environment(TailscaleService.self)
    private var tailscaleService

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

    private let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "DashboardSettings")

    private var accessMode: DashboardAccessMode {
        DashboardAccessMode(rawValue: accessModeString) ?? .localhost
    }

    // MARK: - Helper Methods

    var body: some View {
        NavigationStack {
            Form {
                SecuritySection(
                    authMode: $authMode,
                    enableSSHKeys: .constant(authMode == .sshKeys || authMode == .both),
                    logger: logger,
                    serverManager: serverManager
                )

                ServerConfigurationSection(
                    accessMode: accessMode,
                    accessModeString: $accessModeString,
                    serverPort: $serverPort,
                    localIPAddress: localIPAddress,
                    restartServerWithNewBindAddress: restartServerWithNewBindAddress,
                    restartServerWithNewPort: restartServerWithNewPort,
                    serverManager: serverManager
                )

                TailscaleIntegrationSection(
                    tailscaleService: tailscaleService,
                    serverPort: serverPort,
                    accessMode: accessMode
                )

                NgrokIntegrationSection(
                    ngrokEnabled: $ngrokEnabled,
                    ngrokAuthToken: $ngrokAuthToken,
                    isTokenRevealed: $isTokenRevealed,
                    maskedToken: $maskedToken,
                    ngrokTokenPresent: $ngrokTokenPresent,
                    ngrokStatus: $ngrokStatus,
                    isStartingNgrok: $isStartingNgrok,
                    ngrokError: $ngrokError,
                    toggleTokenVisibility: toggleTokenVisibility,
                    checkAndStartNgrok: checkAndStartNgrok,
                    stopNgrok: stopNgrok,
                    ngrokService: ngrokService,
                    logger: logger
                )
            }
            .formStyle(.grouped)
            .frame(minWidth: 500, idealWidth: 600)
            .scrollContentBackground(.hidden)
            .navigationTitle("Dashboard")
            .onAppear {
                onAppearSetup()
            }
        }
        .alert("ngrok Authentication Required", isPresented: $showingAuthTokenAlert) {
            Button("OK") {}
        } message: {
            Text("Please enter your ngrok auth token to enable tunneling.")
        }
        .alert("Keychain Access Failed", isPresented: $showingKeychainAlert) {
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
        // Initialize authentication mode from stored value
        let storedMode = UserDefaults.standard.string(forKey: "authenticationMode") ?? "os"
        authMode = SecuritySection.AuthenticationMode(rawValue: storedMode) ?? .osAuth

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

    private func restartServerWithNewPort(_ port: Int) {
        Task {
            // Update the port in ServerManager and restart
            serverManager.port = String(port)
            await serverManager.restart()
            logger.info("Server restarted on port \(port)")

            // Wait for server to be fully ready before restarting session monitor
            try? await Task.sleep(for: .seconds(1))

            // Session monitoring will automatically detect the port change
        }
    }

    private func restartServerWithNewBindAddress() {
        Task {
            // Update the bind address in ServerManager and restart
            serverManager.bindAddress = accessMode.bindAddress
            await serverManager.restart()
            logger.info("Server restarted with bind address \(accessMode.bindAddress)")

            // Wait for server to be fully ready before restarting session monitor
            try? await Task.sleep(for: .seconds(1))

            // Session monitoring will automatically detect the bind address change
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
    @Binding var authMode: AuthenticationMode
    @Binding var enableSSHKeys: Bool
    let logger: Logger
    let serverManager: ServerManager

    enum AuthenticationMode: String, CaseIterable {
        case none = "none"
        case osAuth = "os"
        case sshKeys = "ssh"
        case both = "both"

        var displayName: String {
            switch self {
            case .none: "None"
            case .osAuth: "macOS"
            case .sshKeys: "SSH Keys"
            case .both: "Both"
            }
        }

        var description: String {
            switch self {
            case .none: "Anyone can access the dashboard (not recommended)"
            case .osAuth: "Use your macOS username and password"
            case .sshKeys: "Use SSH keys from ~/.ssh/authorized_keys"
            case .both: "Allow both authentication methods"
            }
        }
    }

    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: 16) {
                // Authentication mode picker
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("Authentication Method")
                            .font(.callout)
                        Spacer()
                        Picker("", selection: $authMode) {
                            ForEach(AuthenticationMode.allCases, id: \.self) { mode in
                                Text(mode.displayName)
                                    .tag(mode)
                            }
                        }
                        .labelsHidden()
                        .pickerStyle(.menu)
                        .frame(alignment: .trailing)
                        .onChange(of: authMode) { _, newValue in
                            // Save the authentication mode
                            UserDefaults.standard.set(newValue.rawValue, forKey: "authenticationMode")

                            Task {
                                logger.info("Authentication mode changed to: \(newValue.rawValue)")
                                await serverManager.restart()
                            }
                        }
                    }

                    Text(authMode.description)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                // Additional info based on selected mode
                if authMode == .osAuth || authMode == .both {
                    HStack(alignment: .center, spacing: 6) {
                        Image(systemName: "info.circle")
                            .foregroundColor(.blue)
                            .font(.system(size: 12))
                            .frame(width: 16, height: 16)
                        Text("Uses your macOS username: \(NSUserName())")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Spacer()
                    }
                }

                if authMode == .sshKeys || authMode == .both {
                    HStack(alignment: .center, spacing: 6) {
                        Image(systemName: "key.fill")
                            .foregroundColor(.blue)
                            .font(.system(size: 12))
                            .frame(width: 16, height: 16)
                        Text("SSH keys from ~/.ssh/authorized_keys")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Spacer()
                        Button("Open folder") {
                            let sshPath = NSHomeDirectory() + "/.ssh"
                            if FileManager.default.fileExists(atPath: sshPath) {
                                NSWorkspace.shared.open(URL(fileURLWithPath: sshPath))
                            } else {
                                // Create .ssh directory if it doesn't exist
                                try? FileManager.default.createDirectory(
                                    atPath: sshPath,
                                    withIntermediateDirectories: true,
                                    attributes: [.posixPermissions: 0o700]
                                )
                                NSWorkspace.shared.open(URL(fileURLWithPath: sshPath))
                            }
                        }
                        .buttonStyle(.link)
                        .font(.caption)
                    }
                }
            }
        } header: {
            Text("Security")
                .font(.headline)
        } footer: {
            Text("Localhost connections are always accessible without authentication.")
                .font(.caption)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
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
    let serverManager: ServerManager

    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: 12) {
                AccessModeView(
                    accessMode: accessMode,
                    accessModeString: $accessModeString,
                    serverPort: serverPort,
                    localIPAddress: localIPAddress,
                    restartServerWithNewBindAddress: restartServerWithNewBindAddress
                )

                PortConfigurationView(
                    serverPort: $serverPort,
                    restartServerWithNewPort: restartServerWithNewPort,
                    serverManager: serverManager
                )
            }
        } header: {
            Text("Server Configuration")
                .font(.headline)
        } footer: {
            // Dashboard URL display
            if accessMode == .localhost {
                HStack(spacing: 5) {
                    Text("Dashboard available at")
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    if let url = DashboardURLBuilder.dashboardURL(port: serverPort) {
                        Link(url.absoluteString, destination: url)
                            .font(.caption)
                            .foregroundStyle(.blue)
                    }
                }
                .frame(maxWidth: .infinity)
                .multilineTextAlignment(.center)
            } else if accessMode == .network {
                if let ip = localIPAddress {
                    HStack(spacing: 5) {
                        Text("Dashboard available at")
                            .font(.caption)
                            .foregroundStyle(.secondary)

                        if let url = URL(string: "http://\(ip):\(serverPort)") {
                            Link(url.absoluteString, destination: url)
                                .font(.caption)
                                .foregroundStyle(.blue)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .multilineTextAlignment(.center)
                } else {
                    Text("Fetching local IP address...")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity)
                        .multilineTextAlignment(.center)
                }
            }
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
                Text("Access Mode")
                    .font(.callout)
                Spacer()
                Picker("", selection: $accessModeString) {
                    ForEach(DashboardAccessMode.allCases, id: \.rawValue) { mode in
                        Text(mode.displayName)
                            .tag(mode.rawValue)
                    }
                }
                .labelsHidden()
                .onChange(of: accessModeString) { _, _ in
                    restartServerWithNewBindAddress()
                }
            }
        }
    }
}

// MARK: - Port Configuration View

private struct PortConfigurationView: View {
    @Binding var serverPort: String
    let restartServerWithNewPort: (Int) -> Void
    let serverManager: ServerManager

    @FocusState private var isPortFieldFocused: Bool
    @State private var pendingPort: String = ""
    @State private var portError: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Port")
                    .font(.callout)
                Spacer()
                HStack(spacing: 4) {
                    TextField("", text: $pendingPort)
                        .textFieldStyle(.roundedBorder)
                        .frame(width: 80)
                        .multilineTextAlignment(.center)
                        .focused($isPortFieldFocused)
                        .onSubmit {
                            validateAndUpdatePort()
                        }
                        .onAppear {
                            pendingPort = serverPort
                        }
                        .onChange(of: pendingPort) { _, newValue in
                            // Clear error when user types
                            portError = nil
                            // Limit to 5 digits
                            if newValue.count > 5 {
                                pendingPort = String(newValue.prefix(5))
                            }
                        }

                    VStack(spacing: 0) {
                        Button(action: {
                            if let port = Int(pendingPort), port < 65_535 {
                                pendingPort = String(port + 1)
                                validateAndUpdatePort()
                            }
                        }, label: {
                            Image(systemName: "chevron.up")
                                .font(.system(size: 10))
                                .frame(width: 16, height: 11)
                        })
                        .buttonStyle(.borderless)

                        Button(action: {
                            if let port = Int(pendingPort), port > 1_024 {
                                pendingPort = String(port - 1)
                                validateAndUpdatePort()
                            }
                        }, label: {
                            Image(systemName: "chevron.down")
                                .font(.system(size: 10))
                                .frame(width: 16, height: 11)
                        })
                        .buttonStyle(.borderless)
                    }
                }
            }

            if let error = portError {
                HStack {
                    Image(systemName: "exclamationmark.triangle")
                        .foregroundColor(.red)
                    Text(error)
                        .font(.caption)
                        .foregroundColor(.red)
                }
            }
        }
    }

    private func validateAndUpdatePort() {
        guard let port = Int(pendingPort) else {
            portError = "Invalid port number"
            pendingPort = serverPort
            return
        }

        guard port >= 1_024 && port <= 65_535 else {
            portError = "Port must be between 1024 and 65535"
            pendingPort = serverPort
            return
        }

        if String(port) != serverPort {
            restartServerWithNewPort(port)
            serverPort = String(port)
        }
    }
}

// MARK: - ngrok Integration Section

private struct NgrokIntegrationSection: View {
    @Binding var ngrokEnabled: Bool
    @Binding var ngrokAuthToken: String
    @Binding var isTokenRevealed: Bool
    @Binding var maskedToken: String
    @Binding var ngrokTokenPresent: Bool
    @Binding var ngrokStatus: NgrokTunnelStatus?
    @Binding var isStartingNgrok: Bool
    @Binding var ngrokError: String?
    let toggleTokenVisibility: () -> Void
    let checkAndStartNgrok: () -> Void
    let stopNgrok: () -> Void
    let ngrokService: NgrokService
    let logger: Logger

    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: 12) {
                // ngrok toggle and status
                HStack {
                    Toggle("Enable ngrok tunnel", isOn: $ngrokEnabled)
                        .disabled(isStartingNgrok)
                        .onChange(of: ngrokEnabled) { _, newValue in
                            if newValue {
                                checkAndStartNgrok()
                            } else {
                                stopNgrok()
                            }
                        }

                    if isStartingNgrok {
                        ProgressView()
                            .scaleEffect(0.7)
                    } else if ngrokStatus != nil {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundColor(.green)
                        Text("Connected")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }

                // Auth token field
                AuthTokenField(
                    ngrokAuthToken: $ngrokAuthToken,
                    isTokenRevealed: $isTokenRevealed,
                    maskedToken: $maskedToken,
                    ngrokTokenPresent: $ngrokTokenPresent,
                    toggleTokenVisibility: toggleTokenVisibility,
                    ngrokService: ngrokService,
                    logger: logger
                )

                // Public URL display
                if let status = ngrokStatus {
                    PublicURLView(url: status.publicUrl)
                }

                // Error display
                if let error = ngrokError {
                    ErrorView(error: error)
                }

                // Link to ngrok dashboard
                HStack {
                    Image(systemName: "link")
                    if let url = URL(string: "https://dashboard.ngrok.com/signup") {
                        Link("Create free ngrok account", destination: url)
                            .font(.caption)
                    }
                }
            }
        } header: {
            Text("ngrok Integration")
                .font(.headline)
        } footer: {
            Text(
                "ngrok creates secure public tunnels to access your terminal sessions from any device (including phones and tablets) via the internet."
            )
            .font(.caption)
            .frame(maxWidth: .infinity)
            .multilineTextAlignment(.center)
        }
    }
}

// MARK: - Auth Token Field

private struct AuthTokenField: View {
    @Binding var ngrokAuthToken: String
    @Binding var isTokenRevealed: Bool
    @Binding var maskedToken: String
    @Binding var ngrokTokenPresent: Bool
    let toggleTokenVisibility: () -> Void
    let ngrokService: NgrokService
    let logger: Logger

    @FocusState private var isTokenFieldFocused: Bool
    @State private var tokenSaveError: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                if isTokenRevealed {
                    TextField("Auth Token", text: $ngrokAuthToken)
                        .textFieldStyle(.roundedBorder)
                        .focused($isTokenFieldFocused)
                        .onSubmit {
                            saveToken()
                        }
                } else {
                    TextField("Auth Token", text: $maskedToken)
                        .textFieldStyle(.roundedBorder)
                        .disabled(true)
                        .foregroundColor(.secondary)
                }

                Button(action: toggleTokenVisibility) {
                    Image(systemName: isTokenRevealed ? "eye.slash" : "eye")
                }
                .buttonStyle(.borderless)
                .help(isTokenRevealed ? "Hide token" : "Show token")

                if isTokenRevealed && (ngrokAuthToken != ngrokService.authToken || !ngrokTokenPresent) {
                    Button("Save") {
                        saveToken()
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                }
            }

            if let error = tokenSaveError {
                Text(error)
                    .font(.caption)
                    .foregroundColor(.red)
            }
        }
    }

    private func saveToken() {
        guard !ngrokAuthToken.isEmpty else {
            tokenSaveError = "Token cannot be empty"
            return
        }

        ngrokService.authToken = ngrokAuthToken
        if ngrokService.authToken != nil {
            ngrokTokenPresent = true
            tokenSaveError = nil
            isTokenRevealed = false
            maskedToken = String(repeating: "•", count: 12)
            logger.info("ngrok auth token saved successfully")
        } else {
            tokenSaveError = "Failed to save token to keychain"
            logger.error("Failed to save ngrok auth token to keychain")
        }
    }
}

// MARK: - Public URL View

private struct PublicURLView: View {
    let url: String

    @State private var showCopiedFeedback = false

    var body: some View {
        HStack {
            Text("Public URL:")
                .font(.caption)
                .foregroundColor(.secondary)
            Text(url)
                .font(.caption)
                .textSelection(.enabled)

            Button(action: {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(url, forType: .string)
                withAnimation {
                    showCopiedFeedback = true
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                    withAnimation {
                        showCopiedFeedback = false
                    }
                }
            }, label: {
                Image(systemName: showCopiedFeedback ? "checkmark" : "doc.on.doc")
                    .foregroundColor(showCopiedFeedback ? .green : .accentColor)
            })
            .buttonStyle(.borderless)
            .help("Copy URL")
        }
    }
}

// MARK: - Error View

private struct ErrorView: View {
    let error: String

    var body: some View {
        HStack {
            Image(systemName: "exclamationmark.triangle")
                .foregroundColor(.red)
            Text(error)
                .font(.caption)
                .foregroundColor(.red)
                .lineLimit(2)
        }
    }
}

// MARK: - Tailscale Integration Section

private struct TailscaleIntegrationSection: View {
    let tailscaleService: TailscaleService
    let serverPort: String
    let accessMode: DashboardAccessMode

    @State private var statusCheckTimer: Timer?

    private let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "TailscaleIntegrationSection")

    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    if tailscaleService.isInstalled {
                        if tailscaleService.isRunning {
                            // Green dot: Tailscale is installed and running
                            Image(systemName: "circle.fill")
                                .foregroundColor(.green)
                                .font(.system(size: 10))
                            Text("Tailscale is installed and running")
                                .font(.callout)
                        } else {
                            // Orange dot: Tailscale is installed but not running
                            Image(systemName: "circle.fill")
                                .foregroundColor(.orange)
                                .font(.system(size: 10))
                            Text("Tailscale is installed but not running")
                                .font(.callout)
                        }
                    } else {
                        // Yellow dot: Tailscale is not installed
                        Image(systemName: "circle.fill")
                            .foregroundColor(.yellow)
                            .font(.system(size: 10))
                        Text("Tailscale is not installed")
                            .font(.callout)
                    }

                    Spacer()
                }

                // Show additional content based on state
                if !tailscaleService.isInstalled {
                    // Show download links when not installed
                    HStack(spacing: 12) {
                        Button(action: {
                            tailscaleService.openAppStore()
                        }, label: {
                            Text("App Store")
                        })
                        .buttonStyle(.link)
                        .controlSize(.small)

                        Button(action: {
                            tailscaleService.openDownloadPage()
                        }, label: {
                            Text("Direct Download")
                        })
                        .buttonStyle(.link)
                        .controlSize(.small)

                        Button(action: {
                            tailscaleService.openSetupGuide()
                        }, label: {
                            Text("Setup Guide")
                        })
                        .buttonStyle(.link)
                        .controlSize(.small)
                    }
                } else if tailscaleService.isRunning {
                    // Show dashboard URL when running
                    if let hostname = tailscaleService.tailscaleHostname {
                        HStack(spacing: 5) {
                            Text("Access VibeTunnel at:")
                                .font(.caption)
                                .foregroundColor(.secondary)

                            let urlString = "http://\(hostname):\(serverPort)"
                            if let url = URL(string: urlString) {
                                Link(urlString, destination: url)
                                    .font(.caption)
                                    .foregroundStyle(.blue)
                            }
                        }

                        // Show warning if in localhost-only mode
                        if accessMode == .localhost {
                            HStack(spacing: 6) {
                                Image(systemName: "exclamationmark.triangle.fill")
                                    .foregroundColor(.orange)
                                    .font(.system(size: 12))
                                Text(
                                    "Server is in localhost-only mode. Change to 'Network' mode above to access via Tailscale."
                                )
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
        } header: {
            Text("Tailscale Integration")
                .font(.headline)
        } footer: {
            Text(
                "Recommended: Tailscale provides secure, private access to your terminal sessions from any device (including phones and tablets) without exposing VibeTunnel to the public internet."
            )
            .font(.caption)
            .frame(maxWidth: .infinity)
            .multilineTextAlignment(.center)
        }
        .task {
            // Check status when view appears
            logger.info("TailscaleIntegrationSection: Starting initial status check")
            await tailscaleService.checkTailscaleStatus()
            logger
                .info(
                    "TailscaleIntegrationSection: Status check complete - isInstalled: \(tailscaleService.isInstalled), isRunning: \(tailscaleService.isRunning), hostname: \(tailscaleService.tailscaleHostname ?? "nil")"
                )

            // Set up timer for automatic updates every 5 seconds
            statusCheckTimer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { _ in
                Task {
                    logger.debug("TailscaleIntegrationSection: Running periodic status check")
                    await tailscaleService.checkTailscaleStatus()
                }
            }
        }
        .onDisappear {
            // Clean up timer when view disappears
            statusCheckTimer?.invalidate()
            statusCheckTimer = nil
            logger.info("TailscaleIntegrationSection: Stopped status check timer")
        }
    }
}

// MARK: - Previews

#Preview("Dashboard Settings") {
    DashboardSettingsView()
        .frame(width: 500, height: 800)
        .environment(SystemPermissionManager.shared)
}
