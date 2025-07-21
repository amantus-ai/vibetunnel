import AppKit
import os.log
import SwiftUI

/// General settings tab for basic app preferences
struct GeneralSettingsView: View {
    @AppStorage("autostart")
    private var autostart = false
    @AppStorage("showNotifications")
    private var showNotifications = true
    @AppStorage(AppConstants.UserDefaultsKeys.updateChannel)
    private var updateChannelRaw = UpdateChannel.stable.rawValue
    @AppStorage(AppConstants.UserDefaultsKeys.showInDock)
    private var showInDock = true
    @AppStorage(AppConstants.UserDefaultsKeys.preventSleepWhenRunning)
    private var preventSleepWhenRunning = true
    @StateObject private var configManager = ConfigManager.shared
    @AppStorage(AppConstants.UserDefaultsKeys.serverPort)
    private var serverPort = "4020"
    @AppStorage(AppConstants.UserDefaultsKeys.dashboardAccessMode)
    private var accessModeString = AppConstants.Defaults.dashboardAccessMode

    @State private var isCheckingForUpdates = false
    @State private var localIPAddress: String?

    @Environment(ServerManager.self)
    private var serverManager

    private let startupManager = StartupManager()
    private let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "GeneralSettings")

    private var accessMode: DashboardAccessMode {
        DashboardAccessMode(rawValue: accessModeString) ?? .localhost
    }

    var updateChannel: UpdateChannel {
        UpdateChannel(rawValue: updateChannelRaw) ?? .stable
    }

    var body: some View {
        NavigationStack {
            Form {
                // Server Configuration section
                ServerConfigurationSection(
                    accessMode: accessMode,
                    accessModeString: $accessModeString,
                    serverPort: $serverPort,
                    localIPAddress: localIPAddress,
                    restartServerWithNewBindAddress: restartServerWithNewBindAddress,
                    restartServerWithNewPort: restartServerWithNewPort,
                    serverManager: serverManager
                )

                // CLI Installation section
                CLIInstallationSection()

                // Repository section
                RepositorySettingsSection(repositoryBasePath: .init(
                    get: { configManager.repositoryBasePath },
                    set: { configManager.updateRepositoryBasePath($0) }
                ))

                Section {
                    // Launch at Login
                    VStack(alignment: .leading, spacing: 4) {
                        Toggle("Launch at Login", isOn: launchAtLoginBinding)
                        Text("Automatically start VibeTunnel when you log into your Mac.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    // Show in Dock
                    VStack(alignment: .leading, spacing: 4) {
                        Toggle("Show in Dock", isOn: showInDockBinding)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Show VibeTunnel icon in the Dock.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text("The dock icon is always displayed when the Settings dialog is visible.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }

                    // Prevent Sleep
                    VStack(alignment: .leading, spacing: 4) {
                        Toggle("Prevent Sleep When Running", isOn: $preventSleepWhenRunning)
                        Text("Keep your Mac awake while VibeTunnel sessions are active.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                } header: {
                    Text("Application")
                        .font(.headline)
                }
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
            .navigationTitle("General Settings")
        }
        .task {
            // Sync launch at login status
            autostart = startupManager.isLaunchAtLoginEnabled

            // Update local IP address
            updateLocalIPAddress()
        }
        .onAppear {
            updateLocalIPAddress()
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

    private var showInDockBinding: Binding<Bool> {
        Binding(
            get: { showInDock },
            set: { newValue in
                showInDock = newValue
                // Don't change activation policy while settings window is open
                // The change will be applied when the settings window closes
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
