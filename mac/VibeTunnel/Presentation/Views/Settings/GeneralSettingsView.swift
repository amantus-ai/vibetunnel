import AppKit
import os.log
import SwiftUI

/// General settings tab for basic app preferences
struct GeneralSettingsView: View {
    @AppStorage("autostart")
    private var autostart = false
    @AppStorage(AppConstants.UserDefaultsKeys.updateChannel)
    private var updateChannelRaw = UpdateChannel.stable.rawValue
    @AppStorage(AppConstants.UserDefaultsKeys.showInDock)
    private var showInDock = true
    @AppStorage(AppConstants.UserDefaultsKeys.preventSleepWhenRunning)
    private var preventSleepWhenRunning = true

    @Environment(ConfigManager.self) private var configManager
    @Environment(SystemPermissionManager.self) private var permissionManager

    @State private var isCheckingForUpdates = false
    @State private var permissionUpdateTrigger = 0

    private let startupManager = StartupManager()
    private let logger = Logger(subsystem: BundleIdentifiers.loggerSubsystem, category: "GeneralSettings")

    var updateChannel: UpdateChannel {
        UpdateChannel(rawValue: self.updateChannelRaw) ?? .stable
    }

    // MARK: - Helper Properties

    // IMPORTANT: These computed properties ensure the UI always shows current permission state.
    // The permissionUpdateTrigger dependency forces SwiftUI to re-evaluate these properties
    // when permissions change. Without this, the UI would not update when permissions are
    // granted in System Settings while this view is visible.
    private var hasAppleScriptPermission: Bool {
        _ = self.permissionUpdateTrigger
        return self.permissionManager.hasPermission(.appleScript)
    }

    private var hasAccessibilityPermission: Bool {
        _ = self.permissionUpdateTrigger
        return self.permissionManager.hasPermission(.accessibility)
    }

    var body: some View {
        NavigationStack {
            Form {
                // CLI Installation section
                CLIInstallationSection()

                // Repository section
                RepositorySettingsSection(repositoryBasePath: .init(
                    get: { self.configManager.repositoryBasePath },
                    set: { self.configManager.updateRepositoryBasePath($0) }))

                Section {
                    // Launch at Login
                    VStack(alignment: .leading, spacing: 4) {
                        Toggle("Launch at Login", isOn: self.launchAtLoginBinding)
                        Text("Automatically start VibeTunnel when you log into your Mac.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    // Show in Dock
                    VStack(alignment: .leading, spacing: 4) {
                        Toggle("Show in Dock", isOn: self.showInDockBinding)
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
                        Toggle("Prevent Sleep When Running", isOn: self.$preventSleepWhenRunning)
                        Text("Keep your Mac awake while VibeTunnel sessions are active.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                } header: {
                    Text("Application")
                        .font(.headline)
                }

                // System Permissions section (moved from Security)
                PermissionsSection(
                    hasAppleScriptPermission: self.hasAppleScriptPermission,
                    hasAccessibilityPermission: self.hasAccessibilityPermission,
                    permissionManager: self.permissionManager)
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
            .navigationTitle("General Settings")
        }
        .task {
            // Sync launch at login status
            self.autostart = self.startupManager.isLaunchAtLoginEnabled
            // Check permissions before first render to avoid UI flashing
            await self.permissionManager.checkAllPermissions()
        }
        .onAppear {
            // Register for continuous monitoring
            self.permissionManager.registerForMonitoring()
        }
        .onDisappear {
            self.permissionManager.unregisterFromMonitoring()
        }
        .onReceive(NotificationCenter.default.publisher(for: .permissionsUpdated)) { _ in
            // Increment trigger to force computed property re-evaluation
            self.permissionUpdateTrigger += 1
        }
    }

    private var launchAtLoginBinding: Binding<Bool> {
        Binding(
            get: { self.autostart },
            set: { newValue in
                self.autostart = newValue
                self.startupManager.setLaunchAtLogin(enabled: newValue)
            })
    }

    private var showInDockBinding: Binding<Bool> {
        Binding(
            get: { self.showInDock },
            set: { newValue in
                self.showInDock = newValue
                // Don't change activation policy while settings window is open
                // The change will be applied when the settings window closes
            })
    }

    private var updateChannelBinding: Binding<UpdateChannel> {
        Binding(
            get: { self.updateChannel },
            set: { newValue in
                self.updateChannelRaw = newValue.rawValue
                // Notify the updater manager about the channel change
                NotificationCenter.default.post(
                    name: Notification.Name("UpdateChannelChanged"),
                    object: nil,
                    userInfo: ["channel": newValue])
            })
    }

    private func checkForUpdates() {
        self.isCheckingForUpdates = true
        NotificationCenter.default.post(name: Notification.Name("checkForUpdates"), object: nil)

        // Reset after a delay
        Task {
            try? await Task.sleep(for: .seconds(2))
            self.isCheckingForUpdates = false
        }
    }
}
