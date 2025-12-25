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
                    "VibeTunnel can spawn new sessions and open a terminal for you.\nSelect your preferred Terminal and test permissions.")
                    .font(.body)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 480)
                    .fixedSize(horizontal: false, vertical: true)

                // Terminal selector and test button
                VStack(spacing: 16) {
                    // Terminal picker
                    Picker("", selection: self.$preferredTerminal) {
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
                        self.testTerminal()
                    }
                    .buttonStyle(.borderedProminent)
                    .frame(width: 200)
                }
            }
            Spacer()
        }
        .padding()
        .alert(self.errorTitle, isPresented: self.$showingError) {
            Button("OK") {}
            if self.errorTitle == "Permission Denied" {
                Button("Open System Settings") {
                    if let url =
                        URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation")
                    {
                        NSWorkspace.shared.open(url)
                    }
                }
            }
        } message: {
            Text(self.errorMessage)
        }
    }

    func testTerminal() {
        Task {
            do {
                try self.terminalLauncher
                    .launchCommand(
                        "echo 'VibeTunnel Terminal Test: Success! You can now use VibeTunnel with your terminal.'")
            } catch {
                // Handle errors
                if let terminalError = error as? TerminalLauncherError {
                    switch terminalError {
                    case .appleScriptPermissionDenied:
                        self.errorTitle = "Permission Denied"
                        self.errorMessage =
                            "VibeTunnel needs permission to control terminal applications.\n\nPlease grant Automation permission in System Settings > Privacy & Security > Automation."
                    case .accessibilityPermissionDenied:
                        self.errorTitle = "Accessibility Permission Required"
                        self.errorMessage =
                            "VibeTunnel needs Accessibility permission to send keystrokes to \(Terminal(rawValue: self.preferredTerminal)?.displayName ?? "terminal").\n\nPlease grant permission in System Settings > Privacy & Security > Accessibility."
                    case .terminalNotFound:
                        self.errorTitle = "Terminal Not Found"
                        self.errorMessage =
                            "The selected terminal application could not be found. Please select a different terminal."
                    case let .appleScriptExecutionFailed(details, errorCode):
                        if let code = errorCode {
                            switch code {
                            case -1743:
                                self.errorTitle = "Permission Denied"
                                self.errorMessage =
                                    "VibeTunnel needs permission to control terminal applications.\n\nPlease grant Automation permission in System Settings > Privacy & Security > Automation."
                            case -1728:
                                self.errorTitle = "Terminal Not Available"
                                self.errorMessage =
                                    "The terminal application is not running or cannot be controlled.\n\nDetails: \(details)"
                            case -1708:
                                self.errorTitle = "Terminal Communication Error"
                                self.errorMessage = "The terminal did not respond to the command.\n\nDetails: \(details)"
                            case -25211:
                                self.errorTitle = "Accessibility Permission Required"
                                self.errorMessage =
                                    "System Events requires Accessibility permission to send keystrokes.\n\nPlease grant permission in System Settings > Privacy & Security > Accessibility."
                            default:
                                self.errorTitle = "Terminal Launch Failed"
                                self.errorMessage = "AppleScript error \(code): \(details)"
                            }
                        } else {
                            self.errorTitle = "Terminal Launch Failed"
                            self.errorMessage = "Failed to launch terminal: \(details)"
                        }
                    case let .processLaunchFailed(details):
                        self.errorTitle = "Process Launch Failed"
                        self.errorMessage = "Failed to start terminal process: \(details)"
                    }
                } else {
                    self.errorTitle = "Terminal Launch Failed"
                    self.errorMessage = error.localizedDescription
                }

                self.showingError = true
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
