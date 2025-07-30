import SwiftUI

/// System permissions configuration section
struct PermissionsSection: View {
    let hasAppleScriptPermission: Bool
    let hasAccessibilityPermission: Bool
    let permissionManager: SystemPermissionManager

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
                    .contextMenu {
                        Button("Refresh Status") {
                            permissionManager.forcePermissionRecheck()
                        }
                        Button("Open System Settings...") {
                            permissionManager.requestPermission(.appleScript)
                        }
                    }
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
                    .contextMenu {
                        Button("Refresh Status") {
                            permissionManager.forcePermissionRecheck()
                        }
                        Button("Open System Settings...") {
                            permissionManager.requestPermission(.accessibility)
                        }
                    }
                } else {
                    Button("Grant Permission") {
                        permissionManager.requestPermission(.accessibility)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }
            }
        } header: {
            Text("System Permissions")
                .font(.headline)
        } footer: {
            if hasAppleScriptPermission && hasAccessibilityPermission {
                Text(
                    "All permissions granted. VibeTunnel has full functionality."
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
    }
}

#Preview {
    struct PreviewWrapper: View {
        @State var hasAppleScript = true
        @State var hasAccessibility = false

        var body: some View {
            PermissionsSection(
                hasAppleScriptPermission: hasAppleScript,
                hasAccessibilityPermission: hasAccessibility,
                permissionManager: SystemPermissionManager.shared
            )
            .frame(width: 500)
            .padding()
        }
    }

    return PreviewWrapper()
}
