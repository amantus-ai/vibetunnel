import AppKit
import os.log
import SwiftUI

// MARK: - Server Configuration Section

struct ServerConfigurationSection: View {
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
                    accessMode: self.accessMode,
                    accessModeString: self.$accessModeString,
                    serverPort: self.serverPort,
                    localIPAddress: self.localIPAddress,
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
            // Dashboard URL display
            if self.accessMode == .localhost {
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
            } else if self.accessMode == .network {
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

struct AccessModeView: View {
    let accessMode: DashboardAccessMode
    @Binding var accessModeString: String
    let serverPort: String
    let localIPAddress: String?
    let restartServerWithNewBindAddress: () -> Void

    @AppStorage(AppConstants.UserDefaultsKeys.tailscaleServeEnabled)
    private var tailscaleServeEnabled = false

    @Environment(TailscaleService.self)
    private var tailscaleService
    @Environment(TailscaleServeStatusService.self)
    private var tailscaleServeStatus

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
                    Picker("", selection: self.$accessModeString) {
                        ForEach(DashboardAccessMode.allCases, id: \.rawValue) { mode in
                            Text(mode.displayName)
                                .tag(mode.rawValue)
                        }
                    }
                    .labelsHidden()
                    .onChange(of: self.accessModeString) { _, _ in
                        self.restartServerWithNewBindAddress()
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
            if self.shouldLockToLocalhost, self.accessMode == .network {
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

    static func restartServerWithNewBindAddress(accessMode: DashboardAccessMode, serverManager: ServerManager) async {
        // Restart server to pick up the new bind address from UserDefaults
        // (accessModeString is already persisted via @AppStorage)
        self.logger
            .info(
                "Restarting server due to access mode change: \(accessMode.displayName) -> \(accessMode.bindAddress)")
        await serverManager.restart()
        self.logger.info("Server restarted with bind address \(accessMode.bindAddress)")

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
