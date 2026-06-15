import SwiftUI

/// Final onboarding page explaining local and remote dashboard access.
///
/// This view provides information about accessing the VibeTunnel dashboard
/// locally or from another device through Tailscale.
///
/// ## Topics
///
/// ### Overview
/// The dashboard access page includes:
/// - Local dashboard access
/// - Tailscale setup steps
/// - Direct navigation to Remote settings
///
/// ### Networking Options
/// - Local access via localhost
/// - Tailscale VPN recommendation
struct AccessDashboardPageView: View {
    @AppStorage(AppConstants.UserDefaultsKeys.serverPort)
    private var serverPort = "4020"

    var body: some View {
        VStack(spacing: 14) {
            Text("Access VibeTunnel Anywhere")
                .font(.largeTitle)
                .fontWeight(.semibold)

            Text(
                "The dashboard works locally now. For access from your phone or another computer, connect both devices through **Tailscale** (recommended).")
                .font(.callout)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 500)
                .fixedSize(horizontal: false, vertical: true)

            VStack(alignment: .leading, spacing: 7) {
                RemoteAccessSetupStep(number: 1, text: "Install Tailscale on this Mac and your other device.")
                RemoteAccessSetupStep(number: 2, text: "Sign in to the same Tailscale account on both devices.")
                RemoteAccessSetupStep(
                    number: 3,
                    text: "Enable Tailscale Integration in Remote settings, then open the displayed URL.")
            }
            .frame(maxWidth: 500, alignment: .leading)

            HStack(spacing: 12) {
                Button(action: {
                    if let dashboardURL = DashboardURLBuilder.dashboardURL(port: serverPort) {
                        NSWorkspace.shared.open(dashboardURL)
                    }
                }, label: {
                    Label("Open Local Dashboard", systemImage: "safari")
                })
                .buttonStyle(.bordered)
                .controlSize(.large)

                Button(action: {
                    SettingsOpener.openSettingsTab(.remoteAccess)
                }, label: {
                    Label("Configure Remote Access", systemImage: "network")
                })
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .accessibilityIdentifier("configure-remote-access")
            }

            Button(action: {
                if let tailscaleURL = URL(string: URLConstants.tailscaleInstallGuide) {
                    NSWorkspace.shared.open(tailscaleURL)
                }
            }, label: {
                Label("Tailscale installation guide", systemImage: "questionmark.circle")
            })
            .buttonStyle(.link)
            .pointingHandCursor()
        }
        .padding()
    }
}

// MARK: - Supporting Views

private struct RemoteAccessSetupStep: View {
    let number: Int
    let text: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text("\(self.number)")
                .font(.caption.bold())
                .foregroundStyle(.white)
                .frame(width: 20, height: 20)
                .background(Circle().fill(Color.accentColor))

            Text(self.text)
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Preview

#Preview("Access Dashboard Page") {
    AccessDashboardPageView()
        .frame(width: 640, height: 480)
        .background(Color(NSColor.windowBackgroundColor))
}
