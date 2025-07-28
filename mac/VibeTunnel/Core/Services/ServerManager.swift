import Foundation
import Observation
import OSLog
@preconcurrency import ScreenCaptureKit
import SwiftUI

/// Errors that can occur during server operations
enum ServerError: LocalizedError {
    case repeatedCrashes(count: Int)
    case portInUse(port: Int)
    case startupFailed(String)

    var errorDescription: String? {
        switch self {
        case .repeatedCrashes:
            "Server keeps crashing"
        case .portInUse(let port):
            "Port \(port) is already in use"
        case .startupFailed(let reason):
            "Server startup failed: \(reason)"
        }
    }

    var failureReason: String? {
        switch self {
        case .repeatedCrashes(let count):
            "The server crashed \(count) times in a row"
        case .portInUse(let port):
            "Another process is using port \(port)"
        case .startupFailed:
            nil
        }
    }

    var recoverySuggestion: String? {
        switch self {
        case .repeatedCrashes:
            "Check the logs for errors or try a different port"
        case .portInUse:
            "Stop the other process or choose a different port"
        case .startupFailed:
            "Check the server configuration and try again"
        }
    }
}

/// Manages the VibeTunnel server lifecycle.
///
/// `ServerManager` is the central coordinator for server lifecycle management in VibeTunnel.
/// It handles starting, stopping, and restarting the Go server, manages server configuration,
/// and provides logging capabilities.
@MainActor
@Observable
class ServerManager {
    static let shared = ServerManager()

    var port: String {
        get { UserDefaults.standard.string(forKey: UserDefaultsKeys.serverPort) ?? String(NetworkConstants.defaultPort)
        }
        set { UserDefaults.standard.set(newValue, forKey: UserDefaultsKeys.serverPort) }
    }

    /// The local authentication token for the current server instance
    var localAuthToken: String? {
        bunServer?.localToken
    }

    var bindAddress: String {
        get {
            // Get the raw value from UserDefaults, defaulting to the app default
            let rawValue = UserDefaults.standard.string(forKey: UserDefaultsKeys.dashboardAccessMode) ?? AppConstants
                .Defaults
                .dashboardAccessMode
            let mode = DashboardAccessMode(rawValue: rawValue) ?? .network

            // Log for debugging
            // logger
            //     .debug(
            //         "bindAddress getter: rawValue='\(rawValue)', mode=\(mode.rawValue),
            //         bindAddress=\(mode.bindAddress)"
            //     )

            return mode.bindAddress
        }
        set {
            // Find the mode that matches this bind address
            if let mode = DashboardAccessMode.allCases.first(where: { $0.bindAddress == newValue }) {
                UserDefaults.standard.set(mode.rawValue, forKey: UserDefaultsKeys.dashboardAccessMode)
                logger.debug("bindAddress setter: set mode=\(mode.rawValue) for bindAddress=\(newValue)")
            }
        }
    }

    private var cleanupOnStartup: Bool {
        get { UserDefaults.standard.bool(forKey: UserDefaultsKeys.cleanupOnStartup) }
        set { UserDefaults.standard.set(newValue, forKey: UserDefaultsKeys.cleanupOnStartup) }
    }

    private(set) var bunServer: BunServer?
    private(set) var isRunning = false
    private(set) var isRestarting = false
    private(set) var lastError: Error?

    /// Track if we're in the middle of handling a crash to prevent multiple restarts
    private var isHandlingCrash = false
    /// Number of consecutive crashes for backoff
    private var consecutiveCrashes = 0
    /// Last crash time for crash rate detection
    private var lastCrashTime: Date?

    private let logger = Logger(subsystem: BundleIdentifiers.main, category: "ServerManager")
    private let powerManager = PowerManagementService.shared

    private init() {
        // Skip observer setup and monitoring during tests
        let isRunningInTests = ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil ||
            ProcessInfo.processInfo.environment["XCTestBundlePath"] != nil ||
            ProcessInfo.processInfo.environment["XCTestSessionIdentifier"] != nil ||
            ProcessInfo.processInfo.arguments.contains("-XCTest") ||
            NSClassFromString("XCTestCase") != nil

        if !isRunningInTests {
            setupObservers()
            // Start health monitoring
            startHealthMonitoring()
        }
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    private func setupObservers() {
        // Watch for UserDefaults changes (e.g., sleep prevention setting)
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(userDefaultsDidChange),
            name: UserDefaults.didChangeNotification,
            object: nil
        )
    }

    @objc
    private nonisolated func userDefaultsDidChange() {
        Task { @MainActor in
            // Only update sleep prevention if server is running
            guard isRunning else { return }

            // Check if preventSleepWhenRunning setting changed
            let preventSleep = AppConstants.boolValue(for: AppConstants.UserDefaultsKeys.preventSleepWhenRunning)
            powerManager.updateSleepPrevention(enabled: preventSleep, serverRunning: true)

            logger.info("Updated sleep prevention setting: \(preventSleep ? "enabled" : "disabled")")
        }
    }

    /// Start the server with current configuration
    func start() async {
        // Check if we already have a running server
        if let existingServer = bunServer {
            let state = existingServer.getState()

            switch state {
            case .running:
                logger.info("Server already running on port \(existingServer.port)")
                // Ensure our state is synced
                isRunning = true
                lastError = nil
                return
            case .starting:
                logger.info("Server is already starting")
                return
            case .stopping:
                logger.warning("Cannot start server while it's stopping")
                lastError = BunServerError.invalidState
                return
            case .crashed, .idle:
                // Clean up and proceed with start
                bunServer = nil
                isRunning = false
            }
        }

        // First check if port is truly available by trying to bind to it
        let portNumber = Int(self.port) ?? NetworkConstants.defaultPort

        let canBind = await PortConflictResolver.shared.canBindToPort(portNumber)
        if !canBind {
            logger.warning("Cannot bind to port \(portNumber), checking for conflicts...")
        }

        // Check for port conflicts before starting
        if let conflict = await PortConflictResolver.shared.detectConflict(on: portNumber) {
            logger.warning("Port \(self.port) is in use by \(conflict.process.name) (PID: \(conflict.process.pid))")

            // Handle based on conflict type
            switch conflict.suggestedAction {
            case .killOurInstance(let pid, let processName):
                logger.info("Attempting to kill conflicting process: \(processName) (PID: \(pid))")

                do {
                    try await PortConflictResolver.shared.resolveConflict(conflict)
                    // resolveConflict now includes exponential backoff
                } catch {
                    logger.error("Failed to resolve port conflict: \(error)")
                    lastError = PortConflictError.failedToKillProcess(pid: pid)
                    return
                }

            case .reportExternalApp(let appName):
                logger.error("Port \(self.port) is used by external app: \(appName)")
                lastError = ServerManagerError.portInUseByApp(
                    appName: appName,
                    port: Int(self.port) ?? NetworkConstants.defaultPort,
                    alternatives: conflict.alternativePorts
                )
                return

            case .suggestAlternativePort:
                // This shouldn't happen in our case
                logger.warning("Port conflict requires alternative port")
            }
        }

        do {
            let server = BunServer()
            server.port = port
            let currentBindAddress = bindAddress
            server.bindAddress = currentBindAddress
            logger.info("Starting server with port=\(self.port), bindAddress=\(currentBindAddress)")

            // Set up crash handler
            server.onCrash = { [weak self] exitCode in
                Task { @MainActor in
                    await self?.handleServerCrash(exitCode: exitCode)
                }
            }

            try await server.start()

            bunServer = server
            // Check server state to ensure it's actually running
            if server.getState() == .running {
                // Update sleep prevention FIRST before updating state
                // This prevents a race condition where the server could crash after setting isRunning = true
                let preventSleep = AppConstants.boolValue(for: AppConstants.UserDefaultsKeys.preventSleepWhenRunning)
                powerManager.updateSleepPrevention(enabled: preventSleep, serverRunning: true)

                // Now update state
                isRunning = true
                lastError = nil
                // Reset crash counter on successful start
                consecutiveCrashes = 0

                // Start notification service
                await NotificationService.shared.start()
            } else {
                logger.error("Server started but not in running state")
                isRunning = false
                bunServer = nil
                lastError = BunServerError.processFailedToStart
                return
            }

            logger.info("Started server on port \(self.port)")

            // Initialize terminal control handler
            // The handler registers itself with SharedUnixSocketManager during init
            _ = TerminalControlHandler.shared

            // Initialize notification control handler
            _ = NotificationControlHandler.shared

            // Note: SystemControlHandler is initialized in AppDelegate via
            // SharedUnixSocketManager.initializeSystemHandler()

            // Pass the local auth token to SessionMonitor
            SessionMonitor.shared.setLocalAuthToken(server.localToken)

            // Trigger cleanup of old sessions after server starts
            await triggerInitialCleanup()
        } catch {
            logger.error("Failed to start server: \(error.localizedDescription)")
            lastError = error

            // Always clean up on error
            isRunning = false
            bunServer = nil
        }
    }

    /// Stop the current server
    func stop() async {
        guard let server = bunServer else {
            logger.warning("No server running")
            isRunning = false // Ensure state is synced
            return
        }

        logger.info("Stopping server")

        // Clear crash handler to prevent auto-restart
        server.onCrash = nil

        await server.stop()
        bunServer = nil

        isRunning = false

        // Post notification that server state has changed
        NotificationCenter.default.post(name: .serverStateChanged, object: nil)

        // Clear the auth token from SessionMonitor
        SessionMonitor.shared.setLocalAuthToken(nil)

        // Allow sleep when server is stopped
        powerManager.updateSleepPrevention(enabled: false, serverRunning: false)

        // Reset crash tracking when manually stopped
        consecutiveCrashes = 0
        lastCrashTime = nil
    }

    /// Restart the current server
    func restart() async {
        // Set restarting flag to prevent UI from showing "stopped" state
        isRestarting = true
        defer { isRestarting = false }

        await stop()

        // Wait with exponential backoff for port to be available
        let portNumber = Int(self.port) ?? NetworkConstants.defaultPort
        var retries = 0
        let maxRetries = 5

        while retries < maxRetries {
            let delay = 1.0 * pow(2.0, Double(retries)) // 1, 2, 4, 8, 16 seconds
            logger.info("Waiting \(delay) seconds for port to be released (attempt \(retries + 1)/\(maxRetries))...")
            try? await Task.sleep(for: .seconds(delay))

            if await PortConflictResolver.shared.canBindToPort(portNumber) {
                logger.info("Port \(portNumber) is now available")
                break
            }

            retries += 1
        }

        if retries == maxRetries {
            logger.error("Port \(portNumber) still unavailable after \(maxRetries) attempts")
            lastError = PortConflictError.portStillInUse(port: portNumber)
            return
        }

        await start()
    }

    /// Trigger cleanup of exited sessions after server startup
    private func triggerInitialCleanup() async {
        // Check if cleanup on startup is enabled
        guard cleanupOnStartup else {
            logger.info("Cleanup on startup is disabled in settings")
            return
        }

        logger.info("Triggering initial cleanup of exited sessions")

        // Delay to ensure server is fully ready
        try? await Task.sleep(for: .milliseconds(10_000))

        do {
            // Create authenticated request for cleanup
            var request = try makeRequest(endpoint: APIEndpoints.cleanupExited, method: "POST")
            request.timeoutInterval = 10

            // Make the cleanup request
            let (data, response) = try await URLSession.shared.data(for: request)

            if let httpResponse = response as? HTTPURLResponse {
                if httpResponse.statusCode == 200 {
                    // Try to parse the response
                    if let jsonData = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                       let cleanedCount = jsonData["cleaned_count"] as? Int
                    {
                        logger.info("Initial cleanup completed: cleaned \(cleanedCount) exited sessions")
                    } else {
                        logger.info("Initial cleanup completed successfully")
                    }
                } else {
                    logger.warning("Initial cleanup returned status code: \(httpResponse.statusCode)")
                }
            }
        } catch {
            // Log the error but don't fail startup
            logger.warning("Failed to trigger initial cleanup: \(error.localizedDescription)")
        }
    }

    /// Manually trigger a server restart (for UI button)
    func manualRestart() async {
        await restart()
    }

    /// Clear the authentication cache (e.g., when password is changed or cleared)
    func clearAuthCache() async {
        // Authentication cache clearing is no longer needed as external servers handle their own auth
        logger.info("Authentication cache clearing requested - handled by external server")
    }

    // MARK: - Server Management

    /// Handle server crash with automatic restart logic
    private func handleServerCrash(exitCode: Int32) async {
        // Special handling for exit code 9 (port in use)
        if exitCode == 9 {
            logger.error("Server failed to start: Port \(self.port) is already in use")
        } else {
            logger.error("Server crashed with exit code: \(exitCode)")
        }

        // Update state immediately
        isRunning = false
        bunServer = nil

        // Allow sleep when server crashes
        powerManager.updateSleepPrevention(enabled: false, serverRunning: false)

        // Prevent multiple simultaneous crash handlers
        guard !isHandlingCrash else {
            logger.warning("Already handling a crash, skipping duplicate handler")
            return
        }

        isHandlingCrash = true
        defer { isHandlingCrash = false }

        // Check crash rate
        let now = Date()
        if let lastCrash = lastCrashTime {
            let timeSinceLastCrash = now.timeIntervalSince(lastCrash)
            if timeSinceLastCrash < 60 { // Less than 1 minute since last crash
                consecutiveCrashes += 1
            } else {
                // Reset counter if it's been a while
                consecutiveCrashes = 1
            }
        } else {
            consecutiveCrashes = 1
        }
        lastCrashTime = now

        // Implement exponential backoff for crashes
        let maxRetries = 3
        guard consecutiveCrashes <= maxRetries else {
            logger.error("Server crashed \(self.consecutiveCrashes) times in a row, giving up on auto-restart")
            lastError = ServerError.repeatedCrashes(count: consecutiveCrashes)
            return
        }

        // Special handling for exit code 9 (port already in use)
        if exitCode == 9 {
            logger.info("Port \(self.port) is in use, checking for conflicts...")

            // Check for port conflicts
            if let conflict = await PortConflictResolver.shared
                .detectConflict(on: Int(self.port) ?? NetworkConstants.defaultPort)
            {
                logger.warning("Found port conflict: \(conflict.process.name) (PID: \(conflict.process.pid))")

                // Try to resolve the conflict
                if case .killOurInstance(let pid, let processName) = conflict.suggestedAction {
                    logger.info("Attempting to kill conflicting process: \(processName) (PID: \(pid))")

                    do {
                        try await PortConflictResolver.shared.resolveConflict(conflict)
                        // resolveConflict now includes exponential backoff
                    } catch {
                        logger.error("Failed to resolve port conflict: \(error)")
                        lastError = PortConflictError.failedToKillProcess(pid: pid)
                        return
                    }
                } else {
                    logger.error("Cannot auto-resolve port conflict")
                    return
                }
            } else {
                // Port might still be in TIME_WAIT state, wait with backoff
                logger.info("Port may be in TIME_WAIT state, checking availability...")

                let portNumber = Int(self.port) ?? NetworkConstants.defaultPort
                var retries = 0
                let maxRetries = 5

                while retries < maxRetries {
                    let delay = 2.0 * pow(2.0, Double(retries)) // 2, 4, 8, 16, 32 seconds
                    logger.info("Waiting \(delay) seconds for port to clear (attempt \(retries + 1)/\(maxRetries))...")
                    try? await Task.sleep(for: .seconds(delay))

                    if await PortConflictResolver.shared.canBindToPort(portNumber) {
                        logger.info("Port \(portNumber) is now available")
                        break
                    }

                    retries += 1
                }

                if retries == maxRetries {
                    logger.error("Port \(portNumber) still in TIME_WAIT after \(maxRetries) attempts")
                    lastError = PortConflictError.portStillInUse(port: portNumber)
                    return
                }
            }
        } else {
            // Normal crash handling with exponential backoff
            let baseDelay: TimeInterval = 2.0
            let delay = baseDelay * pow(2.0, Double(consecutiveCrashes - 1))

            logger
                .info(
                    "Will restart server after \(delay) seconds (attempt \(self.consecutiveCrashes) of \(maxRetries))"
                )

            // Wait with exponential backoff
            try? await Task.sleep(for: .seconds(delay))
        }

        // Only restart if we haven't been manually stopped in the meantime
        guard bunServer == nil else {
            logger.info("Server was manually restarted during crash recovery, skipping auto-restart")
            return
        }

        // Restart with full port conflict detection
        logger.info("Auto-restarting server after crash...")
        await start()
    }

    /// Monitor server health periodically
    func startHealthMonitoring() {
        Task {
            // Check initial state on app launch
            if let server = bunServer, server.getState() == .running {
                let preventSleep = AppConstants.boolValue(for: AppConstants.UserDefaultsKeys.preventSleepWhenRunning)
                powerManager.updateSleepPrevention(enabled: preventSleep, serverRunning: true)
            }

            while true {
                try? await Task.sleep(for: .seconds(30))

                guard let server = bunServer else { continue }

                // Check server state and process health
                let state = server.getState()
                let health = await server.checkHealth()

                if (!health || state == .crashed) && isRunning {
                    logger.warning("Server health check failed but state shows running, syncing state")
                    isRunning = false
                    bunServer = nil

                    // Only trigger restart if not already handling a crash
                    if !isHandlingCrash {
                        await handleServerCrash(exitCode: -1)
                    }
                }
            }
        }
    }

    // MARK: - Authentication

    /// Add authentication headers to a request
    func authenticate(request: inout URLRequest) throws {
        guard let server = bunServer else {
            throw ServerError.startupFailed(ErrorMessages.serverNotRunning)
        }
        request.setValue(server.localToken, forHTTPHeaderField: NetworkConstants.localAuthHeader)
    }

    // MARK: - Request Helpers

    /// Build a URL for the local server with the given endpoint
    func buildURL(endpoint: String) -> URL? {
        URL(string: "\(URLConstants.localServerBase):\(port)\(endpoint)")
    }

    /// Build a URL for the local server with the given endpoint and query parameters
    func buildURL(endpoint: String, queryItems: [URLQueryItem]?) -> URL? {
        guard let baseURL = buildURL(endpoint: endpoint) else { return nil }

        guard let queryItems, !queryItems.isEmpty else {
            return baseURL
        }

        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)
        components?.queryItems = queryItems
        return components?.url
    }

    /// Create an authenticated JSON request
    func makeRequest(
        endpoint: String,
        method: String = "POST",
        body: Encodable? = nil,
        queryItems: [URLQueryItem]? = nil
    )
        throws -> URLRequest
    {
        let url: URL? = if let queryItems, !queryItems.isEmpty {
            buildURL(endpoint: endpoint, queryItems: queryItems)
        } else {
            buildURL(endpoint: endpoint)
        }

        guard let url else {
            throw URLError(.badURL)
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue(NetworkConstants.contentTypeJSON, forHTTPHeaderField: NetworkConstants.contentTypeHeader)
        request.setValue(NetworkConstants.localhost, forHTTPHeaderField: NetworkConstants.hostHeader)

        if let body {
            request.httpBody = try JSONEncoder().encode(body)
        }

        try authenticate(request: &request)

        return request
    }
}

// MARK: - Network Request Extension

extension ServerManager {
    /// Perform a network request with automatic JSON parsing and error handling
    /// - Parameters:
    ///   - endpoint: The API endpoint path
    ///   - method: HTTP method (default: "POST")
    ///   - body: Optional request body (Encodable)
    ///   - queryItems: Optional query parameters
    ///   - responseType: The expected response type (must be Decodable)
    /// - Returns: Decoded response of the specified type
    /// - Throws: NetworkError for various failure cases
    func performRequest<T: Decodable>(
        endpoint: String,
        method: String = "POST",
        body: Encodable? = nil,
        queryItems: [URLQueryItem]? = nil,
        responseType: T.Type
    )
        async throws -> T
    {
        let request = try makeRequest(
            endpoint: endpoint,
            method: method,
            body: body,
            queryItems: queryItems
        )

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw NetworkError.invalidResponse
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            let errorData = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            throw NetworkError.serverError(
                statusCode: httpResponse.statusCode,
                message: errorData?.error ?? "Request failed with status \(httpResponse.statusCode)"
            )
        }

        return try JSONDecoder().decode(T.self, from: data)
    }

    /// Perform a network request that returns no body (void response)
    /// - Parameters:
    ///   - endpoint: The API endpoint path
    ///   - method: HTTP method (default: "POST")
    ///   - body: Optional request body (Encodable)
    ///   - queryItems: Optional query parameters
    /// - Throws: NetworkError for various failure cases
    func performVoidRequest(
        endpoint: String,
        method: String = "POST",
        body: Encodable? = nil,
        queryItems: [URLQueryItem]? = nil
    )
        async throws
    {
        let request = try makeRequest(
            endpoint: endpoint,
            method: method,
            body: body,
            queryItems: queryItems
        )

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw NetworkError.invalidResponse
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            let errorData = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            throw NetworkError.serverError(
                statusCode: httpResponse.statusCode,
                message: errorData?.error ?? "Request failed with status \(httpResponse.statusCode)"
            )
        }
    }
}

// MARK: - Server Manager Error

/// Errors specific to server management operations.
///
/// Handles error cases that occur during server startup and management,
/// particularly port conflicts with other applications.
enum ServerManagerError: LocalizedError {
    case portInUseByApp(appName: String, port: Int, alternatives: [Int])

    var errorDescription: String? {
        switch self {
        case .portInUseByApp(let appName, let port, _):
            "Port \(port) is in use by \(appName)"
        }
    }

    var failureReason: String? {
        switch self {
        case .portInUseByApp:
            "The port is being used by another application"
        }
    }

    var recoverySuggestion: String? {
        switch self {
        case .portInUseByApp(_, _, let alternatives):
            "Try one of these ports: \(alternatives.map(String.init).joined(separator: ", "))"
        }
    }

    var helpAnchor: String? {
        switch self {
        case .portInUseByApp:
            "port-conflict"
        }
    }
}
