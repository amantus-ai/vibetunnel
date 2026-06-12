import AppKit
import os.log
import SwiftUI

// MARK: - Server Configuration Section

struct ServerConfigurationSection: View {
    let accessMode: DashboardAccessMode
    @Binding var accessModeString: String
    @Binding var serverPort: String
    let restartServerWithNewBindAddress: (DashboardAccessMode, String?) -> Void
    let restartServerWithNewPort: (Int) -> Void
    let serverManager: ServerManager

    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: 12) {
                AccessModeView(
                    accessMode: self.accessMode,
                    accessModeString: self.$accessModeString,
                    restartServerWithNewBindAddress: self.restartServerWithNewBindAddress)

                PortConfigurationView(
                    serverPort: self.$serverPort,
                    restartServerWithNewPort: self.restartServerWithNewPort,
                    serverManager: self.serverManager)
            }
        } header: {
            Text("Server Configuration")
                .font(.headline)
        } footer: {
            if let url = serverManager.dashboardURL() {
                HStack(spacing: 5) {
                    Text("Dashboard available at")
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    Link(url.absoluteString, destination: url)
                        .font(.caption)
                        .foregroundStyle(.blue)
                }
                .frame(maxWidth: .infinity)
                .multilineTextAlignment(.center)
            }
        }
    }
}

// MARK: - Access Mode View

struct AccessModeView: View {
    let accessMode: DashboardAccessMode
    @Binding var accessModeString: String
    let restartServerWithNewBindAddress: (DashboardAccessMode, String?) -> Void

    @AppStorage(AppConstants.UserDefaultsKeys.tailscaleServeEnabled)
    private var tailscaleServeEnabled = false
    @AppStorage(AppConstants.UserDefaultsKeys.customBindAddress)
    private var customBindAddress = ""

    @Environment(TailscaleService.self)
    private var tailscaleService
    @Environment(TailscaleServeStatusService.self)
    private var tailscaleServeStatus

    @FocusState private var isCustomAddressFieldFocused: Bool
    @State private var pendingAccessMode: DashboardAccessMode?
    @State private var pendingCustomAddress = ""
    @State private var customAddressError: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Access Mode")
                    .font(.callout)
                Spacer()

                if self.shouldLockToLocalhost {
                    // Only lock when Tailscale Serve is actually working
                    Text("Localhost")
                        .foregroundColor(.secondary)

                    Image(systemName: "lock.shield.fill")
                        .foregroundColor(.blue)
                        .help("Tailscale Serve active - locked to localhost for security")
                } else {
                    Picker("", selection: self.accessModeSelection) {
                        ForEach(DashboardAccessMode.allCases, id: \.rawValue) { mode in
                            Text(mode.displayName)
                                .tag(mode.rawValue)
                        }
                    }
                    .labelsHidden()
                }
            }

            if self.displayedAccessMode == .custom, !self.shouldLockToLocalhost {
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text("Bind Address")
                            .font(.callout)
                        Spacer()
                        TextField("127.0.0.1 or ::", text: self.$pendingCustomAddress)
                            .textFieldStyle(.roundedBorder)
                            .frame(width: 180)
                            .font(.system(.body, design: .monospaced))
                            .focused(self.$isCustomAddressFieldFocused)
                            .onSubmit {
                                self.validateAndApplyCustomAddress()
                            }
                            .onAppear {
                                self.pendingCustomAddress = self.customBindAddress
                            }
                            .onChange(of: self.pendingCustomAddress) { _, _ in
                                self.customAddressError = nil
                            }

                        Button("Apply") {
                            self.validateAndApplyCustomAddress()
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                        .disabled(self.pendingCustomAddress.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }

                    Text("Use :: to listen on both IPv6 and IPv4.")
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    if let customAddressError {
                        Label(customAddressError, systemImage: "exclamationmark.triangle.fill")
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
                }
            }

            // Show warning when Tailscale Serve is enabled but not working
            if self.tailscaleServeEnabled, !self.shouldLockToLocalhost {
                HStack(spacing: 4) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundColor(.orange)
                        .font(.caption)
                    Text("Tailscale Serve enabled but not active - using selected access mode")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }

            // Show info when Tailscale Serve is active and locked
            if self.shouldLockToLocalhost, self.displayedAccessMode != .localhost {
                HStack(spacing: 4) {
                    Image(systemName: "info.circle.fill")
                        .foregroundColor(.blue)
                        .font(.caption)
                    Text("Tailscale Serve active - using localhost binding for security")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
        }
    }

    /// Only lock to localhost when Tailscale Serve is enabled AND actually working
    private var shouldLockToLocalhost: Bool {
        self.tailscaleServeEnabled &&
            self.tailscaleService.isRunning &&
            self.tailscaleServeStatus.isRunning
    }

    private var displayedAccessMode: DashboardAccessMode {
        self.pendingAccessMode ?? self.accessMode
    }

    private var accessModeSelection: Binding<String> {
        Binding(
            get: { self.displayedAccessMode.rawValue },
            set: { rawValue in
                guard let mode = DashboardAccessMode(rawValue: rawValue) else {
                    return
                }

                if mode == .custom {
                    self.pendingAccessMode = .custom
                    self.pendingCustomAddress = self.customBindAddress
                    self.customAddressError = nil
                } else {
                    self.pendingAccessMode = nil
                    self.accessModeString = mode.rawValue
                    self.restartServerWithNewBindAddress(mode, nil)
                }
            })
    }

    private func validateAndApplyCustomAddress() {
        let address = self.pendingCustomAddress.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let bindAddress = ServerBindAddress(address) else {
            self.customAddressError = if address.hasPrefix("[") || address.hasSuffix("]") {
                "Enter IPv6 addresses without brackets."
            } else {
                "Enter a valid IPv4 or IPv6 address."
            }
            self.isCustomAddressFieldFocused = true
            return
        }

        self.pendingCustomAddress = bindAddress.value
        self.customBindAddress = bindAddress.value
        self.accessModeString = DashboardAccessMode.custom.rawValue
        self.pendingAccessMode = nil
        self.customAddressError = nil
        self.restartServerWithNewBindAddress(.custom, bindAddress.value)
    }
}

// MARK: - Port Configuration View

struct PortConfigurationView: View {
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
                    TextField("", text: self.$pendingPort)
                        .textFieldStyle(.roundedBorder)
                        .frame(width: 80)
                        .multilineTextAlignment(.center)
                        .focused(self.$isPortFieldFocused)
                        .onSubmit {
                            self.validateAndUpdatePort()
                        }
                        .onAppear {
                            self.pendingPort = self.serverPort
                        }
                        .onChange(of: self.pendingPort) { _, newValue in
                            // Clear error when user types
                            self.portError = nil
                            // Limit to 5 digits
                            if newValue.count > 5 {
                                self.pendingPort = String(newValue.prefix(5))
                            }
                        }

                    VStack(spacing: 0) {
                        Button(action: {
                            if let port = Int(pendingPort), port < 65535 {
                                self.pendingPort = String(port + 1)
                                self.validateAndUpdatePort()
                            }
                        }, label: {
                            Image(systemName: "chevron.up")
                                .font(.system(size: 10))
                                .frame(width: 16, height: 11)
                        })
                        .buttonStyle(.borderless)

                        Button(action: {
                            if let port = Int(pendingPort), port > 1024 {
                                self.pendingPort = String(port - 1)
                                self.validateAndUpdatePort()
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
            self.portError = "Invalid port number"
            self.pendingPort = self.serverPort
            return
        }

        guard port >= 1024, port <= 65535 else {
            self.portError = "Port must be between 1024 and 65535"
            self.pendingPort = self.serverPort
            return
        }

        if String(port) != self.serverPort {
            self.restartServerWithNewPort(port)
            self.serverPort = String(port)
        }
    }
}

// MARK: - Server Configuration Helpers

@MainActor
enum ServerConfigurationHelpers {
    private static let logger = Logger(subsystem: BundleIdentifiers.loggerSubsystem, category: "ServerConfiguration")

    static func restartServerWithNewPort(_ port: Int, serverManager: ServerManager) async {
        // Update the port in ServerManager and restart
        serverManager.port = String(port)
        await serverManager.restart()
        self.logger.info("Server restarted on port \(port)")

        // Wait for server to be fully ready before restarting session monitor
        try? await Task.sleep(for: .seconds(1))

        // Session monitoring will automatically detect the port change
    }

    static func restartServerWithNewBindAddress(
        accessMode: DashboardAccessMode,
        customAddress: String? = nil,
        serverManager: ServerManager)
        async
    {
        guard serverManager.updateBindConfiguration(mode: accessMode, customAddress: customAddress) else {
            self.logger.error("Rejected invalid bind configuration")
            return
        }

        self.logger
            .info(
                "Restarting server due to access mode change: \(accessMode.displayName) -> \(serverManager.bindAddress)")
        await serverManager.restart()
        self.logger.info("Server restarted with bind address \(serverManager.bindAddress)")

        // Wait for server to be fully ready before restarting session monitor
        try? await Task.sleep(for: .seconds(1))

        // Session monitoring will automatically detect the bind address change
    }

    static func updateLocalIPAddress(accessMode: DashboardAccessMode) async -> String? {
        if accessMode == .network {
            NetworkUtility.getLocalIPAddress()
        } else {
            nil
        }
    }
}
