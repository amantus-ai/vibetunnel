import AppKit
import os.log
import SwiftUI

/// Security & Permissions settings tab for authentication and system permissions
struct SecurityPermissionsSettingsView: View {
    @AppStorage(AppConstants.UserDefaultsKeys.authenticationMode)
    private var authModeString = "os"

    @State private var authMode: AuthenticationMode = .osAuth

    @Environment(SystemPermissionManager.self)
    private var permissionManager
    @Environment(ServerManager.self)
    private var serverManager

    @State private var permissionUpdateTrigger = 0

    private let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "SecurityPermissionsSettings")

    // MARK: - Helper Properties

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
        NavigationStack {
            Form {
                SecuritySection(
                    authMode: $authMode,
                    enableSSHKeys: .constant(authMode == .sshKeys || authMode == .both),
                    logger: logger,
                    serverManager: serverManager
                )

                PermissionsSection(
                    hasAppleScriptPermission: hasAppleScriptPermission,
                    hasAccessibilityPermission: hasAccessibilityPermission,
                    permissionManager: permissionManager
                )
            }
            .formStyle(.grouped)
            .frame(minWidth: 500, idealWidth: 600)
            .scrollContentBackground(.hidden)
            .navigationTitle("Security")
            .onAppear {
                onAppearSetup()
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

    // MARK: - Private Methods

    private func onAppearSetup() {
        // Initialize authentication mode from stored value
        let storedMode = UserDefaults.standard.string(forKey: AppConstants.UserDefaultsKeys.authenticationMode) ?? "os"
        authMode = AuthenticationMode(rawValue: storedMode) ?? .osAuth
    }
}


// MARK: - Security Section

private struct SecuritySection: View {
    @Binding var authMode: AuthenticationMode
    @Binding var enableSSHKeys: Bool
    let logger: Logger
    let serverManager: ServerManager

    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: 16) {
                // Authentication mode picker
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("Authentication Method")
                            .font(.callout)
                        Spacer()
                        Picker("", selection: $authMode) {
                            ForEach(AuthenticationMode.allCases, id: \.self) { mode in
                                Text(mode.displayName)
                                    .tag(mode)
                            }
                        }
                        .labelsHidden()
                        .pickerStyle(.menu)
                        .frame(alignment: .trailing)
                        .onChange(of: authMode) { _, newValue in
                            // Save the authentication mode
                            UserDefaults.standard.set(
                                newValue.rawValue,
                                forKey: AppConstants.UserDefaultsKeys.authenticationMode
                            )

                            Task {
                                logger.info("Authentication mode changed to: \(newValue.rawValue)")
                                await serverManager.restart()
                            }
                        }
                    }

                    Text(authMode.description)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                // Additional info based on selected mode
                if authMode == .osAuth || authMode == .both {
                    HStack(alignment: .center, spacing: 6) {
                        Image(systemName: "info.circle")
                            .foregroundColor(.blue)
                            .font(.system(size: 12))
                            .frame(width: 16, height: 16)
                        Text("Uses your macOS username: \(NSUserName())")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Spacer()
                    }
                }

                if authMode == .sshKeys || authMode == .both {
                    HStack(alignment: .center, spacing: 6) {
                        Image(systemName: "key.fill")
                            .foregroundColor(.blue)
                            .font(.system(size: 12))
                            .frame(width: 16, height: 16)
                        Text("SSH keys from ~/.ssh/authorized_keys")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Spacer()
                        Button("Open folder") {
                            let sshPath = NSHomeDirectory() + "/.ssh"
                            if FileManager.default.fileExists(atPath: sshPath) {
                                NSWorkspace.shared.open(URL(fileURLWithPath: sshPath))
                            } else {
                                // Create .ssh directory if it doesn't exist
                                try? FileManager.default.createDirectory(
                                    atPath: sshPath,
                                    withIntermediateDirectories: true,
                                    attributes: [.posixPermissions: 0o700]
                                )
                                NSWorkspace.shared.open(URL(fileURLWithPath: sshPath))
                            }
                        }
                        .buttonStyle(.link)
                        .font(.caption)
                    }
                }
            }
        } header: {
            Text("Authentication")
                .font(.headline)
        } footer: {
            Text("Localhost connections are always accessible without authentication.")
                .font(.caption)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
        }
    }
}

// MARK: - Permissions Section

private struct PermissionsSection: View {
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

// MARK: - Previews

#Preview("Security & Permissions Settings") {
    SecurityPermissionsSettingsView()
        .frame(width: 500, height: 600)
        .environment(SystemPermissionManager.shared)
}
