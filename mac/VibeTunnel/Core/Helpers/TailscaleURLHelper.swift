import Foundation

/// Helper for constructing Tailscale URLs based on configuration
enum TailscaleURLHelper {
    /// Constructs a Tailscale URL based on whether Tailscale Serve is enabled
    /// - Parameters:
    ///   - hostname: The Tailscale hostname
    ///   - port: The server port
    ///   - isTailscaleServeEnabled: Whether Tailscale Serve integration is enabled
    /// - Returns: The appropriate URL for accessing via Tailscale
    static func constructURL(hostname: String, port: String, isTailscaleServeEnabled: Bool) -> URL? {
        if isTailscaleServeEnabled {
            // When Tailscale Serve is enabled, use HTTPS without port
            return URL(string: "https://\(hostname)")
        } else {
            // When Tailscale Serve is disabled, use HTTP with port
            return URL(string: "http://\(hostname):\(port)")
        }
    }
    
    /// Gets the display address for Tailscale based on configuration
    /// - Parameters:
    ///   - hostname: The Tailscale hostname
    ///   - port: The server port
    ///   - isTailscaleServeEnabled: Whether Tailscale Serve integration is enabled
    /// - Returns: The display string for the Tailscale address
    static func displayAddress(hostname: String, port: String, isTailscaleServeEnabled: Bool) -> String {
        if isTailscaleServeEnabled {
            // When Tailscale Serve is enabled, show hostname only
            return hostname
        } else {
            // When Tailscale Serve is disabled, show hostname:port
            return "\(hostname):\(port)"
        }
    }
}