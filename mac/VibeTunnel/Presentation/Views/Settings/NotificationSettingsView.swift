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
    @State private var eventStreamConnectionStatus = false

    private func updateNotificationPreferences() {
        // Load current preferences from ConfigManager and notify the service
        let prefs = NotificationService.NotificationPreferences(fromConfig: self.configManager)
        self.notificationService.updatePreferences(prefs)
        // Also update the enabled state in ConfigManager
        self.configManager.notificationsEnabled = self.showNotifications
    }

    var body: some View {
        NavigationStack {
            @Bindable var bindableConfig = self.configManager

            Form {
                // Master toggle section
                Section {
                    VStack(alignment: .leading, spacing: 12) {
                        Toggle("Show Session Notifications", isOn: self.$showNotifications)
                            .controlSize(.large)
                            .onChange(of: self.showNotifications) { _, newValue in
                                // Update ConfigManager's notificationsEnabled to match
                                self.configManager.notificationsEnabled = newValue

                                // Ensure NotificationService starts/stops based on the toggle
                                if newValue {
                                    Task {
                                        // Request permissions and show test notification
                                        let granted = await notificationService
                                            .requestPermissionAndShowTestNotification()

                                        if granted {
                                            await self.notificationService.start()
                                        } else {
                                            // If permission denied, turn toggle back off
                                            await MainActor.run {
                                                self.showNotifications = false
                                                self.configManager.notificationsEnabled = false
                                                self.showingPermissionAlert = true
                                            }
                                        }
                                    }
                                } else {
                                    self.notificationService.stop()
                                }
                            }
                        Text("Display native macOS notifications for session and command events")
                            .font(.caption)
                            .foregroundStyle(.secondary)

                        // Event Stream Connection Status Row
                        HStack(spacing: 6) {
                            Circle()
                                .fill(self.eventStreamConnectionStatus ? Color.green : Color.red)
                                .frame(width: 8, height: 8)
                            Text("Event Stream:")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text(self.eventStreamConnectionStatus ? "Connected" : "Disconnected")
                                .font(.caption)
                                .foregroundStyle(self.eventStreamConnectionStatus ? .green : .red)
                                .fontWeight(.medium)
                            Spacer()
                        }
                        .help(
                            self.eventStreamConnectionStatus
                                ? "Real-time notification stream is connected"
                                : "Real-time notification stream is disconnected. Check if the server is running.")

                        // Show warning when disconnected
                        if self.showNotifications, !self.eventStreamConnectionStatus {
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
                if self.showNotifications {
                    Section {
                        NotificationToggleRow(
                            title: "Session starts",
                            description: "When a new session starts (useful for shared terminals)",
                            isOn: $bindableConfig.notificationSessionStart)
                            .onChange(of: bindableConfig.notificationSessionStart) { _, _ in
                                self.updateNotificationPreferences()
                            }

                        NotificationToggleRow(
                            title: "Session ends",
                            description: "When a session terminates or crashes (shows exit code)",
                            isOn: $bindableConfig.notificationSessionExit)
                            .onChange(of: bindableConfig.notificationSessionExit) { _, _ in
                                self.updateNotificationPreferences()
                            }

                        NotificationToggleRow(
                            title: "Commands fail",
                            description: "When commands fail with non-zero exit codes",
                            isOn: $bindableConfig.notificationCommandError)
                            .onChange(of: bindableConfig.notificationCommandError) { _, _ in
                                self.updateNotificationPreferences()
                            }

                        NotificationToggleRow(
                            title: "Commands complete (> 3 seconds)",
                            description: "When commands taking >3 seconds finish (builds, tests, etc.)",
                            isOn: $bindableConfig.notificationCommandCompletion)
                            .onChange(of: bindableConfig.notificationCommandCompletion) { _, _ in
                                self.updateNotificationPreferences()
                            }

                        NotificationToggleRow(
                            title: "Terminal bell (🔔)",
                            description: "Terminal bell (^G) from vim, IRC mentions, completion sounds",
                            isOn: $bindableConfig.notificationBell)
                            .onChange(of: bindableConfig.notificationBell) { _, _ in
                                self.updateNotificationPreferences()
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
                                    self.updateNotificationPreferences()
                                }

                            Toggle("Show in Notification Center", isOn: $bindableConfig.showInNotificationCenter)
                                .onChange(of: bindableConfig.showInNotificationCenter) { _, _ in
                                    self.updateNotificationPreferences()
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
                                    Task { @MainActor in
                                        self.isTestingNotification = true
                                        // Use server test notification to verify the full flow
                                        await self.notificationService.sendServerTestNotification()
                                        // Reset button state after a delay
                                        await Task.yield()
                                        self.isTestingNotification = false
                                    }
                                }
                                .buttonStyle(.bordered)
                                .disabled(!self.showNotifications || self.isTestingNotification)

                                if self.isTestingNotification {
                                    ProgressView()
                                        .scaleEffect(0.7)
                                        .frame(width: 16, height: 16)
                                }

                                Spacer()
                            }

                            HStack {
                                Button("Open System Settings") {
                                    self.notificationService.openNotificationSettings()
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
                self.showNotifications = self.configManager.notificationsEnabled

                // Update initial connection status
                self.eventStreamConnectionStatus = self.notificationService.isEventStreamConnected
            }
            .onReceive(NotificationCenter.default.publisher(for: .notificationServiceConnectionChanged)) { _ in
                // Update connection status when it changes
                self.eventStreamConnectionStatus = self.notificationService.isEventStreamConnected
                logger.debug("Event stream connection status changed: \(self.eventStreamConnectionStatus)")
            }
        }
        .alert("Notification Permission Required", isPresented: self.$showingPermissionAlert) {
            Button("Open System Settings") {
                self.notificationService.openNotificationSettings()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(
                "VibeTunnel needs permission to show notifications. Please enable notifications for VibeTunnel in System Settings.")
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
                Text(self.title)
                    .font(.body)
                Text(self.description)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
            Toggle("", isOn: self.$isOn)
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
