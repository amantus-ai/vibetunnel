import Foundation
import os.log
import SwiftUI

/// Service to fetch Tailscale Serve status from the server
@MainActor
@Observable
final class TailscaleServeStatusService {
    static let shared = TailscaleServeStatusService()

    var isRunning = false
    var lastError: String?
    var startTime: Date?
    var isLoading = false

    private let logger = Logger(subsystem: BundleIdentifiers.loggerSubsystem, category: "TailscaleServeStatus")
    private var updateTimer: Timer?

    private init() {}

    /// Start polling for status updates
    func startMonitoring() {
        // Initial fetch
        Task {
            await fetchStatus()
        }

        // Set up periodic updates
        updateTimer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { _ in
            Task { @MainActor in
                await self.fetchStatus()
            }
        }
    }

    /// Stop polling for status updates
    func stopMonitoring() {
        updateTimer?.invalidate()
        updateTimer = nil
    }

    /// Fetch the current Tailscale Serve status
    @MainActor
    func fetchStatus() async {
        isLoading = true
        defer { isLoading = false }

        // Get server port
        let port = UserDefaults.standard.string(forKey: AppConstants.UserDefaultsKeys.serverPort) ?? "4020"
        let urlString = "http://localhost:\(port)/api/sessions/tailscale/status"

        guard let url = URL(string: urlString) else {
            logger.error("Invalid URL for Tailscale status endpoint")
            return
        }

        do {
            let (data, response) = try await URLSession.shared.data(from: url)

            guard let httpResponse = response as? HTTPURLResponse else {
                logger.error("Invalid response type")
                isRunning = false
                lastError = "Invalid server response"
                return
            }

            guard httpResponse.statusCode == 200 else {
                logger.error("HTTP error: \(httpResponse.statusCode)")
                // If we get a non-200 response, there's an issue with the endpoint
                isRunning = false
                lastError = "Unable to check status (HTTP \(httpResponse.statusCode))"
                return
            }

            let decoder = JSONDecoder()
            // Use custom date decoder to handle ISO8601 with fractional seconds
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            decoder.dateDecodingStrategy = .custom { decoder in
                let container = try decoder.singleValueContainer()
                let dateString = try container.decode(String.self)
                if let date = formatter.date(from: dateString) {
                    return date
                }
                // Fallback to standard ISO8601 without fractional seconds
                formatter.formatOptions = [.withInternetDateTime]
                if let date = formatter.date(from: dateString) {
                    return date
                }
                throw DecodingError.dataCorruptedError(in: container, debugDescription: "Cannot decode date string \(dateString)")
            }

            let status = try decoder.decode(TailscaleServeStatus.self, from: data)

            // Update published properties
            isRunning = status.isRunning
            lastError = status.lastError
            startTime = status.startTime

            logger.debug("Tailscale Serve status - Running: \(status.isRunning), Error: \(status.lastError ?? "none")")

        } catch {
            logger.error("Failed to fetch Tailscale Serve status: \(error.localizedDescription)")
            // On error, assume not running
            isRunning = false
            // Keep error messages concise to prevent UI jumping
            if error.localizedDescription.contains("couldn't be read") {
                lastError = "Status check failed"
            } else {
                lastError = error.localizedDescription
            }
        }
    }
}

/// Response model for Tailscale Serve status
struct TailscaleServeStatus: Codable {
    let isRunning: Bool
    let port: Int?
    let error: String?
    let lastError: String?
    let startTime: Date?
}
