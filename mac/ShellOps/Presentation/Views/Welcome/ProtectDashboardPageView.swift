import SwiftUI

/// Fourth page explaining dashboard security and authentication.
///
/// This view explains how the dashboard is protected using the system's
/// built-in authentication. Users don't need to set up a password as
/// authentication uses their macOS username and password by default.
///
/// ## Topics
///
/// ### Overview
/// The dashboard protection page includes:
/// - Explanation of OS-based authentication
/// - Information about SSH key authentication option
/// - Link to settings for authentication configuration
///
/// ### Security
/// - Uses macOS system authentication (PAM) by default
/// - SSH key authentication available as an alternative
/// - No separate password setup required
struct ProtectDashboardPageView: View {
    @State private var showingSettings = false

    var body: some View {
        VStack(spacing: 30) {
            VStack(spacing: 16) {
                Text("Dashboard Security")
                    .font(.largeTitle)
                    .fontWeight(.semibold)

                Text(
                    "Your dashboard is protected using your macOS username and password.\nNo additional setup is required.")
                    .font(.body)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 480)
                    .fixedSize(horizontal: false, vertical: true)

                // Authentication info
                VStack(spacing: 20) {
                    // Authentication methods
                    VStack(alignment: .leading, spacing: 12) {
                        Label {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("macOS Authentication")
                                    .font(.callout)
                                    .fontWeight(.medium)
                                Text("Uses your system username and password")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                        } icon: {
                            Image(systemName: "person.badge.shield.checkmark.fill")
                                .foregroundColor(.green)
                        }

                        Label {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("SSH Key Authentication")
                                    .font(.callout)
                                    .fontWeight(.medium)
                                Text("Available as an alternative in Settings")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                        } icon: {
                            Image(systemName: "key.fill")
                                .foregroundColor(.blue)
                        }
                    }
                    .padding()
                    .background(Color(NSColor.controlBackgroundColor))
                    .cornerRadius(8)
                    .frame(maxWidth: 400)

                    Text("You can configure authentication methods later in Settings")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
            Spacer()
        }
        .padding()
    }
}

// MARK: - Preview

#Preview("Protect Dashboard Page") {
    ProtectDashboardPageView()
        .frame(width: 640, height: 480)
        .background(Color(NSColor.windowBackgroundColor))
}
