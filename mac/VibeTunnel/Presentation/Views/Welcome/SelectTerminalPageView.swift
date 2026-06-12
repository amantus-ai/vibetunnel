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
    @State private var recoveryPermission: SystemPermission?

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
            if let recoveryPermission = self.recoveryPermission {
                Button("Open System Settings") {
                    if let url = recoveryPermission.settingsURL {
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
                let alert = TerminalLaunchAlertContent(
                    error: error,
                    terminalName: Terminal(rawValue: self.preferredTerminal)?.displayName ?? "terminal")
                self.errorTitle = alert.title
                self.errorMessage = alert.message
                self.recoveryPermission = alert.recoveryPermission

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
