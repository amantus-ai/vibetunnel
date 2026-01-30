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
        DashboardAccessMode(rawValue: self.accessModeString) ?? .localhost
    }

    var body: some View {
        NavigationStack {
            Form {
                // Authentication section (moved from Security)
                AuthenticationSection(
                    authMode: self.$authMode,
                    enableSSHKeys: .constant(self.authMode == .sshKeys || self.authMode == .both),
                    logger: self.logger,
                    serverManager: self.serverManager)

                TailscaleIntegrationSection(
                    tailscaleService: self.tailscaleService,
                    serverPort: self.serverPort,
                    accessMode: self.accessMode,
                    serverManager: self.serverManager)

                CloudflareIntegrationSection(
                    cloudflareService: self.cloudflareService,
                    serverPort: self.serverPort,
                    accessMode: self.accessMode)

                NgrokIntegrationSection(
                    ngrokEnabled: self.$ngrokEnabled,
                    ngrokAuthToken: self.$ngrokAuthToken,
                    isTokenRevealed: self.$isTokenRevealed,
                    maskedToken: self.$maskedToken,
                    ngrokTokenPresent: self.$ngrokTokenPresent,
                    ngrokStatus: self.$ngrokStatus,
                    isStartingNgrok: self.$isStartingNgrok,
                    ngrokError: self.$ngrokError,
                    toggleTokenVisibility: self.toggleTokenVisibility,
                    checkAndStartNgrok: self.checkAndStartNgrok,
                    stopNgrok: self.stopNgrok,
                    ngrokService: self.ngrokService,
                    logger: self.logger)
            }
            .formStyle(.grouped)
            .frame(minWidth: 500, idealWidth: 600)
            .scrollContentBackground(.hidden)
            .navigationTitle("Remote")
            .onAppear {
                self.onAppearSetup()
                self.updateLocalIPAddress()
                // Initialize authentication mode from stored value
                let storedMode = UserDefaults.standard
                    .string(forKey: AppConstants.UserDefaultsKeys.authenticationMode) ?? "os"
                self.authMode = AuthenticationMode(rawValue: storedMode) ?? .osAuth
                // Start monitoring Tailscale Serve status
                self.tailscaleServeStatus.startMonitoring()
            }
            .onDisappear {
                // Stop monitoring when view disappears
                self.tailscaleServeStatus.stopMonitoring()
            }
        }
        .alert("ngrok Authentication Required", isPresented: self.$showingAuthTokenAlert) {
            Button("OK") {}
        } message: {
            Text("Please enter your ngrok auth token to enable tunneling.")
        }
        .alert("Keychain Access Failed", isPresented: self.$showingKeychainAlert) {
            Button("OK") {}
        } message: {
            Text("Failed to save the auth token to the keychain. Please check your keychain permissions and try again.")
        }
        .alert("Failed to Restart Server", isPresented: self.$showingServerErrorAlert) {
            Button("OK") {}
        } message: {
            Text(self.serverErrorMessage)
        }
    }

    // MARK: - Private Methods

    private func onAppearSetup() {
        // Check if token exists without triggering keychain
        if self.ngrokService.hasAuthToken, !self.ngrokTokenPresent {
            self.ngrokTokenPresent = true
        }

        // Update masked field based on token presence
        if self.ngrokTokenPresent, !self.isTokenRevealed {
            self.maskedToken = String(repeating: "•", count: 12)
        }
    }

    private func checkAndStartNgrok() {
        self.logger.debug("checkAndStartNgrok called")

        // Check if we have a token in the keychain without accessing it
        guard self.ngrokTokenPresent || self.ngrokService.hasAuthToken else {
            self.logger.debug("No auth token stored")
            self.ngrokError = "Please enter your ngrok auth token first"
            self.ngrokEnabled = false
            self.showingAuthTokenAlert = true
            return
        }

        // If token hasn't been revealed yet, we need to access it from keychain
        if !self.isTokenRevealed, self.ngrokAuthToken.isEmpty {
            // This will trigger keychain access
            if let token = ngrokService.authToken {
                self.ngrokAuthToken = token
                self.logger.debug("Retrieved token from keychain for ngrok start")
            } else {
                self.logger.error("Failed to retrieve token from keychain")
                self.ngrokError = "Failed to access auth token. Please try again."
                self.ngrokEnabled = false
                self.showingKeychainAlert = true
                return
            }
        }

        self.logger.debug("Starting ngrok with auth token present")
        self.isStartingNgrok = true
        self.ngrokError = nil

        Task {
            do {
                let port = Int(serverPort) ?? 4020
                self.logger.info("Starting ngrok on port \(port)")
                _ = try await self.ngrokService.start(port: port)
                self.isStartingNgrok = false
                self.ngrokStatus = await self.ngrokService.getStatus()
                self.logger.info("ngrok started successfully")
            } catch {
                self.logger.error("ngrok start error: \(error)")
                self.isStartingNgrok = false
                self.ngrokError = error.localizedDescription
                self.ngrokEnabled = false
            }
        }
    }

    private func stopNgrok() {
        Task {
            try? await self.ngrokService.stop()
            self.ngrokStatus = nil
            // Don't clear the error here - let it remain visible
        }
    }

    private func toggleTokenVisibility() {
        if self.isTokenRevealed {
            // Hide the token
            self.isTokenRevealed = false
            self.ngrokAuthToken = ""
            if self.ngrokTokenPresent {
                self.maskedToken = String(repeating: "•", count: 12)
            }
        } else {
            // Reveal the token - this will trigger keychain access
            if let token = ngrokService.authToken {
                self.ngrokAuthToken = token
                self.isTokenRevealed = true
            } else {
                // No token stored, just reveal the empty field
                self.ngrokAuthToken = ""
                self.isTokenRevealed = true
            }
        }
    }

    private func restartServerWithNewPort(_ port: Int) {
        Task {
            await ServerConfigurationHelpers.restartServerWithNewPort(port, serverManager: self.serverManager)
        }
    }

    private func restartServerWithNewBindAddress() {
        Task {
            await ServerConfigurationHelpers.restartServerWithNewBindAddress(
                accessMode: self.accessMode,
                serverManager: self.serverManager)
        }
    }

    private func updateLocalIPAddress() {
        Task {
            self.localIPAddress = await ServerConfigurationHelpers.updateLocalIPAddress(accessMode: self.accessMode)
        }
    }
}

// MARK: - Tailscale Integration Section

private struct TailscaleIntegrationSection: View {
    let tailscaleService: TailscaleService
    let serverPort: String
    let accessMode: DashboardAccessMode
    let serverManager: ServerManager

    @AppStorage(AppConstants.UserDefaultsKeys.tailscaleServeEnabled)
    private var tailscaleServeEnabled = false
    @AppStorage(AppConstants.UserDefaultsKeys.tailscaleFunnelEnabled)
    private var tailscaleFunnelEnabled = false
    @Environment(TailscaleServeStatusService.self)
    private var tailscaleServeStatus

    private let logger = Logger(subsystem: BundleIdentifiers.loggerSubsystem, category: "TailscaleIntegrationSection")

    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    if self.tailscaleService.isInstalled {
                        if self.tailscaleService.isRunning {
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
                if !self.tailscaleService.isInstalled {
                    // Show download links when not installed
                    HStack(spacing: 12) {
                        Button(action: {
                            self.tailscaleService.openAppStore()
                        }, label: {
                            Text("App Store")
                        })
                        .buttonStyle(.link)
                        .controlSize(.small)

                        Button(action: {
                            self.tailscaleService.openDownloadPage()
                        }, label: {
                            Text("Direct Download")
                        })
                        .buttonStyle(.link)
                        .controlSize(.small)

                        Button(action: {
                            self.tailscaleService.openSetupGuide()
                        }, label: {
                            Text("Setup Guide")
                        })
                        .buttonStyle(.link)
                        .controlSize(.small)
                    }
                } else if !self.tailscaleService.isRunning {
                    // Show Tailscale preferences even when not running
                    VStack(alignment: .leading, spacing: 12) {
                        // Single Tailscale toggle with access mode picker
                        VStack(alignment: .leading, spacing: 8) {
                            Toggle("Enable Tailscale Integration", isOn: self.$tailscaleServeEnabled)
                                .onChange(of: self.tailscaleServeEnabled) { _, newValue in
                                    self.logger.info("Tailscale integration \(newValue ? "enabled" : "disabled")")
                                    // Restart server to apply the new setting
                                    Task {
                                        await self.serverManager.restart()
                                    }
                                }

                            if self.tailscaleServeEnabled {
                                VStack(alignment: .leading, spacing: 8) {
                                    // Access mode picker
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text("Access:")
                                            .font(.callout)
                                            .foregroundColor(.secondary)

                                        Picker("", selection: self.$tailscaleFunnelEnabled) {
                                            Text("Private (Tailnet only)").tag(false)
                                            Text("Public (Internet)").tag(true)
                                        }
                                        .pickerStyle(.segmented)
                                        .frame(maxWidth: 240)
                                        .onChange(of: self.tailscaleFunnelEnabled) { _, newValue in
                                            self.logger
                                                .warning("Tailscale access mode: \(newValue ? "PUBLIC" : "PRIVATE")")
                                            // Force immediate UserDefaults synchronization
                                            UserDefaults.standard.set(
                                                newValue,
                                                forKey: AppConstants.UserDefaultsKeys.tailscaleFunnelEnabled)
                                            UserDefaults.standard.synchronize()
                                            Task {
                                                await self.serverManager.restart()
                                                // Give server time to apply new configuration
                                                try? await Task.sleep(nanoseconds: 1_500_000_000) // 1.5 seconds
                                                // Force immediate status refresh
                                                await self.tailscaleServeStatus.refreshStatusImmediately()
                                            }
                                        }
                                    }

                                    // Status when Tailscale not running
                                    HStack(spacing: 6) {
                                        Image(systemName: "exclamationmark.triangle.fill")
                                            .foregroundColor(.orange)
                                        Text("Tailscale not running - integration will activate when Tailscale starts")
                                            .font(.caption)
                                            .foregroundColor(.orange)
                                    }

                                    // Info for public access - only show when Public (Internet) is selected
                                    if self.tailscaleFunnelEnabled {
                                        HStack(spacing: 6) {
                                            Image(systemName: "info.circle.fill")
                                                .foregroundColor(.blue)
                                                .font(.system(size: 12))
                                            Text("Your terminal will be accessible from the public internet")
                                                .font(.caption)
                                                .foregroundColor(.secondary)
                                        }
                                        .padding(.vertical, 4)
                                        .padding(.horizontal, 8)
                                        .background(Color.blue.opacity(0.1))
                                        .cornerRadius(4)
                                    }
                                }
                                .padding(.leading, 20)
                            }
                        }

                        // Show action button to start Tailscale
                        if self.tailscaleService.isInstalled, !self.tailscaleService.isRunning {
                            Button(action: {
                                self.tailscaleService.openTailscaleApp()
                            }, label: {
                                HStack(spacing: 4) {
                                    Image(systemName: "play.circle")
                                    Text("Start Tailscale")
                                }
                            })
                            .buttonStyle(.borderedProminent)
                            .controlSize(.small)
                        }

                        // Show help text about what will happen when enabled
                        if self.tailscaleServeEnabled {
                            Text("Tailscale Serve will activate automatically when Tailscale is running.")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }
                } else {
                    // Tailscale is running - show full interface
                    VStack(alignment: .leading, spacing: 12) {
                        // Single Tailscale toggle with access mode picker
                        VStack(alignment: .leading, spacing: 8) {
                            Toggle("Enable Tailscale Integration", isOn: self.$tailscaleServeEnabled)
                                .onChange(of: self.tailscaleServeEnabled) { _, newValue in
                                    self.logger.info("Tailscale integration \(newValue ? "enabled" : "disabled")")
                                    // Restart server to apply the new setting
                                    Task {
                                        await self.serverManager.restart()
                                    }
                                }

                            if self.tailscaleServeEnabled {
                                VStack(alignment: .leading, spacing: 8) {
                                    // Access mode picker
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text("Access:")
                                            .font(.callout)
                                            .foregroundColor(.secondary)

                                        Picker("", selection: self.$tailscaleFunnelEnabled) {
                                            Text("Private (Tailnet only)").tag(false)
                                            Text("Public (Internet)").tag(true)
                                        }
                                        .pickerStyle(.segmented)
                                        .frame(maxWidth: 240)
                                        .onChange(of: self.tailscaleFunnelEnabled) { _, newValue in
                                            self.logger
                                                .warning("Tailscale access mode: \(newValue ? "PUBLIC" : "PRIVATE")")
                                            // Force immediate UserDefaults synchronization
                                            UserDefaults.standard.set(
                                                newValue,
                                                forKey: AppConstants.UserDefaultsKeys.tailscaleFunnelEnabled)
                                            UserDefaults.standard.synchronize()
                                            Task {
                                                await self.serverManager.restart()
                                                // Give server time to apply new configuration
                                                try? await Task.sleep(nanoseconds: 1_500_000_000) // 1.5 seconds
                                                // Force immediate status refresh
                                                await self.tailscaleServeStatus.refreshStatusImmediately()
                                            }
                                        }
                                    }

                                    // Status indicator on separate line
                                    HStack(spacing: 6) {
                                        if self.tailscaleServeStatus.isLoading {
                                            ProgressView()
                                                .scaleEffect(0.7)
                                            Text("Checking status...")
                                                .font(.caption)
                                                .foregroundColor(.secondary)
                                        } else if self.tailscaleServeStatus.isRunning {
                                            // Check if there's a mismatch between desired and actual modes
                                            let desiredIsPublic = self.tailscaleFunnelEnabled
                                            let actualIsPublic = self.tailscaleServeStatus.actualMode == "public"
                                            let mismatch = desiredIsPublic != actualIsPublic

                                            HStack(spacing: 4) {
                                                Image(
                                                    systemName: mismatch ? "exclamationmark.triangle.fill" :
                                                        "checkmark.circle.fill")
                                                    .foregroundColor(mismatch ? .orange : .green)

                                                VStack(alignment: .leading, spacing: 2) {
                                                    if mismatch {
                                                        Text(
                                                            "Running: \(actualIsPublic ? "Public access (Funnel)" : "Private access (Serve)")")
                                                            .font(.caption)
                                                            .foregroundColor(.secondary)

                                                        if let funnelError = tailscaleServeStatus.funnelError {
                                                            Text("Funnel failed: \(funnelError)")
                                                                .font(.caption2)
                                                                .foregroundColor(.orange)
                                                                .lineLimit(2)
                                                        } else {
                                                            Text(
                                                                "Applying \(desiredIsPublic ? "Public" : "Private") mode configuration...")
                                                                .font(.caption2)
                                                                .foregroundColor(.orange)
                                                        }

                                                        // Only show retry button if there's an actual error (not just a
                                                        // temporary mismatch)
                                                        if self.tailscaleServeStatus.lastError != nil {
                                                            Button(action: {
                                                                self.logger
                                                                    .info(
                                                                        "Retrying Tailscale configuration due to mismatch")
                                                                Task {
                                                                    // First refresh the status to see if it's resolved
                                                                    await self.tailscaleServeStatus
                                                                        .refreshStatusImmediately()

                                                                    // If still mismatched after refresh, restart the
                                                                    // server
                                                                    if let desired = tailscaleServeStatus.desiredMode,
                                                                       let actual = tailscaleServeStatus.actualMode,
                                                                       desired != actual
                                                                    {
                                                                        self.logger
                                                                            .info(
                                                                                "Mismatch persists after refresh, restarting server")
                                                                        await self.serverManager.restart()
                                                                    }
                                                                }
                                                            }, label: {
                                                                Label("Retry", systemImage: "arrow.clockwise")
                                                                    .font(.caption2)
                                                            })
                                                            .buttonStyle(.link)
                                                            .controlSize(.mini)
                                                        }
                                                    } else {
                                                        Text(
                                                            "Running: \(actualIsPublic ? "Public access (Funnel)" : "Private access (Serve)")")
                                                            .font(.caption)
                                                            .foregroundColor(.secondary)
                                                    }
                                                }
                                            }
                                        } else if self.tailscaleServeStatus.isPermanentlyDisabled {
                                            Image(systemName: "network")
                                                .foregroundColor(.blue)
                                            Text("Using direct Tailscale access on port \(self.serverPort)")
                                                .font(.caption)
                                                .foregroundColor(.secondary)
                                        } else if let error = tailscaleServeStatus.lastError {
                                            Image(systemName: "exclamationmark.triangle.fill")
                                                .foregroundColor(.orange)
                                            Text("Error: \(error)")
                                                .font(.caption)
                                                .foregroundColor(.orange)
                                                .lineLimit(2)
                                        } else {
                                            Image(systemName: "circle")
                                                .foregroundColor(.gray)
                                            Text("Starting...")
                                                .font(.caption)
                                                .foregroundColor(.secondary)
                                        }
                                    }

                                    // Info for public access - only show when Public (Internet) is selected
                                    if self.tailscaleFunnelEnabled {
                                        HStack(spacing: 6) {
                                            Image(systemName: "info.circle.fill")
                                                .foregroundColor(.blue)
                                                .font(.system(size: 12))
                                            Text("Your terminal will be accessible from the public internet")
                                                .font(.caption)
                                                .foregroundColor(.secondary)
                                        }
                                        .padding(.vertical, 4)
                                        .padding(.horizontal, 8)
                                        .background(Color.blue.opacity(0.1))
                                        .cornerRadius(4)
                                    }
                                }
                                .padding(.leading, 20)
                            }
                        }

                        // Show dashboard URL when running
                        if let hostname = tailscaleService.tailscaleHostname {
                            // Determine if we should show HTTPS URL
                            // Optimistically show HTTPS when Tailscale is enabled, even if still configuring
                            // Both Private and Public modes use HTTPS once Serve is running
                            let useHTTPS = self.tailscaleServeEnabled &&
                                (self.tailscaleServeStatus.isRunning ||
                                    // Show HTTPS during startup/configuration phase
                                    self.tailscaleServeStatus.lastError?.contains("starting up") == true ||
                                    // Or if modes match (indicating configuration is in progress)
                                    (self.tailscaleServeStatus.desiredMode != nil &&
                                        self.tailscaleServeStatus.desiredMode == self.tailscaleServeStatus.actualMode))

                            // Show both URLs when Funnel is enabled
                            if self.tailscaleFunnelEnabled, self.tailscaleServeStatus.isRunning,
                               self.tailscaleServeStatus
                                   .funnelEnabled
                            {
                                // Public (Internet) URL via Funnel
                                if let publicURL = URL(string: "https://\(hostname)") {
                                    InlineClickableURLView(
                                        label: "Public (Internet):",
                                        url: publicURL.absoluteString)
                                }

                                // Private (Tailnet) URL - use IP for direct access
                                if let tailscaleIP = TailscaleURLHelper.getTailscaleIP() {
                                    let privateURL = "http://\(tailscaleIP):\(serverPort)"
                                    InlineClickableURLView(
                                        label: "Private (Tailnet):",
                                        url: privateURL)
                                } else {
                                    // Fallback to hostname if IP not available
                                    let privateURL = "http://\(hostname):\(serverPort)"
                                    InlineClickableURLView(
                                        label: "Private (Tailnet):",
                                        url: privateURL)
                                }
                            } else {
                                // Single URL for non-Funnel modes
                                if let constructedURL = TailscaleURLHelper.constructURL(
                                    hostname: hostname,
                                    port: serverPort,
                                    isTailscaleServeEnabled: useHTTPS,
                                    isTailscaleServeRunning: useHTTPS,
                                    isFunnelEnabled: false, // Force private mode since Funnel not actually running
                                ) {
                                    InlineClickableURLView(
                                        label: "Access VibeTunnel at:",
                                        url: constructedURL.absoluteString)
                                } else {
                                    // Show placeholder when URL is nil
                                    HStack(spacing: 5) {
                                        Text("Access VibeTunnel at:")
                                            .font(.caption)
                                            .foregroundColor(.secondary)
                                        Text("Configuring...")
                                            .font(.caption)
                                            .foregroundColor(.orange)
                                    }
                                }
                            }

                            // Show warning if in localhost-only mode
                            if self.accessMode == .localhost, !self.tailscaleServeEnabled {
                                HStack(spacing: 6) {
                                    Image(systemName: "exclamationmark.triangle.fill")
                                        .foregroundColor(.orange)
                                        .font(.system(size: 12))
                                    Text(
                                        "Server is in localhost-only mode. Change to 'Network' mode above to access via Tailscale.")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }

                            // Help text about Tailscale Serve
                            if self.tailscaleServeEnabled, self.tailscaleServeStatus.isRunning {
                                Text(
                                    "Tailscale Serve provides secure access with automatic authentication using Tailscale identity headers.")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                                    .padding(.top, 4)
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
                "Recommended: Tailscale provides secure, private access to your terminal sessions from any device (including phones and tablets) without exposing VibeTunnel to the public internet.")
                .font(.caption)
                .frame(maxWidth: .infinity)
                .multilineTextAlignment(.center)
        }
        .task {
            // Check status when view appears - single check only
            // Ongoing status updates handled by TailscaleServeStatusService
            self.logger.info("TailscaleIntegrationSection: Performing initial status check")
            await self.tailscaleService.checkTailscaleStatus()
            self.logger
                .info(
                    "TailscaleIntegrationSection: Initial status check complete - isInstalled: \(self.tailscaleService.isInstalled), isRunning: \(self.tailscaleService.isRunning)")
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
                    Toggle("Enable ngrok tunnel", isOn: self.$ngrokEnabled)
                        .disabled(self.isStartingNgrok)
                        .onChange(of: self.ngrokEnabled) { _, newValue in
                            if newValue {
                                self.checkAndStartNgrok()
                            } else {
                                self.stopNgrok()
                            }
                        }

                    if self.isStartingNgrok {
                        ProgressView()
                            .scaleEffect(0.7)
                    } else if self.ngrokStatus != nil {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundColor(.green)
                        Text("Connected")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }

                // Auth token field
                AuthTokenField(
                    ngrokAuthToken: self.$ngrokAuthToken,
                    isTokenRevealed: self.$isTokenRevealed,
                    maskedToken: self.$maskedToken,
                    ngrokTokenPresent: self.$ngrokTokenPresent,
                    toggleTokenVisibility: self.toggleTokenVisibility,
                    ngrokService: self.ngrokService,
                    logger: self.logger)

                // Public URL display
                if let status = ngrokStatus {
                    InlineClickableURLView(
                        label: "Public URL:",
                        url: status.publicUrl)
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
                "ngrok creates secure public tunnels to access your terminal sessions from any device (including phones and tablets) via the internet.")
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
                if self.isTokenRevealed {
                    TextField("Auth Token", text: self.$ngrokAuthToken)
                        .textFieldStyle(.roundedBorder)
                        .focused(self.$isTokenFieldFocused)
                        .onSubmit {
                            self.saveToken()
                        }
                } else {
                    TextField("Auth Token", text: self.$maskedToken)
                        .textFieldStyle(.roundedBorder)
                        .disabled(true)
                        .foregroundColor(.secondary)
                }

                Button(action: self.toggleTokenVisibility) {
                    Image(systemName: self.isTokenRevealed ? "eye.slash" : "eye")
                }
                .buttonStyle(.borderless)
                .help(self.isTokenRevealed ? "Hide token" : "Show token")

                if self.isTokenRevealed, self.ngrokAuthToken != self.ngrokService.authToken || !self.ngrokTokenPresent {
                    Button("Save") {
                        self.saveToken()
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
        guard !self.ngrokAuthToken.isEmpty else {
            self.tokenSaveError = "Token cannot be empty"
            return
        }

        self.ngrokService.authToken = self.ngrokAuthToken
        if self.ngrokService.authToken != nil {
            self.ngrokTokenPresent = true
            self.tokenSaveError = nil
            self.isTokenRevealed = false
            self.maskedToken = String(repeating: "•", count: 12)
            self.logger.info("ngrok auth token saved successfully")
        } else {
            self.tokenSaveError = "Failed to save token to keychain"
            self.logger.error("Failed to save ngrok auth token to keychain")
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
            Text(self.error)
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
