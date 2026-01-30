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
    @Environment(TailscaleServeStatusService.self)
    var tailscaleServeStatus
    @Environment(\.colorScheme)
    private var colorScheme

    private var appDisplayName: String {
        let (debugMode, useDevServer) = AppConstants.getDevelopmentStatus()

        var name = debugMode ? "VibeTunnel Debug" : "VibeTunnel"
        if useDevServer, self.serverManager.isRunning {
            name += " Dev Server"
        }
        return name
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Title and status
            HStack {
                HStack(spacing: 8) {
                    Image(nsImage: NSImage(named: "AppIcon") ?? NSImage())
                        .resizable()
                        .frame(width: 24, height: 24)
                        .cornerRadius(4)
                        .padding(.leading, -5) // Align with small icons below

                    Text(self.appDisplayName)
                        .font(.system(size: 14, weight: .semibold))
                }

                Spacer()

                ServerStatusBadge(
                    isRunning: self.serverManager.isRunning)
                {
                    Task {
                        await self.serverManager.restart()
                    }
                }
            }

            // Server address
            if self.serverManager.isRunning {
                VStack(alignment: .leading, spacing: 4) {
                    ServerAddressRow()

                    if self.ngrokService.isActive, let publicURL = ngrokService.publicUrl {
                        ServerAddressRow(
                            icon: "network",
                            label: "ngrok:",
                            address: publicURL,
                            url: URL(string: publicURL))
                    }

                    if self.tailscaleService.isRunning, let hostname = tailscaleService.tailscaleHostname {
                        let isTailscaleServeEnabled = UserDefaults.standard
                            .bool(forKey: AppConstants.UserDefaultsKeys.tailscaleServeEnabled)
                        let isFunnelEnabledInSettings = UserDefaults.standard
                            .bool(forKey: AppConstants.UserDefaultsKeys.tailscaleFunnelEnabled)

                        // Check actual Funnel status from the service
                        let isFunnelActuallyRunning = isFunnelEnabledInSettings &&
                            self.tailscaleServeStatus.isRunning &&
                            self.tailscaleServeStatus.funnelEnabled

                        // Determine label based on actual state
                        let tailscaleLabel = if isFunnelEnabledInSettings, !isFunnelActuallyRunning {
                            // User wants Funnel but it's not working
                            if self.tailscaleServeStatus.funnelError != nil {
                                "Tailscale (Error):"
                            } else if !self.tailscaleServeStatus.isRunning {
                                "Tailscale (Starting...):"
                            } else {
                                "Tailscale (Private):" // Fallback to private if Funnel failed
                            }
                        } else if isFunnelActuallyRunning {
                            "Tailscale (Public):"
                        } else if isTailscaleServeEnabled, self.tailscaleServeStatus.isRunning {
                            "Tailscale (Private):"
                        } else if isTailscaleServeEnabled, !self.tailscaleServeStatus.isRunning {
                            "Tailscale (Starting...):"
                        } else {
                            "Tailscale:"
                        }

                        let icon: String = isFunnelActuallyRunning ? "globe" : "shield"

                        ServerAddressRow(
                            icon: icon,
                            label: tailscaleLabel,
                            address: TailscaleURLHelper.displayAddress(
                                hostname: hostname,
                                port: self.serverManager.port,
                                isTailscaleServeEnabled: isTailscaleServeEnabled,
                                isTailscaleServeRunning: self.tailscaleServeStatus.isRunning,
                                isFunnelEnabled: isFunnelActuallyRunning),
                            url: TailscaleURLHelper.constructURL(
                                hostname: hostname,
                                port: self.serverManager.port,
                                isTailscaleServeEnabled: isTailscaleServeEnabled,
                                isTailscaleServeRunning: self.tailscaleServeStatus.isRunning,
                                isFunnelEnabled: isFunnelActuallyRunning))
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
    @State private var isHovered = false
    @State private var showCopiedFeedback = false

    init(
        icon: String = "server.rack",
        label: String = "Local:",
        address: String? = nil,
        url: URL? = nil)
    {
        self.icon = icon
        self.label = label
        self.address = address ?? ""
        self.url = url
    }

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: self.icon)
                .font(.system(size: 10))
                .foregroundColor(AppColors.Fallback.serverRunning(for: self.colorScheme))
                .frame(width: 14, alignment: .center)
            Text(self.label)
                .font(.system(size: 11))
                .foregroundColor(.secondary)
            Button(action: {
                if let providedUrl = url {
                    NSWorkspace.shared.open(providedUrl)
                } else if self.computedAddress.starts(with: "127.0.0.1:") {
                    // For localhost, use DashboardURLBuilder
                    if let dashboardURL = DashboardURLBuilder.dashboardURL(port: serverManager.port) {
                        NSWorkspace.shared.open(dashboardURL)
                    }
                } else if let url = URL(string: "http://\(computedAddress)") {
                    // For other addresses (network IP, etc.), construct URL directly
                    NSWorkspace.shared.open(url)
                }
            }, label: {
                Text(self.computedAddress)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundColor(AppColors.Fallback.serverRunning(for: self.colorScheme))
                    .underline(self.isHovered)
            })
            .buttonStyle(.plain)
            .pointingHandCursor()

            // Copy button - always present but opacity changes on hover
            Button(action: {
                self.copyToClipboard()
            }, label: {
                Image(systemName: self.showCopiedFeedback ? "checkmark.circle.fill" : "doc.on.doc")
                    .font(.system(size: 10))
                    .foregroundColor(AppColors.Fallback.serverRunning(for: self.colorScheme))
            })
            .buttonStyle(.plain)
            .pointingHandCursor()
            .help(self.showCopiedFeedback ? "Copied!" : "Copy to clipboard")
            .opacity(self.isHovered ? 1.0 : 0.0)
            .animation(.easeInOut(duration: 0.15), value: self.isHovered)
        }
        .onHover { hovering in
            self.isHovered = hovering
        }
    }

    private var computedAddress: String {
        if !self.address.isEmpty {
            return self.address
        }

        // Default behavior for local server
        let bindAddress = self.serverManager.bindAddress
        if bindAddress == "127.0.0.1" {
            return "127.0.0.1:\(self.serverManager.port)"
        } else if let localIP = NetworkUtility.getLocalIPAddress() {
            return "\(localIP):\(self.serverManager.port)"
        } else {
            return "0.0.0.0:\(self.serverManager.port)"
        }
    }

    private var urlToCopy: String {
        // If we have a full URL, return it as-is
        if let providedUrl = url {
            return providedUrl.absoluteString
        }

        // For local addresses, build the full URL
        if self.computedAddress.starts(with: "127.0.0.1:") {
            return "http://\(self.computedAddress)"
        } else {
            return "http://\(self.computedAddress)"
        }
    }

    private func copyToClipboard() {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(self.urlToCopy, forType: .string)

        // Show feedback
        withAnimation(.easeInOut(duration: 0.15)) {
            self.showCopiedFeedback = true
        }

        // Hide feedback after 2 seconds
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            withAnimation(.easeInOut(duration: 0.15)) {
                self.showCopiedFeedback = false
            }
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
                .fill(
                    self.isRunning ? AppColors.Fallback.serverRunning(for: self.colorScheme) : AppColors.Fallback
                        .destructive(for: self.colorScheme))
                .frame(width: 6, height: 6)
            Text(self.isRunning ? "Running" : "Stopped")
                .font(.system(size: 10, weight: .medium))
                .foregroundColor(
                    self.isRunning ? AppColors.Fallback.serverRunning(for: self.colorScheme) : AppColors.Fallback
                        .destructive(for: self.colorScheme))
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(
            Capsule()
                .fill(
                    self.isRunning ? AppColors.Fallback.serverRunning(for: self.colorScheme).opacity(0.1) : AppColors
                        .Fallback
                        .destructive(for: self.colorScheme).opacity(0.1))
                .overlay(
                    Capsule()
                        .stroke(
                            self.isRunning ? AppColors.Fallback.serverRunning(for: self.colorScheme)
                                .opacity(0.3) : AppColors
                                .Fallback.destructive(for: self.colorScheme).opacity(0.3),
                            lineWidth: 0.5)))
        .opacity(self.isHovered && !self.isRunning ? 0.8 : 1.0)
        .scaleEffect(self.isHovered && !self.isRunning ? 0.95 : 1.0)
        .animation(.easeInOut(duration: 0.15), value: self.isHovered)
        .onHover { hovering in
            if !self.isRunning {
                self.isHovered = hovering
            }
        }
        .onTapGesture {
            if !self.isRunning, let onRestart {
                onRestart()
            }
        }
        .help(!self.isRunning ? "Click to restart server" : "")
    }
}
