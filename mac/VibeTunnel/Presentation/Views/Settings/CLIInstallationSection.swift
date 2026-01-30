import AppKit
import os.log
import SwiftUI

// MARK: - CLI Installation Section

struct CLIInstallationSection: View {
    @State private var cliInstaller = CLIInstaller()
    @State private var showingVtConflictAlert = false
    @AppStorage(AppConstants.UserDefaultsKeys.debugMode)
    private var debugMode = false

    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Command Line Tool")
                            .font(.callout)
                        if self.cliInstaller.isInstalled {
                            if self.cliInstaller.isOutdated {
                                Text("Update available")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            } else {
                                Text("Installed and up to date")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        } else {
                            Text("Not installed")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }

                    Spacer()

                    if self.cliInstaller.isInstalling {
                        HStack {
                            ProgressView()
                                .scaleEffect(0.7)
                            Text(self.cliInstaller.isUninstalling ? "Uninstalling..." : "Installing...")
                                .font(.caption)
                        }
                    } else {
                        if self.cliInstaller.isInstalled {
                            // Updated status
                            if self.cliInstaller.isOutdated {
                                HStack(spacing: 8) {
                                    Button("Update 'vt' Command") {
                                        Task {
                                            await self.cliInstaller.install()
                                        }
                                    }
                                    .buttonStyle(.bordered)
                                    .disabled(self.cliInstaller.isInstalling)

                                    Button(action: {
                                        Task {
                                            await self.cliInstaller.uninstall()
                                        }
                                    }, label: {
                                        Image(systemName: "trash")
                                            .font(.system(size: 14))
                                    })
                                    .buttonStyle(.plain)
                                    .foregroundColor(.red)
                                    .disabled(self.cliInstaller.isInstalling)
                                    .help("Uninstall CLI tool")
                                }
                            } else {
                                HStack(spacing: 8) {
                                    Image(systemName: "checkmark.circle.fill")
                                        .foregroundColor(.green)
                                    Text("VT installed")
                                        .foregroundColor(.secondary)

                                    // Show reinstall button in debug mode
                                    if self.debugMode {
                                        Button(action: {
                                            self.cliInstaller.installCLITool()
                                        }, label: {
                                            Image(systemName: "arrow.clockwise.circle")
                                                .font(.system(size: 14))
                                        })
                                        .buttonStyle(.plain)
                                        .foregroundColor(.accentColor)
                                        .help("Reinstall CLI tool")
                                    }

                                    Button(action: {
                                        Task {
                                            await self.cliInstaller.uninstall()
                                        }
                                    }, label: {
                                        Image(systemName: "trash")
                                            .font(.system(size: 14))
                                    })
                                    .buttonStyle(.plain)
                                    .foregroundColor(.red)
                                    .disabled(self.cliInstaller.isInstalling)
                                    .help("Uninstall CLI tool")
                                }
                            }
                        } else {
                            Button("Install 'vt' Command") {
                                Task {
                                    await self.cliInstaller.install()
                                }
                            }
                            .buttonStyle(.bordered)
                            .disabled(self.cliInstaller.isInstalling)
                        }
                    }
                }

                if let error = cliInstaller.lastError {
                    Text(error)
                        .font(.caption)
                        .foregroundColor(.red)
                } else {
                    HStack(alignment: .center, spacing: 8) {
                        if self.cliInstaller.isInstalled {
                            Text("The 'vt' command line tool is installed at /usr/local/bin/vt")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        } else {
                            Text("Install the 'vt' command line tool to /usr/local/bin for terminal access.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }

                        Spacer()

                        Button(action: {
                            self.showingVtConflictAlert = true
                        }, label: {
                            Text("Use a different name")
                                .font(.caption)
                        })
                        .buttonStyle(.link)
                    }
                }
            }
        } header: {
            Text("Command Line Tool")
                .font(.headline)
        } footer: {
            Text(
                "Prefix any terminal command with 'vt' to enable remote control.")
                .font(.caption)
                .frame(maxWidth: .infinity)
                .multilineTextAlignment(.center)
        }
        .onAppear {
            self.cliInstaller.checkInstallationStatus()
        }
        .alert("Using a Different Command Name", isPresented: self.$showingVtConflictAlert) {
            Button("OK") {}
            Button("Copy to Clipboard") {
                self.copyCommandToClipboard()
            }
        } message: {
            Text(self.vtConflictMessage)
        }
    }

    private var vtScriptPath: String {
        if let path = Bundle.main.path(forResource: "vt", ofType: nil) {
            return path
        }
        return "/Applications/VibeTunnel.app/Contents/Resources/vt"
    }

    private var vtConflictMessage: String {
        """
        You can install the `vt` bash script with a different name. For example:

        cp "\(self.vtScriptPath)" /usr/local/bin/vtunnel && chmod +x /usr/local/bin/vtunnel
        """
    }

    private func copyCommandToClipboard() {
        let command = "cp \"\(vtScriptPath)\" /usr/local/bin/vtunnel && chmod +x /usr/local/bin/vtunnel"
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(command, forType: .string)
    }
}
