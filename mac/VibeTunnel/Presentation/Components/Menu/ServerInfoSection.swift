import AppKit
import SwiftUI

// MARK: - Server Info Header

/// Header section of the menu showing server status and connection info.
///
/// Displays the VibeTunnel logo, server running status, and available
/// connection addresses including local, ngrok, and Tailscale endpoints.
struct ServerInfoHeader: View {
    @Environment(ServerManager.self)
    var serverManager
    @Environment(NgrokService.self)
    var ngrokService
    @Environment(TailscaleService.self)
    var tailscaleService
    @Environment(\.colorScheme)
    private var colorScheme

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Title and status
            HStack {
                HStack(spacing: 8) {
                    Image(nsImage: NSImage(named: "AppIcon") ?? NSImage())
                        .resizable()
                        .frame(width: 24, height: 24)
                        .cornerRadius(4)

                    Text("VibeTunnel")
                        .font(.system(size: 14, weight: .semibold))
                }

                Spacer()

                ServerStatusBadge(
                    isRunning: serverManager.isRunning
                ) {
                    Task {
                        await serverManager.restart()
                    }
                }
            }

            // Server address
            if serverManager.isRunning {
                VStack(alignment: .leading, spacing: 4) {
                    ServerAddressRow()

                    if ngrokService.isActive, let publicURL = ngrokService.publicUrl {
                        ServerAddressRow(
                            icon: "network",
                            label: "ngrok:",
                            address: publicURL,
                            url: URL(string: publicURL)
                        )
                    }

                    if tailscaleService.isRunning, let hostname = tailscaleService.tailscaleHostname {
                        ServerAddressRow(
                            icon: "shield",
                            label: "Tailscale:",
                            address: hostname,
                            url: URL(string: "http://\(hostname):\(serverManager.port)")
                        )
                    }
                }
            }
        }
    }
}

/// Displays a clickable server address with an icon and label.
///
/// Shows connection endpoints that can be clicked to open in the browser,
/// with support for local addresses, ngrok tunnels, and Tailscale connections.
struct ServerAddressRow: View {
    let icon: String
    let label: String
    let address: String
    let url: URL?

    @Environment(ServerManager.self)
    var serverManager
    @Environment(\.colorScheme)
    private var colorScheme

    init(
        icon: String = "server.rack",
        label: String = "Local:",
        address: String? = nil,
        url: URL? = nil
    ) {
        self.icon = icon
        self.label = label
        self.address = address ?? ""
        self.url = url
    }

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: icon)
                .font(.system(size: 10))
                .foregroundColor(AppColors.Fallback.serverRunning(for: colorScheme))
            Text(label)
                .font(.system(size: 11))
                .foregroundColor(.secondary)
            Button(action: {
                if let providedUrl = url {
                    NSWorkspace.shared.open(providedUrl)
                } else if computedAddress.starts(with: "127.0.0.1:") {
                    // For localhost, use DashboardURLBuilder
                    if let dashboardURL = DashboardURLBuilder.dashboardURL(port: serverManager.port) {
                        NSWorkspace.shared.open(dashboardURL)
                    }
                } else if let url = URL(string: "http://\(computedAddress)") {
                    // For other addresses (network IP, etc.), construct URL directly
                    NSWorkspace.shared.open(url)
                }
            }) {
                Text(computedAddress)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundColor(AppColors.Fallback.serverRunning(for: colorScheme))
                    .underline()
            }
            .buttonStyle(.plain)
            .pointingHandCursor()
        }
    }

    private var computedAddress: String {
        if !address.isEmpty {
            return address
        }

        // Default behavior for local server
        let bindAddress = serverManager.bindAddress
        if bindAddress == "127.0.0.1" {
            return "127.0.0.1:\(serverManager.port)"
        } else if let localIP = NetworkUtility.getLocalIPAddress() {
            return "\(localIP):\(serverManager.port)"
        } else {
            return "0.0.0.0:\(serverManager.port)"
        }
    }
}

/// Visual indicator for server running status.
///
/// Shows a colored badge with status text indicating whether
/// the VibeTunnel server is currently running or stopped.
/// When stopped, the badge is clickable to restart the server.
struct ServerStatusBadge: View {
    let isRunning: Bool
    let onRestart: (() -> Void)?

    @Environment(\.colorScheme)
    private var colorScheme
    @State private var isHovered = false

    var body: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(isRunning ? AppColors.Fallback.serverRunning(for: colorScheme) : AppColors.Fallback
                    .destructive(for: colorScheme)
                )
                .frame(width: 6, height: 6)
            Text(isRunning ? "Running" : "Stopped")
                .font(.system(size: 10, weight: .medium))
                .foregroundColor(isRunning ? AppColors.Fallback.serverRunning(for: colorScheme) : AppColors.Fallback
                    .destructive(for: colorScheme)
                )
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(
            Capsule()
                .fill(isRunning ? AppColors.Fallback.serverRunning(for: colorScheme).opacity(0.1) : AppColors.Fallback
                    .destructive(for: colorScheme).opacity(0.1)
                )
                .overlay(
                    Capsule()
                        .stroke(
                            isRunning ? AppColors.Fallback.serverRunning(for: colorScheme).opacity(0.3) : AppColors
                                .Fallback.destructive(for: colorScheme).opacity(0.3),
                            lineWidth: 0.5
                        )
                )
        )
        .opacity(isHovered && !isRunning ? 0.8 : 1.0)
        .scaleEffect(isHovered && !isRunning ? 0.95 : 1.0)
        .animation(.easeInOut(duration: 0.15), value: isHovered)
        .onHover { hovering in
            if !isRunning {
                isHovered = hovering
            }
        }
        .onTapGesture {
            if !isRunning, let onRestart {
                onRestart()
            }
        }
        .help(!isRunning ? "Click to restart server" : "")
    }
}
