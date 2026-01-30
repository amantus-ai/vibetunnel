import Foundation
import Observation
import OSLog
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
        case let .portInUse(port):
            "Port \(port) is already in use"
        case let .startupFailed(reason):
            "Server startup failed: \(reason)"
        }
    }

    var failureReason: String? {
        switch self {
        case let .repeatedCrashes(count):
            "The server crashed \(count) times in a row"
        case let .portInUse(port):
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
        self.bunServer?.localToken
    }

    /// The current authentication mode of the server
    var authMode: String {
        self.bunServer?.authMode ?? "os"
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
                self.logger.debug("bindAddress setter: set mode=\(mode.rawValue) for bindAddress=\(newValue)")
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

    /// The process ID of the running server, if available
    var serverProcessId: Int32? {
        self.bunServer?.processIdentifier
    }

    /// Track if we're in the middle of handling a crash to prevent multiple restarts
    private var isHandlingCrash = false
    /// Number of consecutive crashes for backoff
    private var consecutiveCrashes = 0
    /// Last crash time for crash rate detection
    private var lastCrashTime: Date?

    private let logger = Logger(subsystem: BundleIdentifiers.main, category: "ServerManager")
    private let powerManager = PowerManagementService.shared
    private var tailscaleMonitorTask: Task<Void, Never>?

    private init() {
        // Skip observer setup and monitoring during tests
        let isRunningInTests = ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil ||
            ProcessInfo.processInfo.environment["XCTestBundlePath"] != nil ||
            ProcessInfo.processInfo.environment["XCTestSessionIdentifier"] != nil ||
            ProcessInfo.processInfo.arguments.contains("-XCTest") ||
            NSClassFromString("XCTestCase") != nil

        if !isRunningInTests {
            self.setupObservers()
            // Start health monitoring
            self.startHealthMonitoring()
        }
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    private func setupObservers() {
        // Watch for UserDefaults changes (e.g., sleep prevention setting)
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(self.userDefaultsDidChange),
            name: UserDefaults.didChangeNotification,
            object: nil)
    }

    @objc
    private nonisolated func userDefaultsDidChange() {
        Task { @MainActor in
            // Only update sleep prevention if server is running
            guard self.isRunning else { return }

            // Check if preventSleepWhenRunning setting changed
            let preventSleep = AppConstants.boolValue(for: AppConstants.UserDefaultsKeys.preventSleepWhenRunning)
            self.powerManager.updateSleepPrevention(enabled: preventSleep, serverRunning: true)

            self.logger.info("Updated sleep prevention setting: \(preventSleep ? "enabled" : "disabled")")
        }
    }

    /// Monitor Tailscale Serve status and trigger fallback if permanently disabled
    private func startTailscaleMonitoring() {
        // Cancel existing task if any
        self.tailscaleMonitorTask?.cancel()

        // Only monitor if Tailscale Serve is enabled
        let tailscaleEnabled = AppConstants.boolValue(for: AppConstants.UserDefaultsKeys.tailscaleServeEnabled)
        self.logger
            .debug(
                "[TAILSCALE MONITOR] Checking if monitoring should start - tailscaleServeEnabled = \(tailscaleEnabled)")

        guard tailscaleEnabled else {
            self.logger.debug("[TAILSCALE MONITOR] Tailscale Serve not enabled, skipping monitoring")
            return
        }

        self.tailscaleMonitorTask = Task {
            self.logger.debug("[TAILSCALE MONITOR] Starting Tailscale Serve monitoring for fallback")

            // Give initial startup a chance
            self.logger.debug("[TAILSCALE MONITOR] Waiting 5 seconds for initial startup...")
            try? await Task.sleep(for: .seconds(5))

            var checkCount = 0
            while !Task.isCancelled {
                checkCount += 1
                self.logger.debug("[TAILSCALE MONITOR] Check #\(checkCount) at 10-second interval")

                // Check if Tailscale Serve is permanently disabled
                let isPermanentlyDisabled = TailscaleServeStatusService.shared.isPermanentlyDisabled

                if isPermanentlyDisabled {
                    self.logger
                        .info(
                            "[TAILSCALE MONITOR] Tailscale Serve not available on tailnet - operating in fallback mode")
                    // Don't trigger fallback - just stop monitoring since we're in fallback mode
                    // The UI correctly shows "Fallback" status and direct access works
                    break
                }

                self.logger.debug("[TAILSCALE MONITOR] Status OK, waiting 10 seconds for next check...")
                // Check every 10 seconds
                try? await Task.sleep(for: .seconds(10))
            }
        }
    }

    private func stopTailscaleMonitoring() {
        self.tailscaleMonitorTask?.cancel()
        self.tailscaleMonitorTask = nil
    }

    /// Start the server with current configuration
    func start() async {
        // Check if we already have a running server
        if let existingServer = bunServer {
            let state = existingServer.getState()

            switch state {
            case .running:
                self.logger.info("Server already running on port \(existingServer.port)")
                // Ensure our state is synced
                self.isRunning = true
                self.lastError = nil
                // Start notification service if server is already running
                await NotificationService.shared.start()
                return
            case .starting:
                self.logger.info("Server is already starting")
                return
            case .stopping:
                self.logger.warning("Cannot start server while it's stopping")
                self.lastError = BunServerError.invalidState
                return
            case .crashed, .idle:
                // Clean up and proceed with start
                self.bunServer = nil
                self.isRunning = false
            }
        }

        // First check if port is truly available by trying to bind to it
        let portNumber = Int(self.port) ?? NetworkConstants.defaultPort

        let canBind = await PortConflictResolver.shared.canBindToPort(portNumber)
        if !canBind {
            self.logger.warning("Cannot bind to port \(portNumber), checking for conflicts...")
        }

        // Check for port conflicts before starting
        if let conflict = await PortConflictResolver.shared.detectConflict(on: portNumber) {
            self.logger
                .warning("Port \(self.port) is in use by \(conflict.process.name) (PID: \(conflict.process.pid))")

            // Handle based on conflict type
            switch conflict.suggestedAction {
            case let .killOurInstance(pid, processName):
                self.logger.info("Attempting to kill conflicting process: \(processName) (PID: \(pid))")

                do {
                    try await PortConflictResolver.shared.resolveConflict(conflict)
                    // resolveConflict now includes exponential backoff
                } catch {
                    self.logger.error("Failed to resolve port conflict: \(error)")
                    self.lastError = PortConflictError.failedToKillProcess(pid: pid)
                    return
                }

            case let .reportExternalApp(appName):
                self.logger.error("Port \(self.port) is used by external app: \(appName)")
                self.lastError = ServerManagerError.portInUseByApp(
                    appName: appName,
                    port: Int(self.port) ?? NetworkConstants.defaultPort,
                    alternatives: conflict.alternativePorts)
                return

            case .suggestAlternativePort:
                // This shouldn't happen in our case
                self.logger.warning("Port conflict requires alternative port")
            }
        }

        do {
            let server = BunServer()
            server.port = self.port
            let currentBindAddress = self.bindAddress
            server.bindAddress = currentBindAddress
            self.logger.info("Starting server with port=\(self.port), bindAddress=\(currentBindAddress)")

            // Set up crash handler
            server.onCrash = { [weak self] exitCode in
                Task { @MainActor in
                    await self?.handleServerCrash(exitCode: exitCode)
                }
            }

            try await server.start()

            self.bunServer = server
            // Check server state to ensure it's actually running
            if server.getState() == .running {
                // Update sleep prevention FIRST before updating state
                // This prevents a race condition where the server could crash after setting isRunning = true
                let preventSleep = AppConstants.boolValue(for: AppConstants.UserDefaultsKeys.preventSleepWhenRunning)
                self.powerManager.updateSleepPrevention(enabled: preventSleep, serverRunning: true)

                // Now update state
                self.isRunning = true
                self.lastError = nil
                // Reset crash counter on successful start
                self.consecutiveCrashes = 0

                // Start notification service
                await NotificationService.shared.start()

                // Start monitoring Tailscale Serve status for fallback
                self.startTailscaleMonitoring()
            } else {
                self.logger.error("Server started but not in running state")
                self.isRunning = false
                self.bunServer = nil
                self.lastError = BunServerError.processFailedToStart
                return
            }

            self.logger.info("Started server on port \(self.port)")

            // Initialize terminal control handler
            // The handler registers itself with SharedUnixSocketManager during init
            _ = TerminalControlHandler.shared

            // Note: SystemControlHandler is initialized in AppDelegate via
            // SharedUnixSocketManager.initializeSystemHandler()

            // Pass the local auth token to SessionMonitor
            SessionMonitor.shared.setLocalAuthToken(server.localToken)

            // Trigger cleanup of old sessions after server starts
            await self.triggerInitialCleanup()
        } catch {
            self.logger.error("Failed to start server: \(error.localizedDescription)")
            self.lastError = error

            // Always clean up on error
            self.isRunning = false
            self.bunServer = nil
        }
    }

    /// Stop the current server
    func stop() async {
        guard let server = bunServer else {
            self.logger.warning("No server running")
            self.isRunning = false // Ensure state is synced
            return
        }

        self.logger.info("Stopping server")

        // Clear crash handler to prevent auto-restart
        server.onCrash = nil

        await server.stop()
        self.bunServer = nil

        self.isRunning = false

        // Stop Tailscale monitoring
        self.stopTailscaleMonitoring()

        // Stop notification service connection when server stops
        NotificationService.shared.stop()

        // Clear the auth token from SessionMonitor
        SessionMonitor.shared.setLocalAuthToken(nil)

        // Allow sleep when server is stopped
        self.powerManager.updateSleepPrevention(enabled: false, serverRunning: false)

        // Reset crash tracking when manually stopped
        self.consecutiveCrashes = 0
        self.lastCrashTime = nil
    }

    /// Restart the current server
    func restart() async {
        // Set restarting flag to prevent UI from showing "stopped" state
        self.isRestarting = true
        defer { isRestarting = false }

        await self.stop()

        // Wait with exponential backoff for port to be available
        let portNumber = Int(self.port) ?? NetworkConstants.defaultPort
        var retries = 0
        let maxRetries = 5

        while retries < maxRetries {
            let delay = 1.0 * pow(2.0, Double(retries)) // 1, 2, 4, 8, 16 seconds
            self.logger
                .info("Waiting \(delay) seconds for port to be released (attempt \(retries + 1)/\(maxRetries))...")
            try? await Task.sleep(for: .seconds(delay))

            if await PortConflictResolver.shared.canBindToPort(portNumber) {
                self.logger.info("Port \(portNumber) is now available")
                break
            }

            retries += 1
        }

        if retries == maxRetries {
            self.logger.error("Port \(portNumber) still unavailable after \(maxRetries) attempts")
            self.lastError = PortConflictError.portStillInUse(port: portNumber)
            return
        }

        await self.start()
    }

    /// Trigger cleanup of exited sessions after server startup
    private func triggerInitialCleanup() async {
        // Check if cleanup on startup is enabled
        guard self.cleanupOnStartup else {
            self.logger.info("Cleanup on startup is disabled in settings")
            return
        }

        self.logger.info("Triggering initial cleanup of exited sessions")

        // Delay to ensure server is fully ready
        try? await Task.sleep(for: .milliseconds(10000))

        do {
            // Create authenticated request for cleanup
            var request = try makeRequest(endpoint: APIEndpoints.cleanupExited, method: "POST")
            request.timeoutInterval = 10

            // Make the cleanup request
            let (data, response) = try await URLSession.shared.data(for: request)

            if let httpResponse = response as? HTTPURLResponse {
                if httpResponse.statusCode == 200 {
                    // Parse the server response
                    if let jsonData = JSONValue.decodeObject(from: data),
                       let cleanedCount = jsonData["localCleaned"]?.int
                    {
                        self.logger.info("Initial cleanup completed: cleaned \(cleanedCount) exited sessions")
                    } else {
                        self.logger.info("Initial cleanup completed successfully")
                    }
                } else {
                    self.logger.warning("Initial cleanup returned status code: \(httpResponse.statusCode)")
                }
            }
        } catch {
            // Log the error but don't fail startup
            self.logger.warning("Failed to trigger initial cleanup: \(error.localizedDescription)")
        }
    }

    /// Manually trigger a server restart (for UI button)
    func manualRestart() async {
        await self.restart()
    }

    /// Clear the authentication cache (e.g., when password is changed or cleared)
    func clearAuthCache() async {
        // Authentication cache clearing is no longer needed as external servers handle their own auth
        self.logger.info("Authentication cache clearing requested - handled by external server")
    }

    // MARK: - Server Management

    /// Handle server crash with automatic restart logic
    private func handleServerCrash(exitCode: Int32) async {
        // Special handling for exit code 9 (port in use)
        if exitCode == 9 {
            self.logger.error("Server failed to start: Port \(self.port) is already in use")
        } else {
            self.logger.error("Server crashed with exit code: \(exitCode)")
        }

        // Update state immediately
        self.isRunning = false
        self.bunServer = nil

        // Allow sleep when server crashes
        self.powerManager.updateSleepPrevention(enabled: false, serverRunning: false)

        // Prevent multiple simultaneous crash handlers
        guard !self.isHandlingCrash else {
            self.logger.warning("Already handling a crash, skipping duplicate handler")
            return
        }

        self.isHandlingCrash = true
        defer { isHandlingCrash = false }

        // Check crash rate
        let now = Date()
        if let lastCrash = lastCrashTime {
            let timeSinceLastCrash = now.timeIntervalSince(lastCrash)
            if timeSinceLastCrash < 60 { // Less than 1 minute since last crash
                self.consecutiveCrashes += 1
            } else {
                // Reset counter if it's been a while
                self.consecutiveCrashes = 1
            }
        } else {
            self.consecutiveCrashes = 1
        }
        self.lastCrashTime = now

        // Implement exponential backoff for crashes
        let maxRetries = 3
        guard self.consecutiveCrashes <= maxRetries else {
            self.logger.error("Server crashed \(self.consecutiveCrashes) times in a row, giving up on auto-restart")
            self.lastError = ServerError.repeatedCrashes(count: self.consecutiveCrashes)
            return
        }

        // Special handling for exit code 9 (port already in use)
        if exitCode == 9 {
            self.logger.info("Port \(self.port) is in use, checking for conflicts...")

            // Check for port conflicts
            if let conflict = await PortConflictResolver.shared
                .detectConflict(on: Int(self.port) ?? NetworkConstants.defaultPort)
            {
                self.logger.warning("Found port conflict: \(conflict.process.name) (PID: \(conflict.process.pid))")

                // Try to resolve the conflict
                if case let .killOurInstance(pid, processName) = conflict.suggestedAction {
                    self.logger.info("Attempting to kill conflicting process: \(processName) (PID: \(pid))")

                    do {
                        try await PortConflictResolver.shared.resolveConflict(conflict)
                        // resolveConflict now includes exponential backoff
                    } catch {
                        self.logger.error("Failed to resolve port conflict: \(error)")
                        self.lastError = PortConflictError.failedToKillProcess(pid: pid)
                        return
                    }
                } else {
                    self.logger.error("Cannot auto-resolve port conflict")
                    return
                }
            } else {
                // Port might still be in TIME_WAIT state, wait with backoff
                self.logger.info("Port may be in TIME_WAIT state, checking availability...")

                let portNumber = Int(self.port) ?? NetworkConstants.defaultPort
                var retries = 0
                let maxRetries = 5

                while retries < maxRetries {
                    let delay = 2.0 * pow(2.0, Double(retries)) // 2, 4, 8, 16, 32 seconds
                    self.logger
                        .info("Waiting \(delay) seconds for port to clear (attempt \(retries + 1)/\(maxRetries))...")
                    try? await Task.sleep(for: .seconds(delay))

                    if await PortConflictResolver.shared.canBindToPort(portNumber) {
                        self.logger.info("Port \(portNumber) is now available")
                        break
                    }

                    retries += 1
                }

                if retries == maxRetries {
                    self.logger.error("Port \(portNumber) still in TIME_WAIT after \(maxRetries) attempts")
                    self.lastError = PortConflictError.portStillInUse(port: portNumber)
                    return
                }
            }
        } else {
            // Normal crash handling with exponential backoff
            let baseDelay: TimeInterval = 2.0
            let delay = baseDelay * pow(2.0, Double(self.consecutiveCrashes - 1))

            self.logger
                .info(
                    "Will restart server after \(delay) seconds (attempt \(self.consecutiveCrashes) of \(maxRetries))")

            // Wait with exponential backoff
            try? await Task.sleep(for: .seconds(delay))
        }

        // Only restart if we haven't been manually stopped in the meantime
        guard self.bunServer == nil else {
            self.logger.info("Server was manually restarted during crash recovery, skipping auto-restart")
            return
        }

        // Restart with full port conflict detection
        self.logger.info("Auto-restarting server after crash...")
        await self.start()
    }

    /// Monitor server health periodically
    func startHealthMonitoring() {
        Task {
            // Check initial state on app launch
            if let server = bunServer, server.getState() == .running {
                let preventSleep = AppConstants.boolValue(for: AppConstants.UserDefaultsKeys.preventSleepWhenRunning)
                self.powerManager.updateSleepPrevention(enabled: preventSleep, serverRunning: true)
            }

            while true {
                try? await Task.sleep(for: .seconds(30))

                guard let server = bunServer else { continue }

                // Check server state and process health
                let state = server.getState()
                let health = await server.checkHealth()

                if !health || state == .crashed, self.isRunning {
                    self.logger.warning("Server health check failed but state shows running, syncing state")
                    self.isRunning = false
                    self.bunServer = nil

                    // Only trigger restart if not already handling a crash
                    if !self.isHandlingCrash {
                        await self.handleServerCrash(exitCode: -1)
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
        URL(string: "\(URLConstants.localServerBase):\(self.port)\(endpoint)")
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
        queryItems: [URLQueryItem]? = nil)
        throws -> URLRequest
    {
        let url: URL? = if let queryItems, !queryItems.isEmpty {
            self.buildURL(endpoint: endpoint, queryItems: queryItems)
        } else {
            self.buildURL(endpoint: endpoint)
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

        try self.authenticate(request: &request)

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
        responseType: T.Type)
        async throws -> T
    {
        let request = try makeRequest(
            endpoint: endpoint,
            method: method,
            body: body,
            queryItems: queryItems)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw NetworkError.invalidResponse
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            let errorData = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            throw NetworkError.serverError(
                statusCode: httpResponse.statusCode,
                message: errorData?.error ?? "Request failed with status \(httpResponse.statusCode)")
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
        queryItems: [URLQueryItem]? = nil)
        async throws
    {
        let request = try makeRequest(
            endpoint: endpoint,
            method: method,
            body: body,
            queryItems: queryItems)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw NetworkError.invalidResponse
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            let errorData = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            throw NetworkError.serverError(
                statusCode: httpResponse.statusCode,
                message: errorData?.error ?? "Request failed with status \(httpResponse.statusCode)")
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
        case let .portInUseByApp(appName, port, _):
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
        case let .portInUseByApp(_, _, alternatives):
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
