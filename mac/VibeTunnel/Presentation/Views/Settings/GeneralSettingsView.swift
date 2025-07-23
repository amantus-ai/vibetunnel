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

    private func updateNotificationPreferences() {
        // Load current preferences and notify the service
        let prefs = NotificationService.NotificationPreferences()
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

                    // Show Session Notifications
                    VStack(alignment: .leading, spacing: 4) {
                        Toggle("Show Session Notifications", isOn: $showNotifications)
                            .onChange(of: showNotifications) { _, newValue in
                                // Ensure NotificationService starts/stops based on the toggle
                                if newValue {
                                    Task {
                                        // Request permissions and show test notification
                                        let granted = await NotificationService.shared.requestPermissionAndShowTestNotification()
                                        
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
                                    NotificationCheckbox(
                                        title: "Session starts",
                                        key: "notifications.sessionStart",
                                        updateAction: updateNotificationPreferences
                                    )

                                    NotificationCheckbox(
                                        title: "Session ends",
                                        key: "notifications.sessionExit",
                                        updateAction: updateNotificationPreferences
                                    )

                                    NotificationCheckbox(
                                        title: "Commands complete (> 3 seconds)",
                                        key: "notifications.commandCompletion",
                                        updateAction: updateNotificationPreferences
                                    )

                                    NotificationCheckbox(
                                        title: "Commands fail",
                                        key: "notifications.commandError",
                                        updateAction: updateNotificationPreferences
                                    )

                                    NotificationCheckbox(
                                        title: "Terminal bell (\u{0007})",
                                        key: "notifications.bell",
                                        updateAction: updateNotificationPreferences
                                    )
                                }
                                .padding(.leading, 20)
                            }
                        }
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

// MARK: - Notification Checkbox Component

private struct NotificationCheckbox: View {
    let title: String
    let key: String
    let updateAction: () -> Void

    @State private var isChecked: Bool

    init(title: String, key: String, updateAction: @escaping () -> Void) {
        self.title = title
        self.key = key
        self.updateAction = updateAction
        self._isChecked = State(initialValue: UserDefaults.standard.bool(forKey: key))
    }

    var body: some View {
        Button(action: toggleCheck) {
            HStack(spacing: 6) {
                Image(systemName: isChecked ? "checkmark.square.fill" : "square")
                    .foregroundStyle(isChecked ? Color.accentColor : Color.secondary)
                    .font(.system(size: 14))
                    .animation(.easeInOut(duration: 0.15), value: isChecked)

                Text(title)
                    .font(.system(size: 12))
                    .foregroundStyle(.primary)

                Spacer()
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onAppear {
            // Sync with UserDefaults on appear
            isChecked = UserDefaults.standard.bool(forKey: key)
        }
    }

    private func toggleCheck() {
        // If enabling any notification checkbox and main notifications are off, request permissions first
        if !isChecked && !UserDefaults.standard.bool(forKey: "showNotifications") {
            Task { @MainActor in
                // Request permissions and enable main toggle
                let granted = await NotificationService.shared.requestPermissionAndShowTestNotification()
                
                if granted {
                    // Enable main notifications toggle
                    UserDefaults.standard.set(true, forKey: "showNotifications")
                    
                    // Enable this specific checkbox
                    isChecked = true
                    UserDefaults.standard.set(isChecked, forKey: key)
                    updateAction()
                    
                    // Start notification service
                    await NotificationService.shared.start()
                } else {
                    // Show alert if permission was denied
                    let alert = NSAlert()
                    alert.messageText = "Notification Permission Required"
                    alert.informativeText = "VibeTunnel needs permission to show notifications. Please enable notifications for VibeTunnel in System Settings."
                    alert.alertStyle = .informational
                    alert.addButton(withTitle: "OK")
                    alert.runModal()
                }
            }
        } else {
            // Normal toggle behavior
            isChecked.toggle()
            UserDefaults.standard.set(isChecked, forKey: key)
            updateAction()
        }
    }
}
