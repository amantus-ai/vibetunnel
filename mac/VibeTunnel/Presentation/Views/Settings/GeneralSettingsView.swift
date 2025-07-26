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

    @Environment(ConfigManager.self) private var configManager
    @AppStorage(AppConstants.UserDefaultsKeys.serverPort)
    private var serverPort = "4020"
    @AppStorage(AppConstants.UserDefaultsKeys.dashboardAccessMode)
    private var accessModeString = AppConstants.Defaults.dashboardAccessMode

    @State private var isCheckingForUpdates = false
    @State private var localIPAddress: String?

    @Environment(ServerManager.self)
    private var serverManager

    private let startupManager = StartupManager()
    private let logger = Logger(subsystem: BundleIdentifiers.loggerSubsystem, category: "GeneralSettings")

    private var accessMode: DashboardAccessMode {
        DashboardAccessMode(rawValue: accessModeString) ?? .localhost
    }

    var updateChannel: UpdateChannel {
        UpdateChannel(rawValue: updateChannelRaw) ?? .stable
    }

    private func updateNotificationPreferences() {
        // Load current preferences from ConfigManager and notify the service
        let prefs = NotificationService.NotificationPreferences(fromConfig: configManager)
        NotificationService.shared.updatePreferences(prefs)
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

                    // Show Session Notifications
                    VStack(alignment: .leading, spacing: 4) {
                        Toggle("Show Session Notifications", isOn: $showNotifications)
                            .onChange(of: showNotifications) { _, newValue in
                                // Ensure NotificationService starts/stops based on the toggle
                                if newValue {
                                    Task {
                                        // Request permissions and show test notification
                                        let granted = await NotificationService.shared
                                            .requestPermissionAndShowTestNotification()

                                        if granted {
                                            await NotificationService.shared.start()
                                        } else {
                                            // If permission denied, turn toggle back off
                                            await MainActor.run {
                                                showNotifications = false

                                                // Show alert explaining the situation
                                                let alert = NSAlert()
                                                alert.messageText = "Notification Permission Required"
                                                alert.informativeText = "VibeTunnel needs permission to show notifications. Please enable notifications for VibeTunnel in System Settings."
                                                alert.alertStyle = .informational
                                                alert.addButton(withTitle: "Open System Settings")
                                                alert.addButton(withTitle: "Cancel")

                                                if alert.runModal() == .alertFirstButtonReturn {
                                                    // Settings will already be open from the service
                                                }
                                            }
                                        }
                                    }
                                } else {
                                    NotificationService.shared.stop()
                                }
                            }
                        Text("Display native macOS notifications for session and command events.")
                            .font(.caption)
                            .foregroundStyle(.secondary)

                        if showNotifications {
                            VStack(alignment: .leading, spacing: 6) {
                                Text("Notify me for:")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .padding(.leading, 20)
                                    .padding(.top, 4)

                                VStack(alignment: .leading, spacing: 4) {
                                    Toggle("Session starts", isOn: Binding(
                                        get: { configManager.notificationSessionStart },
                                        set: { newValue in
                                            configManager.notificationSessionStart = newValue
                                            updateNotificationPreferences()
                                        }
                                    ))
                                    .toggleStyle(.checkbox)

                                    Toggle("Session ends", isOn: Binding(
                                        get: { configManager.notificationSessionExit },
                                        set: { newValue in
                                            configManager.notificationSessionExit = newValue
                                            updateNotificationPreferences()
                                        }
                                    ))
                                    .toggleStyle(.checkbox)

                                    Toggle("Commands complete (> 3 seconds)", isOn: Binding(
                                        get: { configManager.notificationCommandCompletion },
                                        set: { newValue in
                                            configManager.notificationCommandCompletion = newValue
                                            updateNotificationPreferences()
                                        }
                                    ))
                                    .toggleStyle(.checkbox)

                                    Toggle("Commands fail", isOn: Binding(
                                        get: { configManager.notificationCommandError },
                                        set: { newValue in
                                            configManager.notificationCommandError = newValue
                                            updateNotificationPreferences()
                                        }
                                    ))
                                    .toggleStyle(.checkbox)

                                    Toggle("Terminal bell (\u{0007})", isOn: Binding(
                                        get: { configManager.notificationBell },
                                        set: { newValue in
                                            configManager.notificationBell = newValue
                                            updateNotificationPreferences()
                                        }
                                    ))
                                    .toggleStyle(.checkbox)

                                    Toggle("Claude turn notifications", isOn: Binding(
                                        get: { configManager.notificationClaudeTurn },
                                        set: { newValue in
                                            configManager.notificationClaudeTurn = newValue
                                            updateNotificationPreferences()
                                        }
                                    ))
                                    .toggleStyle(.checkbox)
                                }
                                .padding(.leading, 20)
                            }
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
