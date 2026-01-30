import Foundation
import Observation
import UIKit

/// Manages Tailscale integration and API access for iOS.
///
/// `TailscaleService` provides functionality to access the Tailscale API
/// using an OAuth token to discover devices on the tailnet.
@Observable
@MainActor
final class TailscaleService {
    static let shared = TailscaleService()

    // MARK: - Constants

    /// Tailscale API endpoint
    private static let tailscaleAPIEndpoint = "https://api.tailscale.com/api/v2"

    /// API request timeout in seconds
    private static let apiTimeoutInterval: TimeInterval = 10.0

    /// Storage keys for credentials in Keychain
    private static let clientIdKey = UUID(uuidString: "00000000-0000-0000-0000-000000000001") ?? UUID()
    private static let clientSecretKey = UUID(uuidString: "00000000-0000-0000-0000-000000000002") ?? UUID()
    private static let accessTokenKey = UUID(uuidString: "00000000-0000-0000-0000-000000000003") ?? UUID()
    private static let tokenExpiryKey = "TailscaleTokenExpiry"

    /// OAuth token endpoint
    private static let oauthTokenEndpoint = "https://api.tailscale.com/api/v2/oauth/token"

    // MARK: - Properties

    /// Logger instance for debugging
    private let logger = Logger(category: "TailscaleService")

    /// Keychain service for secure storage
    private let keychainService = KeychainService()

    /// OAuth Client ID (stored securely in Keychain)
    var clientId: String? {
        get {
            do {
                return try keychainService.loadPassword(for: Self.clientIdKey.uuidString)
            } catch {
                logger.debug("No client ID found in Keychain")
                return nil
            }
        }
        set {
            do {
                if let id = newValue {
                    try keychainService.savePassword(id, for: Self.clientIdKey.uuidString)
                } else {
                    try keychainService.deletePassword(for: Self.clientIdKey.uuidString)
                }
                // Clear cached token when credentials change
                clearCachedToken()
                Task {
                    await refreshStatus()
                }
            } catch {
                logger.error("Failed to save client ID to Keychain: \(error)")
            }
        }
    }

    /// OAuth Client Secret (stored securely in Keychain)
    var clientSecret: String? {
        get {
            do {
                return try keychainService.loadPassword(for: Self.clientSecretKey.uuidString)
            } catch {
                logger.debug("No client secret found in Keychain")
                return nil
            }
        }
        set {
            do {
                if let secret = newValue {
                    try keychainService.savePassword(secret, for: Self.clientSecretKey.uuidString)
                } else {
                    try keychainService.deletePassword(for: Self.clientSecretKey.uuidString)
                }
                // Clear cached token when credentials change
                clearCachedToken()
                Task {
                    await refreshStatus()
                }
            } catch {
                logger.error("Failed to save client secret to Keychain: \(error)")
            }
        }
    }

    /// Cached OAuth access token (stored in Keychain)
    private var accessToken: String? {
        get {
            do {
                return try keychainService.loadPassword(for: Self.accessTokenKey.uuidString)
            } catch {
                return nil
            }
        }
        set {
            do {
                if let token = newValue {
                    try keychainService.savePassword(token, for: Self.accessTokenKey.uuidString)
                } else {
                    try keychainService.deletePassword(for: Self.accessTokenKey.uuidString)
                }
            } catch {
                logger.error("Failed to save access token to Keychain: \(error)")
            }
        }
    }

    /// Token expiry time (stored in UserDefaults)
    private var tokenExpiry: Date? {
        get {
            UserDefaults.standard.object(forKey: Self.tokenExpiryKey) as? Date
        }
        set {
            UserDefaults.standard.set(newValue, forKey: Self.tokenExpiryKey)
        }
    }

    /// Indicates if we have valid credentials
    var isConfigured: Bool {
        guard let id = clientId, !id.isEmpty,
              let secret = clientSecret, !secret.isEmpty
        else {
            return false
        }
        return true
    }

    /// Indicates if we have a valid OAuth token (for backward compatibility)
    var isInstalled: Bool {
        isConfigured
    }

    /// Indicates if Tailscale API is accessible
    private(set) var isRunning = false

    /// The name of the Tailnet this token is connected to
    private(set) var tailnetName: String?

    /// List of devices on the tailnet
    private(set) var devices: [TailscaleDevice] = []

    /// Error message if status check fails
    private(set) var statusError: String?

    /// Last time the status was checked
    private(set) var lastStatusCheck: Date?

    // MARK: - Types

    /// Represents a device on the Tailscale network
    struct TailscaleDevice: Identifiable, Codable {
        let id: String
        let nodeId: String?
        let name: String
        let hostname: String
        let addresses: [String]
        let lastSeen: String?
        let os: String?
        let tags: [String]?
        let authorized: Bool?
        let isExternal: Bool?
        let user: String?
        let created: String?
        let expires: String?
        let keyExpiryDisabled: Bool?
        let updateAvailable: Bool?
        let clientVersion: String?

        var ipv4Address: String? {
            addresses.first { $0.contains(".") && !$0.contains(":") }
        }

        var isOnline: Bool {
            // Consider a device online if it was seen in the last 5 minutes
            if let lastSeenStr = lastSeen,
               let lastSeenDate = ISO8601DateFormatter().date(from: lastSeenStr)
            {
                return Date().timeIntervalSince(lastSeenDate) < 300 // 5 minutes
            }
            return false
        }

        var isVibeTunnelServer: Bool {
            // Check if device has VibeTunnel tag or is a macOS/Darwin device
            // The API might return "darwin", "macOS", "Darwin", etc.
            if tags?.contains("vibetunnel") ?? false {
                return true
            }
            if let deviceOS = os?.lowercased() {
                return deviceOS.contains("mac") || deviceOS.contains("darwin")
            }
            return false
        }
    }

    // MARK: - Initialization

    private init() {
        setupNotifications()
        Task {
            await refreshStatus()
        }
    }

    /// Sets up notification observers for app lifecycle
    private func setupNotifications() {
        #if os(iOS)
            NotificationCenter.default.addObserver(
                forName: UIApplication.willEnterForegroundNotification,
                object: nil,
                queue: .main
            ) { _ in
                Task { @MainActor in
                    // Refresh token when app comes to foreground
                    await self.refreshStatus()
                }
            }

            NotificationCenter.default.addObserver(
                forName: UIApplication.didBecomeActiveNotification,
                object: nil,
                queue: .main
            ) { _ in
                Task { @MainActor in
                    // Check token validity when app becomes active
                    if self.isConfigured {
                        _ = await self.ensureValidAccessToken()
                    }
                }
            }
        #endif
    }

    // MARK: - API Methods

    /// Clears all Tailscale credentials and resets the service state
    func clearCredentials() {
        // Clear from Keychain
        do {
            try keychainService.deletePassword(for: Self.clientIdKey.uuidString)
            try keychainService.deletePassword(for: Self.clientSecretKey.uuidString)
            try keychainService.deletePassword(for: Self.accessTokenKey.uuidString)
        } catch {
            logger.error("Failed to delete credentials from Keychain: \(error)")
        }

        // Clear token expiry from UserDefaults
        UserDefaults.standard.removeObject(forKey: Self.tokenExpiryKey)

        // Clear in-memory values (will be cleared via property setters)
        clientId = nil
        clientSecret = nil
        clearCachedToken()

        // Clear discovered state
        devices = []
        tailnetName = nil
        isRunning = false
        statusError = nil
        lastStatusCheck = nil

        // Post notification to update all views
        NotificationCenter.default.post(name: Notification.Name("TailscaleCredentialsCleared"), object: nil)

        logger.info("Tailscale credentials and state cleared")
    }

    /// Clears the cached OAuth token
    private func clearCachedToken() {
        accessToken = nil
        tokenExpiry = nil
    }

    /// Refreshes the Tailscale status by querying the API
    func refreshStatus() async {
        guard isConfigured else {
            isRunning = false
            devices = []
            tailnetName = nil
            statusError = "No credentials configured"
            logger.info("Tailscale credentials not configured")
            return
        }

        // Ensure we have a valid access token
        if await ensureValidAccessToken() {
            await fetchDevices()
        } else {
            isRunning = false
            devices = []
            tailnetName = nil
            // statusError is set by ensureValidAccessToken
        }
    }

    /// Ensures we have a valid access token, fetching a new one if needed
    private func ensureValidAccessToken() async -> Bool {
        // Check if we have a valid cached token
        if accessToken != nil,
           let expiry = tokenExpiry,
           expiry > Date().addingTimeInterval(60)
        { // Still valid for at least 1 minute
            logger.debug("Using cached token, expires at \(expiry)")
            return true
        }

        logger.info("Token expired or missing, fetching new token")
        // Fetch new token
        return await fetchAccessToken()
    }

    /// Fetches a new OAuth access token using client credentials
    private func fetchAccessToken() async -> Bool {
        guard let clientId,
              let clientSecret
        else {
            statusError = "Missing credentials"
            return false
        }

        // Validate client ID and secret format
        if !clientId.hasPrefix("k") {
            statusError = "Invalid Client ID format - should start with 'k'"
            return false
        }

        if !clientSecret.hasPrefix("tskey-client-") {
            statusError = "Invalid Client Secret format - must start with 'tskey-client-'"
            return false
        }

        guard let url = URL(string: Self.oauthTokenEndpoint) else {
            statusError = "Invalid OAuth endpoint"
            return false
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"

        // Set form data with client credentials in the body (percent-encoded)
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var components = URLComponents()
        components.queryItems = [
            URLQueryItem(name: "client_id", value: clientId),
            URLQueryItem(name: "client_secret", value: clientSecret),
            URLQueryItem(name: "grant_type", value: "client_credentials"),
            URLQueryItem(name: "scope", value: "devices:core:read")
        ]
        request.httpBody = components.percentEncodedQuery?.data(using: .utf8)
        request.timeoutInterval = Self.apiTimeoutInterval

        do {
            let (data, response) = try await URLSession.shared.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse else {
                statusError = "Invalid response from OAuth endpoint"
                return false
            }

            if httpResponse.statusCode == 401 {
                statusError = "Invalid client credentials"
                logger.error("OAuth client credentials rejected with 401")
                return false
            }

            guard httpResponse.statusCode == 200 else {
                statusError = "OAuth error: HTTP \(httpResponse.statusCode)"
                logger.error("OAuth endpoint returned status code: \(httpResponse.statusCode)")
                return false
            }

            struct TokenResponse: Codable {
                let accessToken: String
                let tokenType: String
                let expiresIn: Int
                let scope: String?

                enum CodingKeys: String, CodingKey {
                    case accessToken = "access_token"
                    case tokenType = "token_type"
                    case expiresIn = "expires_in"
                    case scope
                }
            }

            let decoder = JSONDecoder()
            let tokenResponse = try decoder.decode(TokenResponse.self, from: data)

            // Validate the returned token
            if !tokenResponse.accessToken.hasPrefix("tskey-api-") {
                logger.error("Invalid access token format returned: \(tokenResponse.accessToken.prefix(10))")
                statusError = "Invalid access token format"
                return false
            }

            // Store the token in keychain and set expiry
            self.accessToken = tokenResponse.accessToken
            self.tokenExpiry = Date().addingTimeInterval(TimeInterval(tokenResponse.expiresIn))

            logger.info("Successfully obtained OAuth access token, expires in \(tokenResponse.expiresIn) seconds")
            return true
        } catch {
            logger.error("Failed to fetch OAuth access token: \(error)")
            statusError = "Failed to get access token: \(error.localizedDescription)"
            return false
        }
    }

    /// Fetches the list of devices from Tailscale API
    private func fetchDevices() async {
        guard let token = accessToken else {
            statusError = "No access token available"
            return
        }

        // Use "-" as the tailnet identifier for OAuth tokens
        let tailnetIdentifier = "-"

        // Construct URL with - in the path (OAuth uses - instead of explicit tailnet)
        let urlString = "\(Self.tailscaleAPIEndpoint)/tailnet/\(tailnetIdentifier)/devices"
        guard let url = URL(string: urlString) else {
            logger.error("Invalid Tailscale API URL: \(urlString)")
            statusError = "Invalid API URL"
            isRunning = false
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("*/*", forHTTPHeaderField: "Accept")
        request.timeoutInterval = Self.apiTimeoutInterval

        // Log complete request details
        logger.debug("Tailscale API Request to: \(url.absoluteString)")
        logger.debug("Using OAuth token: \(String(token.prefix(15)))...\(String(token.suffix(10)))")

        do {
            let (data, response) = try await URLSession.shared.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse else {
                throw URLError(.badServerResponse)
            }

            if httpResponse.statusCode == 401 {
                statusError = "Invalid token - refreshing credentials"
                isRunning = false
                logger.error("OAuth token rejected with 401, clearing token")
                clearCachedToken()
                // Try to refresh token once
                if await fetchAccessToken() {
                    // Retry with new token
                    await fetchDevices()
                }
                return
            }

            if httpResponse.statusCode == 403 {
                statusError = "Access denied - refreshing token"
                isRunning = false
                logger.error("403 Forbidden - attempting token refresh")
                clearCachedToken()
                // Try to refresh token once
                if await fetchAccessToken() {
                    // Retry with new token
                    await fetchDevices()
                } else {
                    statusError = "Access denied - check client credentials"
                    logger.error("Failed to refresh token after 403")
                }
                return
            }

            if httpResponse.statusCode == 500 {
                statusError = "Tailscale API server error"
                isRunning = false
                logger.error("Tailscale API returned 500 error")
                return
            }

            guard httpResponse.statusCode == 200 else {
                statusError = "API error: HTTP \(httpResponse.statusCode)"
                isRunning = false
                logger.error("Tailscale API returned status code: \(httpResponse.statusCode)")
                if let errorString = String(data: data, encoding: .utf8) {
                    logger.error("Error response: \(errorString)")
                }
                return
            }

            struct DevicesResponse: Codable {
                let devices: [TailscaleDevice]
            }

            // First log the raw response to debug JSON issues
            if let jsonString = String(data: data, encoding: .utf8) {
                logger.info("Raw API response: \(jsonString)")
            }

            let decoder = JSONDecoder()
            do {
                let devicesResponse = try decoder.decode(DevicesResponse.self, from: data)

                self.devices = devicesResponse.devices
                self.isRunning = true
                self.statusError = nil
                self.lastStatusCheck = Date()

                // Extract tailnet name from device hostnames or use "Tailscale"
                if let firstDevice = devicesResponse.devices.first,
                   let tailnet = extractTailnetName(from: firstDevice.hostname)
                {
                    self.tailnetName = tailnet
                } else {
                    self.tailnetName = "Tailscale"
                }

                logger.info("Successfully fetched \(devices.count) devices from Tailscale")
            } catch {
                logger.error("Failed to decode devices response: \(error)")
                if let decodingError = error as? DecodingError {
                    switch decodingError {
                    case .keyNotFound(let key, let context):
                        logger.error("Missing key: \(key.stringValue) - \(context.debugDescription)")
                    case .typeMismatch(let type, let context):
                        logger.error("Type mismatch for type \(type) - \(context.debugDescription)")
                    case .valueNotFound(let type, let context):
                        logger.error("Value not found for type \(type) - \(context.debugDescription)")
                    case .dataCorrupted(let context):
                        logger.error("Data corrupted - \(context.debugDescription)")
                    @unknown default:
                        logger.error("Unknown decoding error")
                    }
                }
                statusError = "The data couldn't be read because it is missing."
                isRunning = false
            }
        } catch {
            logger.error("Failed to fetch Tailscale devices: \(error)")

            // Provide more specific error messages
            if let urlError = error as? URLError {
                switch urlError.code {
                case .timedOut:
                    statusError = "Request timed out"
                case .notConnectedToInternet:
                    statusError = "No internet connection"
                case .cannotFindHost:
                    statusError = "Cannot reach Tailscale API"
                case .badServerResponse:
                    statusError = "Invalid response from server"
                default:
                    statusError = "Network error: \(urlError.code.rawValue)"
                }
            } else {
                statusError = error.localizedDescription
            }

            isRunning = false
            lastStatusCheck = Date()
        }
    }

    /// Extracts the tailnet name from a hostname
    private func extractTailnetName(from hostname: String) -> String? {
        // Hostname format: device-name.tailnet-name.ts.net
        let components = hostname.split(separator: ".")
        if components.count >= 3 && components.suffix(2).joined(separator: ".") == "ts.net" {
            return String(components[components.count - 3])
        }
        return nil
    }

    // MARK: - Compatibility Properties (for migration)

    /// Legacy property for organization - maps to clientId
    var organization: String? {
        get { clientId }
        set { clientId = newValue }
    }

    /// Legacy property for API key - maps to clientSecret
    var apiKey: String? {
        get { clientSecret }
        set { clientSecret = newValue }
    }

    // MARK: - Compatibility Methods (for UI that expects these)

    /// Opens Tailscale configuration in settings
    func openTailscaleApp() {
        // This now opens our settings view instead
        logger.info("Opening Tailscale configuration")
    }

    /// Opens App Store (no longer needed, but kept for compatibility)
    func openAppStore() {
        logger.info("OAuth token configuration needed - no app required")
    }
}
