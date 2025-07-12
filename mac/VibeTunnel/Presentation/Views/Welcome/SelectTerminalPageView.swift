import SwiftUI

/// Terminal selection page for choosing the preferred terminal application.
///
/// This view allows users to select their preferred terminal and test
/// the automation permission by launching a test command.
///
/// ## Topics
///
/// ### Overview
/// The terminal selection page includes:
/// - Terminal application picker
/// - Test button to verify terminal automation works
/// - Error handling for permission issues
struct SelectTerminalPageView: View {
    @AppStorage(AppConstants.UserDefaultsKeys.preferredTerminal)
    private var preferredTerminal = Terminal.terminal.rawValue
    private let terminalLauncher = TerminalLauncher.shared
    @State private var showingError = false
    @State private var errorTitle = ""
    @State private var errorMessage = ""

    var body: some View {
        VStack(spacing: 30) {
            VStack(spacing: 16) {
                Text("Select Terminal")
                    .font(.largeTitle)
                    .fontWeight(.semibold)

                Text(
                    "VibeTunnel can spawn new sessions and open a terminal for you.\nSelect your preferred Terminal and test permissions."
                )
                .font(.body)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 480)
                .fixedSize(horizontal: false, vertical: true)

                // Terminal selector and test button
                VStack(spacing: 16) {
                    // Terminal picker
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
                    .frame(width: 168)

                    // Test terminal button
                    Button("Test Terminal Permission") {
                        testTerminal()
                    }
                    .buttonStyle(.borderedProminent)
                    .frame(width: 200)
                }
            }
            Spacer()
        }
        .padding()
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

    func testTerminal() {
        Task {
            do {
                try terminalLauncher
                    .launchCommand(
                        "echo 'VibeTunnel Terminal Test: Success! You can now use VibeTunnel with your terminal.'"
                    )
            } catch {
                // Handle errors
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
                                errorMessage = "The terminal did not respond to the command.\n\nDetails: \(details)"
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
}

// MARK: - Preview

#Preview("Select Terminal Page") {
    SelectTerminalPageView()
        .frame(width: 640, height: 480)
        .background(Color(NSColor.windowBackgroundColor))
}
