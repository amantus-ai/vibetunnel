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
            // Create request with timeout to prevent hanging
            var request = URLRequest(url: url)
            request.timeoutInterval = 5.0 // 5 second timeout
            request.cachePolicy = .reloadIgnoringLocalCacheData
            
            let (data, response) = try await URLSession.shared.dataWithErrorBoundary(for: request)

            guard let httpResponse = response as? HTTPURLResponse else {
                logger.error("Invalid response type")
                handleServerUnavailable("Invalid server response")
                return
            }

            // Server is responding, mark as available
            isServerAvailable = true

            guard httpResponse.statusCode == 200 else {
                logger.error("HTTP error: \(httpResponse.statusCode)")
                // If we get a non-200 response, server is available but endpoint has issues
                isRunning = false
                lastError = handleHTTPError(httpResponse.statusCode)
                return
            }

            let decoder = JSONDecoder()
            // Use custom date decoder to handle ISO8601 with fractional seconds
            decoder.dateDecodingStrategy = .custom { decoder in
                let container = try decoder.singleValueContainer()
                let dateString = try container.decode(String.self)

                // Create formatter inside the closure to avoid Sendable warning
                let formatter = ISO8601DateFormatter()
                formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                if let date = formatter.date(from: dateString) {
                    return date
                }
                // Fallback to standard ISO8601 without fractional seconds
                formatter.formatOptions = [.withInternetDateTime]
                if let date = formatter.date(from: dateString) {
                    return date
                }
                throw DecodingError.dataCorruptedError(
                    in: container,
                    debugDescription: "Cannot decode date string \(dateString)"
                )
            }

            let status = try decoder.decode(TailscaleServeStatus.self, from: data)

            // Update published properties
            isRunning = status.isRunning
            lastError = status.lastError
            startTime = status.startTime

            logger.debug("Tailscale Serve status - Running: \(status.isRunning), Error: \(status.lastError ?? "none")")
        } catch {
            logger.error("Failed to fetch Tailscale Serve status: \(error.localizedDescription)")
            
            // Handle different types of errors gracefully using enhanced NetworkError
            if let networkError = error as? NetworkError {
                switch networkError {
                case .connectionFailed, .serverUnavailable, .timeout, .networkConnectionLost:
                    handleServerUnavailable(networkError.errorDescription ?? "Server unavailable")
                case .authenticationRequired, .forbidden:
                    isRunning = false
                    isServerAvailable = true
                    lastError = networkError.errorDescription
                default:
                    isRunning = false
                    isServerAvailable = true
                    lastError = networkError.errorDescription ?? "Status check failed"
                }
            } else if let urlError = error as? URLError {
                let networkError = NetworkError.from(urlError)
                switch networkError {
                case .connectionFailed, .serverUnavailable, .timeout, .networkConnectionLost:
                    handleServerUnavailable(networkError.errorDescription ?? "Server unavailable")
                default:
                    isRunning = false
                    isServerAvailable = true
                    lastError = networkError.errorDescription ?? "Status check failed"
                }
            } else if error.localizedDescription.contains("couldn't be read") {
                handleServerUnavailable("Status check failed")
            } else {
                // Generic error handling
                isRunning = false
                isServerAvailable = true // Assume server is available but has other issues
                lastError = "Status check failed"
            }
        }
    }
    
    /// Handle server unavailable scenarios
    private func handleServerUnavailable(_ message: String) {
        isServerAvailable = false
        isRunning = false
        lastError = message
        logger.info("Server unavailable: \(message)")
    }
    
    /// Handle HTTP error responses with user-friendly messages
    private func handleHTTPError(_ statusCode: Int) -> String {
        switch statusCode {
        case 404:
            return "Tailscale endpoint not found"
        case 500...599:
            return "Server error (\(statusCode))"
        case 401, 403:
            return "Authentication required"
        default:
            return "Unable to check status (HTTP \(statusCode))"
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
