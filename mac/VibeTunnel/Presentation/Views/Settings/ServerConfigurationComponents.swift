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

struct AccessModeView: View {
    let accessMode: DashboardAccessMode
    @Binding var accessModeString: String
    let serverPort: String
    let localIPAddress: String?
    let restartServerWithNewBindAddress: () -> Void

    @AppStorage(AppConstants.UserDefaultsKeys.tailscaleServeEnabled)
    private var tailscaleServeEnabled = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Access Mode")
                    .font(.callout)
                Spacer()

                if tailscaleServeEnabled {
                    // When Tailscale Serve is enabled, force localhost mode
                    Text("Localhost")
                        .foregroundColor(.secondary)

                    Image(systemName: "lock.shield.fill")
                        .foregroundColor(.blue)
                        .help("Tailscale Serve requires localhost binding for security")
                } else {
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

            if tailscaleServeEnabled && accessMode == .network {
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

// MARK: - Server Configuration Helpers

@MainActor
enum ServerConfigurationHelpers {
    private static let logger = Logger(subsystem: BundleIdentifiers.loggerSubsystem, category: "ServerConfiguration")

    static func restartServerWithNewPort(_ port: Int, serverManager: ServerManager) async {
        // Update the port in ServerManager and restart
        serverManager.port = String(port)
        await serverManager.restart()
        logger.info("Server restarted on port \(port)")

        // Wait for server to be fully ready before restarting session monitor
        try? await Task.sleep(for: .seconds(1))

        // Session monitoring will automatically detect the port change
    }

    static func restartServerWithNewBindAddress(accessMode: DashboardAccessMode, serverManager: ServerManager) async {
        // Restart server to pick up the new bind address from UserDefaults
        // (accessModeString is already persisted via @AppStorage)
        logger
            .info(
                "Restarting server due to access mode change: \(accessMode.displayName) -> \(accessMode.bindAddress)"
            )
        await serverManager.restart()
        logger.info("Server restarted with bind address \(accessMode.bindAddress)")

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
