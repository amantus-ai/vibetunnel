import OSLog
import SwiftUI

// MARK: - Logger

extension Logger {
    fileprivate static let advanced = Logger(subsystem: "com.vibetunnel.VibeTunnel", category: "AdvancedSettings")
}

/// Advanced settings tab for power user options
struct AdvancedSettingsView: View {
    @AppStorage("debugMode")
    private var debugMode = false
    @AppStorage("cleanupOnStartup")
    private var cleanupOnStartup = true
    @AppStorage("showInDock")
    private var showInDock = false
    @State private var cliInstaller = CLIInstaller()

    var body: some View {
        NavigationStack {
            Form {
                // Terminal preference section
                TerminalPreferenceSection()

                // Integration section
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text("Install CLI Tool")
                            Spacer()
                            if cliInstaller.isInstalled {
                                HStack {
                                    Image(systemName: "checkmark.circle.fill")
                                        .foregroundColor(.green)
                                    Text("CLI tool is installed")
                                        .foregroundColor(.secondary)
                                }
                            } else {
                                Button("Install 'vt' Command") {
                                    Task {
                                        await cliInstaller.install()
                                    }
                                }
                                .buttonStyle(.bordered)
                                .disabled(cliInstaller.isInstalling)
                            }
                        }

                        if cliInstaller.isInstalling {
                            ProgressView()
                                .scaleEffect(0.8)
                        }

                        if let error = cliInstaller.lastError {
                            Text(error)
                                .font(.caption)
                                .foregroundColor(.red)
                        } else if cliInstaller.isInstalled {
                            Text("The 'vt' command line tool is installed at /usr/local/bin/vt")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        } else {
                            Text("Install the 'vt' command line tool to /usr/local/bin for terminal access.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                } header: {
                    Text("Integration")
                        .font(.headline)
                } footer: {
                    Text(
                        "Prefix any terminal command with 'vt' to enable remote control."
                    )
                    .font(.caption)
                    .frame(maxWidth: .infinity)
                    .multilineTextAlignment(.center)
                }

                // Advanced section
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Toggle("Clean up old sessions on startup", isOn: $cleanupOnStartup)
                        Text("Automatically remove terminated sessions when the app starts.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    // Show in Dock
                    VStack(alignment: .leading, spacing: 4) {
                        Toggle("Show in Dock", isOn: showInDockBinding)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Show VibeTunnel icon in the Dock.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text("The dock icon is always displayed when the Settings dialog is visible.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }

                    // Debug mode toggle
                    VStack(alignment: .leading, spacing: 4) {
                        Toggle("Debug mode", isOn: $debugMode)
                        Text("Enable additional logging and debugging features.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                } header: {
                    Text("Advanced")
                        .font(.headline)
                }
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
            .navigationTitle("Advanced Settings")
        }
        .onAppear {
            cliInstaller.checkInstallationStatus()
        }
    }

    private var showInDockBinding: Binding<Bool> {
        Binding(
            get: { showInDock },
            set: { newValue in
                showInDock = newValue
                // Don't change activation policy while settings window is open
                // The change will be applied when the settings window closes
            }
        )
    }
}

// MARK: - Terminal Preference Section

private struct TerminalPreferenceSection: View {
    @AppStorage("preferredTerminal")
    private var preferredTerminal = Terminal.terminal.rawValue
    @State private var terminalLauncher = TerminalLauncher.shared
    @State private var showingError = false
    @State private var errorMessage = ""
    @State private var errorTitle = "Terminal Launch Failed"

    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Preferred Terminal")
                    Spacer()
                    Picker("", selection: $preferredTerminal) {
                        ForEach(Terminal.installed, id: \.rawValue) { terminal in
                            HStack {
                                if let icon = terminal.appIcon {
                                    Image(nsImage: icon.resized(to: NSSize(width: 16, height: 16)))
                                }
                                Text(terminal.displayName)
                            }
                            .tag(terminal.rawValue)
                        }
                    }
                    .pickerStyle(.menu)
                    .labelsHidden()
                }
                Text("Select which application to use when creating new sessions")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                // Test button
                HStack {
                    Text("Test Terminal")
                    Spacer()
                    Button("Test with 'echo'") {
                        Task {
                            do {
                                try terminalLauncher.launchCommand("echo 'VibeTunnel Terminal Test: Success!'")
                            } catch {
                                // Log the error
                                Logger.advanced.error("Failed to launch terminal test: \(error)")

                                // Set up alert content based on error type
                                if let terminalError = error as? TerminalLauncherError {
                                    switch terminalError {
                                    case .appleScriptPermissionDenied:
                                        errorTitle = "Permission Denied"
                                        errorMessage =
                                            "VibeTunnel needs permission to control terminal applications.\n\nPlease grant Automation permission in System Settings > Privacy & Security > Automation."
                                    case .accessibilityPermissionDenied:
                                        errorTitle = "Accessibility Permission Required"
                                        errorMessage =
                                            "VibeTunnel needs Accessibility permission to send keystrokes to \(Terminal(rawValue: preferredTerminal)?.displayName ?? "terminal").\n\nPlease grant permission in System Settings > Privacy & Security > Accessibility."
                                    case .terminalNotFound:
                                        errorTitle = "Terminal Not Found"
                                        errorMessage =
                                            "The selected terminal application could not be found. Please select a different terminal."
                                    case .appleScriptExecutionFailed(let details, let errorCode):
                                        if let code = errorCode {
                                            switch code {
                                            case -1_743:
                                                errorTitle = "Permission Denied"
                                                errorMessage =
                                                    "VibeTunnel needs permission to control terminal applications.\n\nPlease grant Automation permission in System Settings > Privacy & Security > Automation."
                                            case -1_728:
                                                errorTitle = "Terminal Not Available"
                                                errorMessage =
                                                    "The terminal application is not running or cannot be controlled.\n\nDetails: \(details)"
                                            case -1_708:
                                                errorTitle = "Terminal Communication Error"
                                                errorMessage =
                                                    "The terminal did not respond to the command.\n\nDetails: \(details)"
                                            case -25_211:
                                                errorTitle = "Accessibility Permission Required"
                                                errorMessage =
                                                    "System Events requires Accessibility permission to send keystrokes.\n\nPlease grant permission in System Settings > Privacy & Security > Accessibility."
                                            default:
                                                errorTitle = "Terminal Launch Failed"
                                                errorMessage = "AppleScript error \(code): \(details)"
                                            }
                                        } else {
                                            errorTitle = "Terminal Launch Failed"
                                            errorMessage = "Failed to launch terminal: \(details)"
                                        }
                                    case .processLaunchFailed(let details):
                                        errorTitle = "Process Launch Failed"
                                        errorMessage = "Failed to start terminal process: \(details)"
                                    }
                                } else {
                                    errorTitle = "Terminal Launch Failed"
                                    errorMessage = error.localizedDescription
                                }

                                showingError = true
                            }
                        }
                    }
                    .buttonStyle(.bordered)
                }
                Text("Opens a new terminal window with a test command")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        } header: {
            Text("Terminal")
                .font(.headline)
        } footer: {
            Text(
                "VibeTunnel will use this terminal when launching new terminal sessions."
            )
            .font(.caption)
            .frame(maxWidth: .infinity)
            .multilineTextAlignment(.center)
        }
        .alert(errorTitle, isPresented: $showingError) {
            Button("OK") {}
            if errorTitle == "Permission Denied" {
                Button("Open System Settings") {
                    if let url =
                        URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation")
                    {
                        NSWorkspace.shared.open(url)
                    }
                }
            }
        } message: {
            Text(errorMessage)
        }
    }
}
