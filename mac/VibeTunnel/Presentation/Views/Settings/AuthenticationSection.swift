import SwiftUI
import AppKit
import os.log

/// Authentication configuration section for remote access settings
struct AuthenticationSection: View {
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

#Preview {
    struct PreviewWrapper: View {
        @State var authMode = AuthenticationMode.osAuth
        @State var enableSSHKeys = false
        
        var body: some View {
            AuthenticationSection(
                authMode: $authMode,
                enableSSHKeys: $enableSSHKeys,
                logger: Logger(subsystem: "preview", category: "auth"),
                serverManager: ServerManager.shared
            )
            .frame(width: 500)
            .padding()
        }
    }
    
    return PreviewWrapper()
}