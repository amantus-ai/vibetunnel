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

    private let logger = Logger(subsystem: BundleIdentifiers.loggerSubsystem, category: "SecurityPermissionsSettings")

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
                SecuritySection(
                    authMode: self.$authMode,
                    enableSSHKeys: .constant(self.authMode == .sshKeys || self.authMode == .both),
                    logger: self.logger,
                    serverManager: self.serverManager)

                PermissionsSection(
                    hasAppleScriptPermission: self.hasAppleScriptPermission,
                    hasAccessibilityPermission: self.hasAccessibilityPermission,
                    permissionManager: self.permissionManager)
            }
            .formStyle(.grouped)
            .frame(minWidth: 500, idealWidth: 600)
            .scrollContentBackground(.hidden)
            .navigationTitle("Security")
            .onAppear {
                self.onAppearSetup()
                // Register for continuous monitoring
                self.permissionManager.registerForMonitoring()
            }
            .task {
                // Check permissions before first render to avoid UI flashing
                await self.permissionManager.checkAllPermissions()
            }
            .onDisappear {
                self.permissionManager.unregisterFromMonitoring()
            }
            .onReceive(NotificationCenter.default.publisher(for: .permissionsUpdated)) { _ in
                // Increment trigger to force computed property re-evaluation
                self.permissionUpdateTrigger += 1
            }
        }
    }

    // MARK: - Private Methods

    private func onAppearSetup() {
        // Initialize authentication mode from stored value
        let storedMode = UserDefaults.standard.string(forKey: AppConstants.UserDefaultsKeys.authenticationMode) ?? "os"
        self.authMode = AuthenticationMode(rawValue: storedMode) ?? .osAuth
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
                        Picker("", selection: self.$authMode) {
                            ForEach(AuthenticationMode.allCases, id: \.self) { mode in
                                Text(mode.displayName)
                                    .tag(mode)
                            }
                        }
                        .labelsHidden()
                        .pickerStyle(.menu)
                        .frame(alignment: .trailing)
                        .onChange(of: self.authMode) { _, newValue in
                            // Save the authentication mode
                            UserDefaults.standard.set(
                                newValue.rawValue,
                                forKey: AppConstants.UserDefaultsKeys.authenticationMode)

                            Task {
                                self.logger.info("Authentication mode changed to: \(newValue.rawValue)")
                                await self.serverManager.restart()
                            }
                        }
                    }

                    Text(self.authMode.description)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                // Additional info based on selected mode
                if self.authMode == .osAuth || self.authMode == .both {
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

                if self.authMode == .sshKeys || self.authMode == .both {
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
                                    attributes: [.posixPermissions: 0o700])
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

// MARK: - Previews

#Preview("Security & Permissions Settings") {
    SecurityPermissionsSettingsView()
        .frame(width: 500, height: 600)
        .environment(SystemPermissionManager.shared)
}
