import os.log
import SwiftUI
import UserNotifications

/// Notification permission page for onboarding flow.
///
/// Allows users to enable native macOS notifications for VibeTunnel events
/// during the welcome flow. Users can grant permissions or skip and enable later.
struct NotificationPermissionPageView: View {
    private let notificationService = NotificationService.shared
    @State private var isRequestingPermission = false
    @State private var permissionStatus: UNAuthorizationStatus = .notDetermined

    private let logger = Logger(
        subsystem: "sh.vibetunnel.vibetunnel",
        category: "NotificationPermissionPageView"
    )

    #if DEBUG
        init(permissionStatus: UNAuthorizationStatus = .notDetermined) {
            self.permissionStatus = permissionStatus
        }
    #endif

    var body: some View {
        VStack(spacing: 30) {
            VStack(spacing: 16) {
                Text("Enable Notifications")
                    .font(.largeTitle)
                    .fontWeight(.semibold)

                Text(
                    "Get notified about session events, command completions, and errors. You can customize which notifications to receive in Settings."
                )
                .font(.body)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 480)
                .fixedSize(horizontal: false, vertical: true)

                if permissionStatus != .denied {
                    // Notification examples
                    VStack(alignment: .leading, spacing: 12) {
                        Label("Session starts and exits", systemImage: "terminal")
                        Label("Command completions and errors", systemImage: "exclamationmark.triangle")
                        Label("Terminal bell events", systemImage: "bell")
                    }
                    .font(.callout)
                    .foregroundColor(.secondary)
                    .padding()
                    .background(Color(NSColor.controlBackgroundColor))
                    .cornerRadius(8)
                    .frame(maxWidth: 400)
                }

                // Permission button/status
                if permissionStatus == .authorized {
                    HStack {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundColor(.green)
                        Text("Notifications enabled")
                            .foregroundColor(.secondary)
                    }
                    .font(.body)
                    .frame(height: 32)
                } else if permissionStatus == .denied {
                    VStack(spacing: 8) {
                        HStack {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundColor(.orange)
                            Text("Notifications are disabled")
                                .foregroundColor(.secondary)
                        }
                        .font(.body)

                        Button("Open System Settings") {
                            notificationService.openNotificationSettings()
                        }
                        .buttonStyle(.borderedProminent)
                        .frame(height: 32)
                    }
                } else {
                    Button(action: requestNotificationPermission) {
                        if isRequestingPermission {
                            ProgressView()
                                .scaleEffect(0.5)
                                .frame(width: 8, height: 8)
                        } else {
                            Text("Enable Notifications")
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(isRequestingPermission)
                    .frame(height: 32)
                }
            }
            Spacer()
        }
        .padding()
        .task {
            if !isRunningPreviews() {
                await checkNotificationPermission()
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            // Check permissions when returning from System Settings
            Task {
                await checkNotificationPermission()
            }
        }
    }

    private func checkNotificationPermission() async {
        permissionStatus = await notificationService.authorizationStatus()
    }

    private func requestNotificationPermission() {
        Task {
            isRequestingPermission = true
            defer { isRequestingPermission = false }
            _ = try? await notificationService.requestAuthorization()
            // Update permission status after request
            await checkNotificationPermission()
        }
    }
}

#Preview("Not determined") {
    NotificationPermissionPageView(permissionStatus: .notDetermined)
        .frame(width: 640, height: 480)
        .background(Color(NSColor.windowBackgroundColor))
}

#Preview("Authorized") {
    NotificationPermissionPageView(permissionStatus: .authorized)
        .frame(width: 640, height: 480)
        .background(Color(NSColor.windowBackgroundColor))
}

#Preview("Permissions denied") {
    NotificationPermissionPageView(permissionStatus: .denied)
        .frame(width: 640, height: 480)
        .background(Color(NSColor.windowBackgroundColor))
}
