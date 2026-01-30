import Foundation
import os.log

private let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "TailscaleURLHelper")

/// Helper for constructing Tailscale URLs based on configuration
enum TailscaleURLHelper {
    /// Gets the Tailscale IPv4 address for this machine
    static func getTailscaleIP() -> String? {
        // Try multiple locations for the tailscale binary
        let possiblePaths = [
            "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
            "/opt/homebrew/bin/tailscale",
            "/usr/local/bin/tailscale",
        ]

        var tailscalePath: String?
        for path in possiblePaths where FileManager.default.fileExists(atPath: path) {
            tailscalePath = path
            break
        }

        guard let executablePath = tailscalePath else {
            logger.info("Tailscale binary not found in any expected location")
            return nil
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: executablePath)
        process.arguments = ["ip", "-4"]

        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = Pipe() // Suppress errors

        do {
            try process.run()
            process.waitUntilExit()

            if process.terminationStatus == 0 {
                let data = pipe.fileHandleForReading.readDataToEndOfFile()
                let output = String(data: data, encoding: .utf8)?
                    .trimmingCharacters(in: .whitespacesAndNewlines)

                // Validate that we got an IP address and not an error message
                if let output {
                    // Check if it looks like an IP address (basic validation)
                    // Valid IP should be like "100.68.180.82"
                    let ipComponents = output.components(separatedBy: ".")
                    if ipComponents.count == 4,
                       ipComponents.allSatisfy({
                           guard let value = Int($0) else { return false }
                           return (0...255).contains(value)
                       })
                    {
                        return output
                    } else {
                        logger.error("Tailscale command returned invalid IP: '\(output, privacy: .public)'")
                        return nil
                    }
                }
                return nil
            } else {
                logger.info("Tailscale IP command failed with status: \(process.terminationStatus)")
            }
        } catch {
            logger.info("Failed to get Tailscale IP: \(error)")
        }

        return nil
    }

    /// Constructs a Tailscale URL based on whether Tailscale Serve is enabled and running
    /// - Parameters:
    ///   - hostname: The Tailscale hostname
    ///   - port: The server port
    ///   - isTailscaleServeEnabled: Whether Tailscale Serve integration is enabled
    ///   - isTailscaleServeRunning: Whether Tailscale Serve is actually running (optional)
    ///   - isFunnelEnabled: Whether Funnel (Public mode) is enabled (optional)
    /// - Returns: The appropriate URL for accessing via Tailscale
    static func constructURL(
        hostname: String,
        port: String,
        isTailscaleServeEnabled: Bool,
        isTailscaleServeRunning: Bool? = nil,
        isFunnelEnabled: Bool? = nil)
        -> URL?
    {
        // Check if we should use Serve URL
        let useServeURL = isTailscaleServeEnabled && (isTailscaleServeRunning ?? true)

        // Check if Funnel (Public mode) is enabled
        let isPublicMode = isFunnelEnabled ?? false

        if useServeURL, isPublicMode {
            // Public mode with Funnel - HTTPS works everywhere
            return URL(string: "https://\(hostname)")
        } else if useServeURL, !isPublicMode {
            // Private mode - HTTPS doesn't work on mobile, use HTTP with IP
            // Try to get Tailscale IP, fallback to hostname if not available
            if let tailscaleIP = getTailscaleIP() {
                let urlString = "http://\(tailscaleIP):\(port)"
                if let url = URL(string: urlString) {
                    return url
                } else {
                    logger.error("Failed to create URL from IP string: \(urlString, privacy: .public)")
                    // Should never happen with a valid IP
                    return nil
                }
            } else {
                // Fallback to hostname if we can't get the IP
                // Note: This won't work well on mobile due to self-signed certs, but it's better than nothing
                let urlString = "http://\(hostname):\(port)"
                if let url = URL(string: urlString) {
                    return url
                } else {
                    logger.error("Failed to create URL from hostname string: \(urlString, privacy: .public)")
                    return nil
                }
            }
        } else {
            // Tailscale not enabled or not running - use HTTP with port
            return URL(string: "http://\(hostname):\(port)")
        }
    }

    /// Gets the display address for Tailscale based on configuration
    /// - Parameters:
    ///   - hostname: The Tailscale hostname
    ///   - port: The server port
    ///   - isTailscaleServeEnabled: Whether Tailscale Serve integration is enabled
    ///   - isTailscaleServeRunning: Whether Tailscale Serve is actually running (optional)
    ///   - isFunnelEnabled: Whether Funnel (Public mode) is enabled (optional)
    /// - Returns: The display string for the Tailscale address
    static func displayAddress(
        hostname: String,
        port: String,
        isTailscaleServeEnabled: Bool,
        isTailscaleServeRunning: Bool? = nil,
        isFunnelEnabled: Bool? = nil)
        -> String
    {
        // Check if we should use Serve URL
        let useServeURL = isTailscaleServeEnabled && (isTailscaleServeRunning ?? true)

        // Check if Funnel (Public mode) is enabled
        let isPublicMode = isFunnelEnabled ?? false

        if useServeURL, isPublicMode {
            // Public mode - show HTTPS URL without port (port 443 is implicit)
            return "\(hostname)"
        } else if useServeURL, !isPublicMode {
            // Private mode - show hostname:port for HTTP
            // Don't use IP address here as it's less user-friendly
            return "\(hostname):\(port)"
        } else {
            // Tailscale not enabled - show hostname:port
            return "\(hostname):\(port)"
        }
    }
}
