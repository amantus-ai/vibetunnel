import SwiftUI
import UserNotifications

struct NotificationSettingsView: View {
    // MARK: - Notification Preferences
    @AppStorage("notificationsEnabled") private var notificationsEnabled = true
    @AppStorage("notifyOnSessionExit") private var notifyOnSessionExit = true
    @AppStorage("notifyOnSessionExitOnlyOnError") private var notifyOnSessionExitOnlyOnError = false
    @AppStorage("notifyOnConnectionChange") private var notifyOnConnectionChange = true
    @AppStorage("notifyOnErrors") private var notifyOnErrors = true
    @AppStorage("playNotificationSound") private var playNotificationSound = true
    @AppStorage("showNotificationsInForeground") private var showNotificationsInForeground = false
    
    @State private var notificationPermissionStatus: UNAuthorizationStatus = .notDetermined
    @State private var isCheckingPermission = false
    
    var body: some View {
        Form {
            // MARK: - Permission Status
            Section {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Notification Permission")
                            .font(.headline)
                        Text(permissionStatusText)
                            .font(.caption)
                            .foregroundStyle(permissionStatusColor)
                    }
                    
                    Spacer()
                    
                    if notificationPermissionStatus == .notDetermined || notificationPermissionStatus == .denied {
                        Button("Request Permission") {
                            Task {
                                await requestNotificationPermission()
                            }
                        }
                        .secondaryButtonStyle()
                        .disabled(isCheckingPermission)
                    }
                }
                .padding(.vertical, 4)
            }
            
            // MARK: - Main Settings
            Section {
                Toggle("Enable Notifications", isOn: $notificationsEnabled)
                    .disabled(notificationPermissionStatus != .authorized)
                
                if notificationsEnabled && notificationPermissionStatus == .authorized {
                    Toggle("Play Sound", isOn: $playNotificationSound)
                        .padding(.leading, 20)
                    
                    Toggle("Show When App is Active", isOn: $showNotificationsInForeground)
                        .padding(.leading, 20)
                        .help("Show notifications even when VibeTunnel is the active application")
                }
            } header: {
                Text("General")
            }
            
            // MARK: - Notification Types
            if notificationsEnabled && notificationPermissionStatus == .authorized {
                Section {
                    VStack(alignment: .leading, spacing: 12) {
                        // Session notifications
                        Toggle("Session Exit", isOn: $notifyOnSessionExit)
                        
                        if notifyOnSessionExit {
                            Toggle("Only on Error (non-zero exit code)", isOn: $notifyOnSessionExitOnlyOnError)
                                .padding(.leading, 20)
                                .font(.caption)
                        }
                        
                        // Connection notifications
                        Toggle("Connection Status Changes", isOn: $notifyOnConnectionChange)
                            .help("Notify when connected or disconnected from server")
                        
                        // Error notifications
                        Toggle("Errors and Warnings", isOn: $notifyOnErrors)
                            .help("Notify when errors occur in the application")
                    }
                } header: {
                    Text("Notification Types")
                }
                
                // MARK: - Test Section
                Section {
                    VStack(spacing: 12) {
                        Button("Test Session Notification") {
                            Task {
                                await testSessionNotification()
                            }
                        }
                        .secondaryButtonStyle()
                        .frame(maxWidth: .infinity)
                        
                        Button("Test Error Notification") {
                            Task {
                                await testErrorNotification()
                            }
                        }
                        .secondaryButtonStyle()
                        .frame(maxWidth: .infinity)
                    }
                } header: {
                    Text("Test Notifications")
                } footer: {
                    Text("Test notifications will be shown regardless of your current settings")
                        .font(.caption)
                        .foregroundStyle(Theme.Colors.secondaryText)
                }
            }
        }
        .formStyle(.grouped)
        .padding()
        .task {
            await checkNotificationPermission()
        }
    }
    
    // MARK: - Computed Properties
    private var permissionStatusText: String {
        switch notificationPermissionStatus {
        case .notDetermined:
            return "Permission not requested"
        case .denied:
            return "Permission denied - Open System Preferences to enable"
        case .authorized:
            return "Permission granted"
        case .provisional:
            return "Provisional permission granted"
        case .ephemeral:
            return "Ephemeral permission granted"
        @unknown default:
            return "Unknown status"
        }
    }
    
    private var permissionStatusColor: Color {
        switch notificationPermissionStatus {
        case .authorized, .provisional, .ephemeral:
            return Theme.Colors.success
        case .denied:
            return Theme.Colors.error
        case .notDetermined:
            return Theme.Colors.warning
        @unknown default:
            return Theme.Colors.secondaryText
        }
    }
    
    // MARK: - Methods
    private func checkNotificationPermission() async {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        await MainActor.run {
            notificationPermissionStatus = settings.authorizationStatus
        }
    }
    
    private func requestNotificationPermission() async {
        isCheckingPermission = true
        defer {
            Task { @MainActor in
                isCheckingPermission = false
            }
        }
        
        await NotificationManager.shared.requestPermissionIfNeeded()
        await checkNotificationPermission()
    }
    
    private func testSessionNotification() async {
        // Create a mock session for testing
        let testSession = Session(
            id: "test-\(UUID().uuidString)",
            name: "Test Session",
            command: "echo 'Test completed'",
            cwd: "/Users/test",
            createdAt: Date(),
            status: .exited,
            exitCode: 0,
            pid: 12345
        )
        
        // Temporarily enable foreground notifications for testing
        let originalSetting = showNotificationsInForeground
        await MainActor.run {
            showNotificationsInForeground = true
        }
        
        await NotificationManager.shared.notifySessionCompleted(testSession)
        
        // Restore original setting after a delay
        Task {
            try? await Task.sleep(nanoseconds: 1_000_000_000) // 1 second
            await MainActor.run {
                showNotificationsInForeground = originalSetting
            }
        }
    }
    
    private func testErrorNotification() async {
        // Temporarily enable foreground notifications for testing
        let originalSetting = showNotificationsInForeground
        await MainActor.run {
            showNotificationsInForeground = true
        }
        
        await NotificationManager.shared.showNotification(
            title: "Test Error Notification",
            body: "This is a test error notification from VibeTunnel",
            sound: .defaultCritical
        )
        
        // Restore original setting after a delay
        Task {
            try? await Task.sleep(nanoseconds: 1_000_000_000) // 1 second
            await MainActor.run {
                showNotificationsInForeground = originalSetting
            }
        }
    }
}

#Preview {
    NotificationSettingsView()
        .frame(width: 600, height: 500)
}