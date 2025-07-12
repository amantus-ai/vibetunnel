import SwiftUI

/// Fifth page showing how to access the dashboard and ngrok integration.
///
/// This view provides information about accessing the VibeTunnel dashboard
/// from various devices, including options for ngrok tunneling and Tailscale
/// networking. It also displays project credits.
///
/// ## Topics
///
/// ### Overview
/// The dashboard access page includes:
/// - Instructions for remote dashboard access
/// - Open Dashboard button for local access
/// - Information about tunneling options (ngrok, Tailscale)
/// - Project credits and contributor links
///
/// ### Networking Options
/// - Local access via localhost
/// - ngrok tunnel configuration
/// - Tailscale VPN recommendation
struct AccessDashboardPageView: View {
    @AppStorage("ngrokEnabled")
    private var ngrokEnabled = false
    @AppStorage(AppConstants.UserDefaultsKeys.serverPort)
    private var serverPort = "4020"

    var body: some View {
        VStack(spacing: 30) {
            VStack(spacing: 16) {
                Text("Accessing Your Dashboard")
                    .font(.largeTitle)
                    .fontWeight(.semibold)

                Text(
                    "To access your terminals from any device, create a tunnel from your device.\n\nThis can be done via **ngrok** in settings or **Cloudflare** or **Tailscale**."
                )
                .font(.body)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 480)
                .fixedSize(horizontal: false, vertical: true)

                VStack(spacing: 12) {
                    // Open Dashboard button
                    Button(action: {
                        if let dashboardURL = DashboardURLBuilder.dashboardURL(port: serverPort) {
                            NSWorkspace.shared.open(dashboardURL)
                        }
                    }, label: {
                        HStack {
                            Image(systemName: "safari")
                            Text("Open Dashboard")
                        }
                    })
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)

                    // Tailscale link button
                    TailscaleLink()
                }
            }

            // Credits
            VStack(spacing: 4) {
                Text("VibeTunnel is open source and brought to you by")
                    .font(.caption)
                    .foregroundColor(.secondary)

                HStack(spacing: 4) {
                    CreditLink(name: "@badlogic", url: "https://mariozechner.at/")

                    Text("•")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    CreditLink(name: "@mitsuhiko", url: "https://lucumr.pocoo.org/")

                    Text("•")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    CreditLink(name: "@steipete", url: "https://steipete.me")
                }
            }
            Spacer()
        }
        .padding()
    }
}

// MARK: - Supporting Views

/// Tailscale link component with hover effect
struct TailscaleLink: View {
    @State private var isHovering = false

    var body: some View {
        Button(action: {
            if let tailscaleURL = URL(string: "https://tailscale.com/") {
                NSWorkspace.shared.open(tailscaleURL)
            }
        }, label: {
            HStack {
                Image(systemName: "link")
                Text("Learn more about Tailscale")
                    .underline(isHovering, color: .accentColor)
            }
        })
        .buttonStyle(.link)
        .pointingHandCursor()
        .onHover { hovering in
            withAnimation(.easeInOut(duration: 0.2)) {
                isHovering = hovering
            }
        }
    }
}

// MARK: - Preview

#Preview("Access Dashboard Page") {
    AccessDashboardPageView()
        .frame(width: 640, height: 480)
        .background(Color(NSColor.windowBackgroundColor))
}
