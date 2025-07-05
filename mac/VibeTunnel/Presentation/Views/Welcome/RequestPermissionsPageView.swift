import SwiftUI

/// Third page requesting AppleScript automation and accessibility permissions.
///
/// This view guides users through granting necessary permissions for VibeTunnel
/// to function properly. It handles both AppleScript permissions for terminal
/// automation and accessibility permissions for sending commands.
///
/// ## Topics
///
/// ### Overview
/// The permissions page includes:
/// - AppleScript permission request and status
/// - Accessibility permission request and status
/// - Terminal application selector
/// - Real-time permission status updates
///
/// ### Requirements
/// - ``SystemPermissionManager`` for all system permissions
/// - Terminal selection stored in UserDefaults
struct RequestPermissionsPageView: View {
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

    private var hasScreenRecordingPermission: Bool {
        _ = permissionUpdateTrigger
        return permissionManager.hasPermission(.screenRecording)
    }

    var body: some View {
        VStack(spacing: 30) {
            VStack(spacing: 16) {
                Text("Request Permissions")
                    .font(.largeTitle)
                    .fontWeight(.semibold)

                Text(
                    "VibeTunnel needs these permissions:\n• Automation to start terminal sessions\n• Accessibility to send commands\n• Screen Recording for screen capture"
                )
                .font(.body)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 480)
                .fixedSize(horizontal: false, vertical: true)

                // Permissions buttons
                VStack(spacing: 16) {
                    // Automation permission
                    if hasAppleScriptPermission {
                        HStack {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundColor(.green)
                            Text("Automation permission granted")
                                .foregroundColor(.secondary)
                        }
                        .font(.body)
                        .frame(maxWidth: 250)
                        .frame(height: 32)
                    } else {
                        Button("Grant Automation Permission") {
                            permissionManager.requestPermission(.appleScript)
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.regular)
                        .frame(width: 250, height: 32)
                    }

                    // Accessibility permission
                    if hasAccessibilityPermission {
                        HStack {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundColor(.green)
                            Text("Accessibility permission granted")
                                .foregroundColor(.secondary)
                        }
                        .font(.body)
                        .frame(maxWidth: 250)
                        .frame(height: 32)
                    } else {
                        Button("Grant Accessibility Permission") {
                            permissionManager.requestPermission(.accessibility)
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.regular)
                        .frame(width: 250, height: 32)
                    }

                    // Screen Recording permission
                    if hasScreenRecordingPermission {
                        HStack {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundColor(.green)
                            Text("Screen Recording permission granted")
                                .foregroundColor(.secondary)
                        }
                        .font(.body)
                        .frame(maxWidth: 250)
                        .frame(height: 32)
                    } else {
                        Button("Grant Screen Recording Permission") {
                            permissionManager.requestPermission(.screenRecording)
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.regular)
                        .frame(width: 250, height: 32)
                    }
                }
            }
            Spacer()
        }
        .padding()
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

// MARK: - Preview

#Preview("Request Permissions Page") {
    RequestPermissionsPageView()
        .frame(width: 640, height: 480)
        .background(Color(NSColor.windowBackgroundColor))
        .environment(SystemPermissionManager.shared)
}
