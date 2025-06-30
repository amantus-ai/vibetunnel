import SwiftUI

/// General settings tab for basic app preferences
struct GeneralSettingsView: View {
    @AppStorage("autostart")
    private var autostart = false
    @AppStorage("showNotifications")
    private var showNotifications = true
    @AppStorage("updateChannel")
    private var updateChannelRaw = UpdateChannel.stable.rawValue
    @AppStorage("preventSleepWhenRunning")
    private var preventSleepWhenRunning = true

    @State private var isCheckingForUpdates = false

    private let startupManager = StartupManager()

    var updateChannel: UpdateChannel {
        UpdateChannel(rawValue: updateChannelRaw) ?? .stable
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

                // Permissions Section
                PermissionsSection()
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
            .navigationTitle("General Settings")
        }
        .task {
            // Sync launch at login status
            autostart = startupManager.isLaunchAtLoginEnabled
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
}

// MARK: - Permissions Section

private struct PermissionsSection: View {
    @Environment(SystemPermissionManager.self)
    private var permissionManager
    @State private var permissionUpdateTrigger = 0

    // IMPORTANT: These computed properties ensure the UI always shows current permission state.
    // The permissionUpdateTrigger dependency forces SwiftUI to re-evaluate these properties
    // when permissions change. Without this, the UI would not update when permissions are
    // granted in System Settings while this view is visible.
    //
    // We use computed properties instead of @State to avoid UI flashing - the initial
    // permission check in .task happens before the first render, ensuring correct state
    // from the start.
    private var hasAppleScriptPermission: Bool {
        _ = permissionUpdateTrigger
        return permissionManager.hasPermission(.appleScript)
    }

    private var hasAccessibilityPermission: Bool {
        _ = permissionUpdateTrigger
        return permissionManager.hasPermission(.accessibility)
    }

    var body: some View {
        Section {
            // Automation permission
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Terminal Automation")
                        .font(.body)
                    Text("Required to launch and control terminal applications.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                if hasAppleScriptPermission {
                    HStack {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundColor(.green)
                        Text("Granted")
                            .foregroundColor(.secondary)
                    }
                    .font(.caption)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 2)
                    .frame(height: 22) // Match small button height
                } else {
                    Button("Grant Permission") {
                        permissionManager.requestPermission(.appleScript)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }
            }

            // Accessibility permission
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Accessibility")
                        .font(.body)
                    Text("Required to enter terminal startup commands.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                if hasAccessibilityPermission {
                    HStack {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundColor(.green)
                        Text("Granted")
                            .foregroundColor(.secondary)
                    }
                    .font(.caption)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 2)
                    .frame(height: 22) // Match small button height
                } else {
                    Button("Grant Permission") {
                        permissionManager.requestPermission(.accessibility)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }
            }
        } header: {
            Text("Permissions")
                .font(.headline)
        } footer: {
            if hasAppleScriptPermission && hasAccessibilityPermission {
                Text(
                    "All permissions granted. New sessions will spawn new terminal windows."
                )
                .font(.caption)
                .frame(maxWidth: .infinity)
                .multilineTextAlignment(.center)
                .foregroundColor(.green)
            } else {
                Text(
                    "Terminals can be captured without permissions, however new sessions won't load."
                )
                .font(.caption)
                .frame(maxWidth: .infinity)
                .multilineTextAlignment(.center)
            }
        }
        .task {
            // Check permissions before first render to avoid UI flashing
            await permissionManager.checkAllPermissions()

            // Register for continuous monitoring
            permissionManager.registerForMonitoring()
        }
        .onDisappear {
            permissionManager.unregisterFromMonitoring()
        }
        .onReceive(NotificationCenter.default.publisher(for: .permissionsUpdated)) { _ in
            // Increment trigger to force computed property re-evaluation
            permissionUpdateTrigger += 1
        }
    }
}
