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

    /// Tailscale local API endpoint
    private static let tailscaleAPIEndpoint = "http://100.100.100.100/api/data"

    /// API request timeout in seconds
    private static let apiTimeoutInterval: TimeInterval = 5.0

    /// Logger instance for debugging
    private let logger = Logger(subsystem: BundleIdentifiers.loggerSubsystem, category: "TailscaleService")

    /// Indicates if Tailscale app is installed on the system
    private(set) var isInstalled = false

    /// Indicates if Tailscale is currently running
    private(set) var isRunning = false

    /// The Tailscale hostname for this device (e.g., "my-mac.tailnet-name.ts.net")
    private(set) var tailscaleHostname: String?

    /// The Tailscale IP address for this device
    private(set) var tailscaleIP: String?

    /// Error message if status check fails
    private(set) var statusError: String?

    private init() {
        Task {
            await self.checkTailscaleStatus()
        }
    }

    /// Checks if Tailscale app is installed
    func checkAppInstallation() -> Bool {
        let isAppInstalled = FileManager.default.fileExists(atPath: "/Applications/Tailscale.app")
        self.logger.info("Tailscale app installed: \(isAppInstalled)")
        return isAppInstalled
    }

    /// Struct to decode Tailscale API response
    private struct TailscaleAPIResponse: Codable {
        let status: String
        let deviceName: String
        let tailnetName: String
        let iPv4: String?

        private enum CodingKeys: String, CodingKey {
            case status = "Status"
            case deviceName = "DeviceName"
            case tailnetName = "TailnetName"
            case iPv4 = "IPv4"
        }
    }

    /// Fetches Tailscale status from the API
    private func fetchTailscaleStatus() async -> TailscaleAPIResponse? {
        guard let url = URL(string: Self.tailscaleAPIEndpoint) else {
            self.logger.error("Invalid Tailscale API URL")
            return nil
        }

        do {
            // Configure URLSession with timeout
            let configuration = URLSessionConfiguration.default
            configuration.timeoutIntervalForRequest = Self.apiTimeoutInterval
            let session = URLSession(configuration: configuration)

            let (data, response) = try await session.data(from: url)

            guard let httpResponse = response as? HTTPURLResponse,
                  httpResponse.statusCode == 200
            else {
                self.logger.warning("Tailscale API returned non-200 status")
                return nil
            }

            let decoder = JSONDecoder()
            return try decoder.decode(TailscaleAPIResponse.self, from: data)
        } catch {
            self.logger.debug("Failed to fetch Tailscale status: \(error)")
            return nil
        }
    }

    /// Checks the current Tailscale status and updates properties
    func checkTailscaleStatus() async {
        // First check if app is installed
        self.isInstalled = self.checkAppInstallation()

        guard self.isInstalled else {
            self.isRunning = false
            self.tailscaleHostname = nil
            self.tailscaleIP = nil
            self.statusError = "Tailscale is not installed"
            return
        }

        // Try to fetch status from API
        if let apiResponse = await fetchTailscaleStatus() {
            // Tailscale is running if API responds
            self.isRunning = apiResponse.status.lowercased() == "running"

            if self.isRunning {
                // Extract hostname from device name and tailnet name
                // Format: devicename.tailnetname (without .ts.net suffix)
                let deviceName = apiResponse.deviceName.lowercased().replacingOccurrences(of: " ", with: "-")
                let tailnetName = apiResponse.tailnetName
                    .replacingOccurrences(of: ".ts.net", with: "")
                    .replacingOccurrences(of: ".tailscale.net", with: "")

                self.tailscaleHostname = "\(deviceName).\(tailnetName).ts.net"
                self.tailscaleIP = apiResponse.iPv4
                self.statusError = nil

                self.logger
                    .info(
                        "Tailscale status: running=true, hostname=\(self.tailscaleHostname ?? "nil"), IP=\(self.tailscaleIP ?? "nil")")
            } else {
                // Tailscale installed but not running properly
                self.tailscaleHostname = nil
                self.tailscaleIP = nil
                self.statusError = "Tailscale is not running"
            }
        } else {
            // API not responding - Tailscale not running
            self.isRunning = false
            self.tailscaleHostname = nil
            self.tailscaleIP = nil
            self.statusError = "Please start the Tailscale app"
            self.logger.info("Tailscale API not responding - app likely not running")
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
