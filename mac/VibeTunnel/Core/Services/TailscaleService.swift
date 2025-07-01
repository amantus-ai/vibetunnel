import AppKit
import Foundation
import Observation
import os

/// Manages Tailscale integration and status checking.
///
/// `TailscaleService` provides functionality to check if Tailscale is installed
/// and running on the system, and retrieves the device's Tailscale hostname
/// for network access. Unlike ngrok, Tailscale doesn't require auth tokens
/// as it uses system-level authentication.
@Observable
@MainActor
final class TailscaleService {
    static let shared = TailscaleService()

    /// Logger instance for debugging
    private let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "TailscaleService")

    /// Indicates if Tailscale app is installed on the system
    private(set) var isInstalled = false

    /// Indicates if Tailscale CLI is available
    private(set) var isCLIAvailable = false

    /// Indicates if Tailscale is currently running
    private(set) var isRunning = false

    /// The Tailscale hostname for this device (e.g., "my-mac.tailnet-name.ts.net")
    private(set) var tailscaleHostname: String?

    /// The Tailscale IP address for this device
    private(set) var tailscaleIP: String?

    /// Error message if status check fails
    private(set) var statusError: String?

    /// Path to the tailscale executable
    private var tailscalePath: String?

    private init() {
        Task {
            await checkTailscaleStatus()
        }
    }

    /// Checks if Tailscale app is installed
    func checkAppInstallation() -> Bool {
        let isAppInstalled = FileManager.default.fileExists(atPath: "/Applications/Tailscale.app")
        logger.info("Tailscale app installed: \(isAppInstalled)")
        return isAppInstalled
    }

    /// Checks if Tailscale CLI is available
    func checkCLIAvailability() async -> Bool {
        let checkPaths = [
            "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
            "/usr/local/bin/tailscale",
            "/opt/homebrew/bin/tailscale"
        ]

        for path in checkPaths {
            if FileManager.default.fileExists(atPath: path) {
                logger.info("Tailscale CLI found at: \(path)")
                tailscalePath = path
                return true
            }
        }

        // Also check if we can run the tailscale command using which
        do {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/which")
            process.arguments = ["tailscale"]

            // Set up PATH to include common installation directories
            var environment = ProcessInfo.processInfo.environment
            let additionalPaths = [
                "/usr/local/bin",
                "/opt/homebrew/bin",
                "/Applications/Tailscale.app/Contents/MacOS"
            ]
            if let currentPath = environment["PATH"] {
                environment["PATH"] = "\(currentPath):\(additionalPaths.joined(separator: ":"))"
            } else {
                environment["PATH"] = additionalPaths.joined(separator: ":")
            }
            process.environment = environment

            let pipe = Pipe()
            process.standardOutput = pipe
            process.standardError = pipe

            try process.run()
            process.waitUntilExit()

            if process.terminationStatus == 0 {
                let data = pipe.fileHandleForReading.readDataToEndOfFile()
                if let output = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
                   !output.isEmpty
                {
                    logger.info("Tailscale CLI found at: \(output)")
                    tailscalePath = output
                    return true
                }
            }
        } catch {
            logger.debug("Failed to check for tailscale command: \(error)")
        }

        logger.info("Tailscale CLI not found")
        tailscalePath = nil
        return false
    }

    /// Checks the current Tailscale status and updates properties
    func checkTailscaleStatus() async {
        // First check if app is installed
        isInstalled = checkAppInstallation()

        guard isInstalled else {
            isCLIAvailable = false
            isRunning = false
            tailscaleHostname = nil
            tailscaleIP = nil
            statusError = "Tailscale is not installed"
            return
        }

        // Then check if CLI is available
        isCLIAvailable = await checkCLIAvailability()

        guard isCLIAvailable else {
            isRunning = false
            tailscaleHostname = nil
            tailscaleIP = nil
            statusError = nil // No error, just CLI not available
            return
        }

        // If CLI is available, check status
        do {
            let process = Process()

            // Use the discovered tailscale path
            if let tailscalePath {
                process.executableURL = URL(fileURLWithPath: tailscalePath)
                process.arguments = ["status", "--json"]
            } else {
                // Fallback to env if path not found (shouldn't happen if isCLIAvailable is true)
                process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
                process.arguments = ["tailscale", "status", "--json"]

                // Set up PATH environment variable
                var environment = ProcessInfo.processInfo.environment
                let additionalPaths = [
                    "/usr/local/bin",
                    "/opt/homebrew/bin",
                    "/Applications/Tailscale.app/Contents/MacOS"
                ]
                if let currentPath = environment["PATH"] {
                    environment["PATH"] = "\(currentPath):\(additionalPaths.joined(separator: ":"))"
                } else {
                    environment["PATH"] = additionalPaths.joined(separator: ":")
                }
                process.environment = environment
            }

            let pipe = Pipe()
            process.standardOutput = pipe
            process.standardError = pipe

            try process.run()
            process.waitUntilExit()

            let data = pipe.fileHandleForReading.readDataToEndOfFile()

            if process.terminationStatus == 0 {
                // Check if we have data
                guard !data.isEmpty else {
                    isRunning = false
                    tailscaleHostname = nil
                    tailscaleIP = nil
                    statusError = "Tailscale returned empty response"
                    logger.warning("Tailscale status command returned empty data")
                    return
                }
                
                // Log raw output for debugging
                let rawOutput = String(data: data, encoding: .utf8) ?? "<non-UTF8 data>"
                logger.debug("Tailscale raw output: \(rawOutput)")
                
                // Parse JSON output
                do {
                    let jsonObject = try JSONSerialization.jsonObject(with: data)
                    
                    // Ensure it's a dictionary
                    guard let json = jsonObject as? [String: Any] else {
                        isRunning = false
                        tailscaleHostname = nil
                        tailscaleIP = nil
                        statusError = "Tailscale returned invalid JSON format (not a dictionary)"
                        logger.warning("Tailscale status returned non-dictionary JSON: \(type(of: jsonObject))")
                        return
                    }
                    
                    // Check if we're logged in and connected
                    if let self_ = json["Self"] as? [String: Any],
                       let dnsName = self_["DNSName"] as? String
                    {
                        // Check online status - it might be missing or false
                        let online = self_["Online"] as? Bool ?? false
                        isRunning = online

                        // Use the DNSName which is already properly formatted for DNS
                        // Remove trailing dot if present
                        tailscaleHostname = dnsName.hasSuffix(".") ? String(dnsName.dropLast()) : dnsName

                        // Get Tailscale IP
                        if let tailscaleIPs = self_["TailscaleIPs"] as? [String],
                           let firstIP = tailscaleIPs.first
                        {
                            tailscaleIP = firstIP
                        }

                        statusError = nil
                        logger
                            .info(
                                "Tailscale status: running=\(online), hostname=\(self.tailscaleHostname ?? "nil"), IP=\(self.tailscaleIP ?? "nil")"
                            )
                    } else {
                        isRunning = false
                        tailscaleHostname = nil
                        tailscaleIP = nil
                        statusError = "Tailscale is not logged in"
                        logger.warning("Tailscale status check failed - missing required fields in JSON")
                        logger.debug("JSON keys: \(json.keys.sorted())")
                    }
                } catch let parseError {
                    isRunning = false
                    tailscaleHostname = nil
                    tailscaleIP = nil
                    statusError = "Failed to parse Tailscale status: \(parseError.localizedDescription)"
                    logger.error("JSON parsing error: \(parseError)")
                    logger.debug("Failed to parse data: \(rawOutput.prefix(200))...")
                }
            } else {
                // Tailscale CLI returned error
                let errorOutput = String(data: data, encoding: .utf8) ?? "Unknown error"
                isRunning = false
                tailscaleHostname = nil
                tailscaleIP = nil

                if errorOutput.contains("not logged in") {
                    statusError = "Tailscale is not logged in"
                } else if errorOutput.contains("stopped") {
                    statusError = "Tailscale is stopped"
                } else {
                    statusError = "Tailscale error: \(errorOutput.trimmingCharacters(in: .whitespacesAndNewlines))"
                }
            }
        } catch {
            logger.error("Failed to check Tailscale status: \(error)")
            isRunning = false
            tailscaleHostname = nil
            tailscaleIP = nil
            statusError = "Failed to check status: \(error.localizedDescription)"
        }
    }

    /// Opens the Tailscale app
    func openTailscaleApp() {
        if let url = URL(string: "file:///Applications/Tailscale.app") {
            NSWorkspace.shared.open(url)
        }
    }

    /// Opens the Mac App Store page for Tailscale
    func openAppStore() {
        if let url = URL(string: "https://apps.apple.com/us/app/tailscale/id1475387142") {
            NSWorkspace.shared.open(url)
        }
    }

    /// Opens the Tailscale download page
    func openDownloadPage() {
        if let url = URL(string: "https://tailscale.com/download/macos") {
            NSWorkspace.shared.open(url)
        }
    }

    /// Opens the Tailscale setup guide
    func openSetupGuide() {
        if let url = URL(string: "https://tailscale.com/kb/1017/install/") {
            NSWorkspace.shared.open(url)
        }
    }
}
