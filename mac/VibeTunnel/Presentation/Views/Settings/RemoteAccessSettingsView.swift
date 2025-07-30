import AppKit
import os.log
import SwiftUI

/// Remote Access settings tab for external access configuration
struct RemoteAccessSettingsView: View {
    @AppStorage("ngrokEnabled")
    private var ngrokEnabled = false
    @AppStorage("ngrokTokenPresent")
    private var ngrokTokenPresent = false
    @AppStorage(AppConstants.UserDefaultsKeys.serverPort)
    private var serverPort = "4020"
    @AppStorage(AppConstants.UserDefaultsKeys.dashboardAccessMode)
    private var accessModeString = AppConstants.Defaults.dashboardAccessMode
    @AppStorage(AppConstants.UserDefaultsKeys.authenticationMode)
    private var authModeString = "os"

    @State private var authMode: AuthenticationMode = .osAuth

    @Environment(NgrokService.self)
    private var ngrokService
    @Environment(TailscaleService.self)
    private var tailscaleService
    @Environment(CloudflareService.self)
    private var cloudflareService
    @Environment(TailscaleServeStatusService.self)
    private var tailscaleServeStatus
    @Environment(ServerManager.self)
    private var serverManager

    @State private var ngrokAuthToken = ""
    @State private var ngrokStatus: NgrokTunnelStatus?
    @State private var isStartingNgrok = false
    @State private var ngrokError: String?
    @State private var showingAuthTokenAlert = false
    @State private var showingKeychainAlert = false
    @State private var isTokenRevealed = false
    @State private var maskedToken = ""
    @State private var localIPAddress: String?
    @State private var showingServerErrorAlert = false
    @State private var serverErrorMessage = ""

    private let logger = Logger(subsystem: BundleIdentifiers.loggerSubsystem, category: "RemoteAccessSettings")

    private var accessMode: DashboardAccessMode {
        DashboardAccessMode(rawValue: accessModeString) ?? .localhost
    }

    var body: some View {
        NavigationStack {
            Form {
                // Authentication section (moved from Security)
                AuthenticationSection(
                    authMode: $authMode,
                    enableSSHKeys: .constant(authMode == .sshKeys || authMode == .both),
                    logger: logger,
                    serverManager: serverManager
                )

                TailscaleIntegrationSection(
                    tailscaleService: tailscaleService,
                    serverPort: serverPort,
                    accessMode: accessMode,
                    serverManager: serverManager
                )

                CloudflareIntegrationSection(
                    cloudflareService: cloudflareService,
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
            .navigationTitle("Remote")
            .onAppear {
                onAppearSetup()
                updateLocalIPAddress()
                // Initialize authentication mode from stored value
                let storedMode = UserDefaults.standard
                    .string(forKey: AppConstants.UserDefaultsKeys.authenticationMode) ?? "os"
                authMode = AuthenticationMode(rawValue: storedMode) ?? .osAuth
                // Start monitoring Tailscale Serve status
                tailscaleServeStatus.startMonitoring()
            }
            .onDisappear {
                // Stop monitoring when view disappears
                tailscaleServeStatus.stopMonitoring()
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
        // Check if token exists without triggering keychain
        if ngrokService.hasAuthToken && !ngrokTokenPresent {
            ngrokTokenPresent = true
        }

        // Update masked field based on token presence
        if ngrokTokenPresent && !isTokenRevealed {
            maskedToken = String(repeating: "•", count: 12)
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

    private func restartServerWithNewPort(_ port: Int) {
        Task {
            await ServerConfigurationHelpers.restartServerWithNewPort(port, serverManager: serverManager)
        }
    }

    private func restartServerWithNewBindAddress() {
        Task {
            await ServerConfigurationHelpers.restartServerWithNewBindAddress(
                accessMode: accessMode,
                serverManager: serverManager
            )
        }
    }

    private func updateLocalIPAddress() {
        Task {
            localIPAddress = await ServerConfigurationHelpers.updateLocalIPAddress(accessMode: accessMode)
        }
    }
}

// MARK: - Tailscale Integration Section

private struct TailscaleIntegrationSection: View {
    let tailscaleService: TailscaleService
    let serverPort: String
    let accessMode: DashboardAccessMode
    let serverManager: ServerManager

    @State private var statusCheckTimer: Timer?
    @AppStorage(AppConstants.UserDefaultsKeys.tailscaleServeEnabled)
    private var tailscaleServeEnabled = false
    @Environment(TailscaleServeStatusService.self)
    private var tailscaleServeStatus

    private let logger = Logger(subsystem: BundleIdentifiers.loggerSubsystem, category: "TailscaleIntegrationSection")

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
                    // Tailscale Serve toggle
                    HStack {
                        Toggle("Enable Tailscale Serve Integration", isOn: $tailscaleServeEnabled)
                            .onChange(of: tailscaleServeEnabled) { _, newValue in
                                logger.info("Tailscale Serve integration \(newValue ? "enabled" : "disabled")")
                                // Restart server to apply the new setting
                                Task {
                                    await serverManager.restart()
                                }
                            }

                        Spacer()

                        if tailscaleServeEnabled {
                            // Show status indicator - fixed height to prevent jumping
                            HStack(spacing: 4) {
                                if tailscaleServeStatus.isLoading {
                                    ProgressView()
                                        .scaleEffect(0.7)
                                } else if tailscaleServeStatus.isRunning {
                                    Image(systemName: "checkmark.circle.fill")
                                        .foregroundColor(.green)
                                    Text("Running")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                } else if let error = tailscaleServeStatus.lastError {
                                    Image(systemName: "exclamationmark.triangle.fill")
                                        .foregroundColor(.orange)
                                        .help("Error: \(error)")
                                    Text("Error")
                                        .font(.caption)
                                        .foregroundColor(.orange)
                                } else {
                                    Image(systemName: "circle")
                                        .foregroundColor(.gray)
                                    Text("Starting...")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                            }
                            .frame(height: 16) // Fixed height prevents UI jumping
                        }
                    }

                    // Show dashboard URL when running
                    if let hostname = tailscaleService.tailscaleHostname {
                        InlineClickableURLView(
                            label: "Access VibeTunnel at:",
                            url: TailscaleURLHelper.constructURL(
                                hostname: hostname,
                                port: serverPort,
                                isTailscaleServeEnabled: tailscaleServeEnabled
                            )?.absoluteString ?? ""
                        )

                        // Show warning if in localhost-only mode
                        if accessMode == .localhost && !tailscaleServeEnabled {
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

                        // Show error details if any
                        if tailscaleServeEnabled, let error = tailscaleServeStatus.lastError {
                            HStack(spacing: 6) {
                                Image(systemName: "exclamationmark.triangle.fill")
                                    .foregroundColor(.orange)
                                    .font(.system(size: 12))
                                Text("Error: \(error)")
                                    .font(.caption)
                                    .foregroundColor(.orange)
                                    .lineLimit(2)
                            }
                            .padding(.vertical, 4)
                            .padding(.horizontal, 8)
                            .background(Color.orange.opacity(0.1))
                            .cornerRadius(4)
                        }

                        // Help text about Tailscale Serve
                        if tailscaleServeEnabled && tailscaleServeStatus.isRunning {
                            Text(
                                "Tailscale Serve provides secure access with automatic authentication using Tailscale identity headers."
                            )
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .padding(.top, 4)
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
                    InlineClickableURLView(
                        label: "Public URL:",
                        url: status.publicUrl
                    )
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

// MARK: - Previews

#Preview("Remote Access Settings") {
    RemoteAccessSettingsView()
        .frame(width: 500, height: 600)
        .environment(SystemPermissionManager.shared)
}
