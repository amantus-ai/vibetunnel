import SwiftUI
import os.log

/// General settings tab for basic app preferences
struct GeneralSettingsView: View {
    @AppStorage("autostart")
    private var autostart = false
    @AppStorage("showNotifications")
    private var showNotifications = true
    @AppStorage(AppConstants.UserDefaultsKeys.updateChannel)
    private var updateChannelRaw = UpdateChannel.stable.rawValue
    @AppStorage(AppConstants.UserDefaultsKeys.preventSleepWhenRunning)
    private var preventSleepWhenRunning = true
    @AppStorage(AppConstants.UserDefaultsKeys.serverPort)
    private var serverPort = "4020"
    @AppStorage(AppConstants.UserDefaultsKeys.dashboardAccessMode)
    private var accessModeString = DashboardAccessMode.network.rawValue

    @State private var isCheckingForUpdates = false
    @State private var localIPAddress: String?
    @State private var showingServerErrorAlert = false
    @State private var serverErrorMessage = ""

    @Environment(ServerManager.self)
    private var serverManager

    private let startupManager = StartupManager()
    private let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "GeneralSettings")

    var updateChannel: UpdateChannel {
        UpdateChannel(rawValue: updateChannelRaw) ?? .stable
    }

    private var accessMode: DashboardAccessMode {
        DashboardAccessMode(rawValue: accessModeString) ?? .localhost
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    // Launch at Login
                    VStack(alignment: .leading, spacing: 4) {
                        Toggle("Launch at Login", isOn: launchAtLoginBinding)
                        Text("Automatically start VibeTunnel when you log into your Mac.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    // Prevent Sleep
                    VStack(alignment: .leading, spacing: 4) {
                        Toggle("Prevent Sleep When Running", isOn: $preventSleepWhenRunning)
                        Text("Keep your Mac awake while VibeTunnel sessions are active.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    // Screen sharing service
                    VStack(alignment: .leading, spacing: 4) {
                        Toggle("Enable screen sharing service", isOn: .init(
                            get: { AppConstants.boolValue(for: AppConstants.UserDefaultsKeys.enableScreencapService) },
                            set: { UserDefaults.standard.set(
                                $0,
                                forKey: AppConstants.UserDefaultsKeys.enableScreencapService
                            )
                            }
                        ))
                        Text("Allow screen sharing feature in the web interface.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                } header: {
                    Text("Application")
                        .font(.headline)
                }

                Section {
                    // Update Channel
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text("Update Channel")
                            Spacer()
                            Picker("", selection: updateChannelBinding) {
                                ForEach(UpdateChannel.allCases) { channel in
                                    Text(channel.displayName).tag(channel)
                                }
                            }
                            .pickerStyle(.menu)
                            .labelsHidden()
                        }
                        Text(updateChannel.description)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    // Check for Updates
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Check for Updates")
                            Text("Check for new versions of VibeTunnel.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }

                        Spacer()

                        Button("Check Now") {
                            checkForUpdates()
                        }
                        .buttonStyle(.bordered)
                        .disabled(isCheckingForUpdates)
                    }
                } header: {
                    Text("Updates")
                        .font(.headline)
                }

                ServerConfigurationSection(
                    accessMode: accessMode,
                    accessModeString: $accessModeString,
                    serverPort: $serverPort,
                    localIPAddress: localIPAddress,
                    restartServerWithNewBindAddress: restartServerWithNewBindAddress,
                    restartServerWithNewPort: restartServerWithNewPort,
                    serverManager: serverManager
                )
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
            .navigationTitle("General Settings")
        }
        .task {
            // Sync launch at login status
            autostart = startupManager.isLaunchAtLoginEnabled
        }
        .onAppear {
            updateLocalIPAddress()
        }
        .alert("Failed to Restart Server", isPresented: $showingServerErrorAlert) {
            Button("OK") {}
        } message: {
            Text(serverErrorMessage)
        }
    }

    private var launchAtLoginBinding: Binding<Bool> {
        Binding(
            get: { autostart },
            set: { newValue in
                autostart = newValue
                startupManager.setLaunchAtLogin(enabled: newValue)
            }
        )
    }

    private var updateChannelBinding: Binding<UpdateChannel> {
        Binding(
            get: { updateChannel },
            set: { newValue in
                updateChannelRaw = newValue.rawValue
                // Notify the updater manager about the channel change
                NotificationCenter.default.post(
                    name: Notification.Name("UpdateChannelChanged"),
                    object: nil,
                    userInfo: ["channel": newValue]
                )
            }
        )
    }

    private func checkForUpdates() {
        isCheckingForUpdates = true
        NotificationCenter.default.post(name: Notification.Name("checkForUpdates"), object: nil)

        // Reset after a delay
        Task {
            try? await Task.sleep(for: .seconds(2))
            isCheckingForUpdates = false
        }
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
