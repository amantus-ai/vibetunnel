import SwiftUI

/// Second page explaining the VT command-line tool and installation.
///
/// This view guides users through installing the `vt` command-line tool,
/// which is essential for capturing terminal applications. It displays
/// installation status and provides clear examples of usage.
///
/// ## Topics
///
/// ### Overview
/// The VT command page includes:
/// - Explanation of terminal app capturing
/// - Example usage of the `vt` command
/// - CLI tool installation button with status feedback
/// - Error handling for installation failures
///
/// ### Requirements
/// - ``CLIInstaller`` instance for managing installation
struct VTCommandPageView: View {
    /// The CLI installer instance managing the installation process
    var cliInstaller: CLIInstaller

    var body: some View {
        VStack(spacing: 30) {
            VStack(spacing: 16) {
                Text("Capturing Terminal Apps")
                    .font(.largeTitle)
                    .fontWeight(.semibold)

                Text(
                    "VibeTunnel can capture any terminal app or terminal.\nJust prefix it with the `vt` command and it will show up on the dashboard."
                )
                .font(.body)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 480)
                .fixedSize(horizontal: false, vertical: true)

                Text("For example, to remote control AI assistants, type:")
                    .font(.body)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)

                Text("vt claude  or  vt gemini")
                    .font(.system(.body, design: .monospaced))
                    .foregroundColor(.primary)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .background(Color.gray.opacity(0.1))
                    .cornerRadius(6)

                // Install VT Binary button
                VStack(spacing: 12) {
                    if cliInstaller.isInstalled {
                        if cliInstaller.isOutdated {
                            HStack {
                                Image(systemName: "exclamationmark.triangle.fill")
                                    .foregroundColor(.orange)
                                Text("CLI tool is outdated")
                                    .foregroundColor(.secondary)
                            }

                            Button("Update VT Command Line Tool") {
                                Task {
                                    await cliInstaller.install()
                                }
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(cliInstaller.isInstalling)
                        } else {
                            HStack {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundColor(.green)
                                Text("CLI tool is installed")
                                    .foregroundColor(.secondary)
                            }
                        }
                    } else {
                        Button("Install VT Command Line Tool") {
                            Task {
                                await cliInstaller.install()
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(cliInstaller.isInstalling)

                        if cliInstaller.isInstalling {
                            ProgressView()
                                .scaleEffect(0.8)
                        }
                    }

                    if let error = cliInstaller.lastError {
                        Text(error)
                            .font(.caption)
                            .foregroundColor(.red)
                            .frame(maxWidth: 300)
                    }
                }
            }
            Spacer()
        }
        .padding()
        .onAppear {
            // Check installation status synchronously on appear
            cliInstaller.checkInstallationStatus()
        }
    }
}

// MARK: - Preview

#Preview("VT Command Page") {
    VTCommandPageView(cliInstaller: CLIInstaller())
        .frame(width: 640, height: 480)
        .background(Color(NSColor.windowBackgroundColor))
}
