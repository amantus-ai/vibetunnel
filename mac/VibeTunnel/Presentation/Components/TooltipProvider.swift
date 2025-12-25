import Foundation

/// A provider for generating tooltip strings for the status bar item.
///
/// This component centralizes the logic for creating the detailed tooltip,
/// combining information from various services into a single, formatted string.
enum TooltipProvider {
    /// Generates the tooltip string based on the current state of the application.
    ///
    /// - Parameters:
    ///   - serverManager: The manager for the VibeTunnel server.
    ///   - ngrokService: The service for managing ngrok tunnels.
    ///   - tailscaleService: The service for managing Tailscale connectivity.
    ///   - sessionMonitor: The monitor for active terminal sessions.
    /// - Returns: A formatted string to be used as the tooltip for the status bar item.
    @MainActor
    static func generateTooltip(
        serverManager: ServerManager,
        ngrokService: NgrokService,
        tailscaleService: TailscaleService,
        sessionMonitor: SessionMonitor)
        -> String
    {
        var tooltipParts: [String] = []

        // Server status
        if serverManager.isRunning {
            let bindAddress = serverManager.bindAddress
            if bindAddress == "127.0.0.1" {
                tooltipParts.append("Server: 127.0.0.1:\(serverManager.port)")
            } else if let localIP = NetworkUtility.getLocalIPAddress() {
                tooltipParts.append("Server: \(localIP):\(serverManager.port)")
            } else {
                // Fallback when no local IP is found
                tooltipParts.append("Server: 0.0.0.0:\(serverManager.port)")
            }

            // ngrok status
            if ngrokService.isActive, let publicURL = ngrokService.publicUrl {
                tooltipParts.append("ngrok: \(publicURL)")
            }

            // Tailscale status
            if tailscaleService.isRunning, let hostname = tailscaleService.tailscaleHostname {
                tooltipParts.append("Tailscale: \(hostname)")
            }
        } else {
            tooltipParts.append("Server stopped")
        }

        // Session info
        let sessions = sessionMonitor.sessions.values.filter(\.isRunning)
        if !sessions.isEmpty {
            tooltipParts.append("\(sessions.count) running session\(sessions.count == 1 ? "" : "s")")
        }

        return tooltipParts.joined(separator: "\n")
    }
}
