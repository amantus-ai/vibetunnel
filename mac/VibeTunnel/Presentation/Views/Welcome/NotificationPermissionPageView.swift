import SwiftUI
@preconcurrency import UserNotifications
import os.log

/// Notification permission page for onboarding flow.
///
/// Allows users to enable native macOS notifications for VibeTunnel events
/// during the welcome flow. Users can grant permissions or skip and enable later.
struct NotificationPermissionPageView: View {
    @State private var isRequestingPermission = false
    @State private var permissionStatus: UNAuthorizationStatus = .notDetermined
    
    private let logger = Logger(
        subsystem: "sh.vibetunnel.vibetunnel",
        category: "NotificationPermissionPageView"
    )
    
    #if DEBUG
    init(
        isRequestingPermission: Bool = false,
        permissionStatus: UNAuthorizationStatus = .notDetermined
    ) {
        self.isRequestingPermission = isRequestingPermission
        self.permissionStatus = permissionStatus
    }
    #endif
    
    var body: some View {
        VStack(spacing: 30) {
            VStack(spacing: 16) {
                Text("Enable Notifications")
                    .font(.largeTitle)
                    .fontWeight(.semibold)
                
                Text("Get notified about session events, command completions, and errors. You can customize which notifications to receive in Settings.")
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
                        
                        Button(action: openSystemSettings) {
                            Text("Open System Settings")
                        }
                        .buttonStyle(.borderedProminent)
                        .frame(height: 32)
                    }
                } else {
                    Button(action: requestNotificationPermission) {
                        if isRequestingPermission {
                            ProgressView()
                                .scaleEffect(0.8)
                                .frame(width: 16, height: 16)
                        } else {
                            Text("Enable Notifications")
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(isRequestingPermission)
                    .frame(height: 32)
                }
                
                Text("You can always change notification preferences later in Settings")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            Spacer()
        }
        .padding()
        .task {
            await checkNotificationPermission()
        }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            // Check permissions when returning from System Settings
            Task {
                await checkNotificationPermission()
            }
        }
    }
    
    private func checkNotificationPermission() async {
        permissionStatus = await UNUserNotificationCenter.current()
            .notificationSettings()
            .authorizationStatus
    }
    
    private func requestNotificationPermission() {
        isRequestingPermission = true
        
        Task {
            defer { isRequestingPermission = false }
            
            do {
                let granted = try await UNUserNotificationCenter.current().requestAuthorization(options: [
                    .alert,
                    .sound,
                    .badge
                ])
                
                logger.info("Notification permission granted: \(granted)")
                
                // Update permission status after request
                await checkNotificationPermission()
            } catch {
                logger.error("Failed to request notification permissions: \(error)")
            }
        }
    }
    
    private func openSystemSettings() {
        guard let url = URL(string: "x-apple.systempreferences:com.apple.preference.notifications")
        else { assertionFailure("Invalid URL for System Preferences"); return }
        
        NSWorkspace.shared.open(url)
    }
}

#Preview("Notification Permission Page") {
    NotificationPermissionPageView()
        .frame(width: 640, height: 480)
        .background(Color(NSColor.windowBackgroundColor))
}

#Preview("Permissions denied") {
    NotificationPermissionPageView(permissionStatus: .denied)
        .frame(width: 640, height: 480)
        .background(Color(NSColor.windowBackgroundColor))
}
