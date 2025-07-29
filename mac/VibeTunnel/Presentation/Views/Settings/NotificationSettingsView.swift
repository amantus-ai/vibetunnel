import AppKit
import os.log
import SwiftUI

private let logger = Logger(subsystem: BundleIdentifiers.loggerSubsystem, category: "NotificationSettings")

/// Settings view for managing notification preferences
struct NotificationSettingsView: View {
    @AppStorage("showNotifications")
    private var showNotifications = true

    @Environment(ConfigManager.self) private var configManager
    @Environment(NotificationService.self) private var notificationService

    @State private var isTestingNotification = false
    @State private var showingPermissionAlert = false
    @State private var sseConnectionStatus = false

    private func updateNotificationPreferences() {
        // Load current preferences from ConfigManager and notify the service
        let prefs = NotificationService.NotificationPreferences(fromConfig: configManager)
        notificationService.updatePreferences(prefs)
        // Also update the enabled state in ConfigManager
        configManager.notificationsEnabled = showNotifications
    }

    var body: some View {
        NavigationStack {
            @Bindable var bindableConfig = configManager
            
            Form {
                // Master toggle section
                Section {
                    VStack(alignment: .leading, spacing: 12) {
                        Toggle("Show Session Notifications", isOn: $showNotifications)
                            .controlSize(.large)
                            .onChange(of: showNotifications) { _, newValue in
                                // Update ConfigManager's notificationsEnabled to match
                                configManager.notificationsEnabled = newValue
                                
                                // Ensure NotificationService starts/stops based on the toggle
                                if newValue {
                                    Task {
                                        // Request permissions and show test notification
                                        let granted = await notificationService
                                            .requestPermissionAndShowTestNotification()

                                        if granted {
                                            await notificationService.start()
                                        } else {
                                            // If permission denied, turn toggle back off
                                            await MainActor.run {
                                                showNotifications = false
                                                configManager.notificationsEnabled = false
                                                showingPermissionAlert = true
                                            }
                                        }
                                    }
                                } else {
                                    notificationService.stop()
                                }
                            }
                        Text("Display native macOS notifications for session and command events")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        
                        // SSE Connection Status Row
                        HStack(spacing: 6) {
                            Circle()
                                .fill(sseConnectionStatus ? Color.green : Color.red)
                                .frame(width: 8, height: 8)
                            Text("Event Stream:")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text(sseConnectionStatus ? "Connected" : "Disconnected")
                                .font(.caption)
                                .foregroundStyle(sseConnectionStatus ? .green : .red)
                                .fontWeight(.medium)
                            Spacer()
                        }
                        .help(sseConnectionStatus 
                            ? "Real-time notification stream is connected" 
                            : "Real-time notification stream is disconnected. Check if the server is running.")
                        
                        // Show warning when disconnected
                        if showNotifications && !sseConnectionStatus {
                            HStack(spacing: 6) {
                                Image(systemName: "exclamationmark.triangle.fill")
                                    .foregroundStyle(.yellow)
                                    .font(.caption)
                                Text("Real-time notifications are unavailable. The server connection may be down.")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                    .padding(.vertical, 8)
                }

                // Notification types section
                if showNotifications {
                    Section {
                        NotificationToggleRow(
                            title: "Session starts",
                            description: "When a new session starts (useful for shared terminals)",
                            isOn: $bindableConfig.notificationSessionStart
                        )
                        .onChange(of: bindableConfig.notificationSessionStart) { _, _ in
                            updateNotificationPreferences()
                        }

                        NotificationToggleRow(
                            title: "Session ends",
                            description: "When a session terminates or crashes (shows exit code)",
                            isOn: $bindableConfig.notificationSessionExit
                        )
                        .onChange(of: bindableConfig.notificationSessionExit) { _, _ in
                            updateNotificationPreferences()
                        }

                        NotificationToggleRow(
                            title: "Commands fail",
                            description: "When commands fail with non-zero exit codes",
                            isOn: $bindableConfig.notificationCommandError
                        )
                        .onChange(of: bindableConfig.notificationCommandError) { _, _ in
                            updateNotificationPreferences()
                        }

                        NotificationToggleRow(
                            title: "Commands complete (> 3 seconds)",
                            description: "When commands taking >3 seconds finish (builds, tests, etc.)",
                            isOn: $bindableConfig.notificationCommandCompletion
                        )
                        .onChange(of: bindableConfig.notificationCommandCompletion) { _, _ in
                            updateNotificationPreferences()
                        }

                        NotificationToggleRow(
                            title: "Terminal bell (🔔)",
                            description: "Terminal bell (^G) from vim, IRC mentions, completion sounds",
                            isOn: $bindableConfig.notificationBell
                        )
                        .onChange(of: bindableConfig.notificationBell) { _, _ in
                            updateNotificationPreferences()
                        }

                        NotificationToggleRow(
                            title: "Claude turn notifications",
                            description: "When Claude AI finishes responding and awaits input",
                            isOn: $bindableConfig.notificationClaudeTurn
                        )
                        .onChange(of: bindableConfig.notificationClaudeTurn) { _, _ in
                            updateNotificationPreferences()
                        }
                    } header: {
                        Text("Notification Types")
                            .font(.headline)
                    }

                    // Behavior section
                    Section {
                        VStack(spacing: 12) {
                            Toggle("Play sound", isOn: $bindableConfig.notificationSoundEnabled)
                                .onChange(of: bindableConfig.notificationSoundEnabled) { _, _ in
                                    updateNotificationPreferences()
                                }

                            Toggle("Show in Notification Center", isOn: $bindableConfig.showInNotificationCenter)
                                .onChange(of: bindableConfig.showInNotificationCenter) { _, _ in
                                    updateNotificationPreferences()
                                }
                        }
                    } header: {
                        Text("Notification Behavior")
                            .font(.headline)
                    }

                    // Test section
                    Section {
                        VStack(alignment: .leading, spacing: 12) {
                            HStack {
                                Button("Test Notification") {
                                    Task {
                                        isTestingNotification = true
                                        // Use server test notification to verify the full flow
                                        await notificationService.sendServerTestNotification()
                                        // Reset button state after a delay
                                        try? await Task.sleep(nanoseconds: 1_000_000_000)
                                        isTestingNotification = false
                                    }
                                }
                                .buttonStyle(.bordered)
                                .disabled(!showNotifications || isTestingNotification)

                                if isTestingNotification {
                                    ProgressView()
                                        .scaleEffect(0.7)
                                        .frame(width: 16, height: 16)
                                }
                                
                                Spacer()
                            }

                            HStack {
                                Button("Open System Settings") {
                                    notificationService.openNotificationSettings()
                                }
                                .buttonStyle(.link)
                                
                                Spacer()
                            }
                        }
                    } header: {
                        Text("Actions")
                            .font(.headline)
                    }
                }
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
            .navigationTitle("Notification Settings")
            .onAppear {
                // Sync the AppStorage value with ConfigManager on first load
                showNotifications = configManager.notificationsEnabled
                
                // Update initial connection status
                sseConnectionStatus = notificationService.isSSEConnected
            }
            .onReceive(NotificationCenter.default.publisher(for: .notificationServiceConnectionChanged)) { _ in
                // Update connection status when it changes
                sseConnectionStatus = notificationService.isSSEConnected
                logger.debug("SSE connection status changed: \(sseConnectionStatus)")
            }
        }
        .alert("Notification Permission Required", isPresented: $showingPermissionAlert) {
            Button("Open System Settings") {
                notificationService.openNotificationSettings()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(
                "VibeTunnel needs permission to show notifications. Please enable notifications for VibeTunnel in System Settings."
            )
        }
    }
}

/// Reusable component for notification toggle rows with descriptions
struct NotificationToggleRow: View {
    let title: String
    let description: String
    @Binding var isOn: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.body)
                Text(description)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
            Toggle("", isOn: $isOn)
                .labelsHidden()
        }
        .padding(.vertical, 6)
    }
}

#Preview {
    NotificationSettingsView()
        .environment(ConfigManager.shared)
        .environment(NotificationService.shared)
        .frame(width: 560, height: 700)
}
