import Foundation
import Observation
import OSLog
import SwiftUI

/// Manages the active server and handles switching between modes.
///
/// `ServerManager` is the central coordinator for server lifecycle management in VibeTunnel.
/// It handles starting, stopping, and switching between different server implementations (Rust/Hummingbird),
/// manages server configuration, and provides logging capabilities. The manager ensures only one
/// server instance runs at a time and coordinates smooth transitions between server modes.
@MainActor
@Observable
class ServerManager {
    @MainActor static let shared = ServerManager()

    private var serverModeString: String {
        get { UserDefaults.standard.string(forKey: "serverMode") ?? ServerMode.rust.rawValue }
        set { UserDefaults.standard.set(newValue, forKey: "serverMode") }
    }

    var port: String {
        get { UserDefaults.standard.string(forKey: "serverPort") ?? "4020" }
        set { UserDefaults.standard.set(newValue, forKey: "serverPort") }
    }

    var bindAddress: String {
        get {
            let mode = DashboardAccessMode(rawValue: UserDefaults.standard.string(forKey: "dashboardAccessMode") ?? ""
            ) ??
                .localhost
            return mode.bindAddress
        }
        set {
            // Find the mode that matches this bind address
            if let mode = DashboardAccessMode.allCases.first(where: { $0.bindAddress == newValue }) {
                UserDefaults.standard.set(mode.rawValue, forKey: "dashboardAccessMode")
            }
        }
    }

    private var cleanupOnStartup: Bool {
        get { UserDefaults.standard.bool(forKey: "cleanupOnStartup") }
        set { UserDefaults.standard.set(newValue, forKey: "cleanupOnStartup") }
    }

    private(set) var currentServer: ServerProtocol?
    private(set) var isRunning = false
    private(set) var isSwitching = false
    private(set) var isRestarting = false
    private(set) var lastError: Error?
    private(set) var crashCount = 0
    private(set) var lastCrashTime: Date?
    private var monitoringTask: Task<Void, Never>?
    private var crashRecoveryTask: Task<Void, Never>?

    private let logger = Logger(subsystem: "com.steipete.VibeTunnel", category: "ServerManager")
    private var logContinuation: AsyncStream<ServerLogEntry>.Continuation?
    private var serverLogTask: Task<Void, Never>?
    private(set) var logStream: AsyncStream<ServerLogEntry>!

    var serverMode: ServerMode {
        get { ServerMode(rawValue: serverModeString) ?? .rust }
        set { serverModeString = newValue.rawValue }
    }

    private init() {
        setupLogStream()

        // Skip observer setup and monitoring during tests
        let isRunningInTests = ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil ||
            ProcessInfo.processInfo.environment["XCTestBundlePath"] != nil ||
            ProcessInfo.processInfo.environment["XCTestSessionIdentifier"] != nil ||
            ProcessInfo.processInfo.arguments.contains("-XCTest") ||
            NSClassFromString("XCTestCase") != nil

        if !isRunningInTests {
            setupObservers()
            startCrashMonitoring()
        }
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        // Tasks will be cancelled when they are deallocated
    }

    private func setupLogStream() {
        logStream = AsyncStream { continuation in
            self.logContinuation = continuation
        }
    }

    private func setupObservers() {
        // Watch for server mode changes when the value actually changes
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
            await handleServerModeChange()
        }
    }

    /// Start the server with current configuration
    func start() async {
        // Check if we already have a running server
        if let existingServer = currentServer {
            logger.info("Server already running on port \(existingServer.port)")

            // Ensure our state is synced
            isRunning = true
            lastError = nil
            ServerMonitor.shared.isServerRunning = true

            // Log for clarity
            logContinuation?.yield(ServerLogEntry(
                level: .info,
                message: "\(serverMode.displayName) server already running on port \(port)",
                source: serverMode
            ))
            return
        }

        // Log that we're starting a server
        logContinuation?.yield(ServerLogEntry(
            level: .info,
            message: "Starting \(serverMode.displayName) server on port \(port)...",
            source: serverMode
        ))

        do {
            let server = createServer(for: serverMode)
            server.port = port

            // Subscribe to server logs
            serverLogTask = Task { [weak self] in
                for await entry in server.logStream {
                    self?.logContinuation?.yield(entry)
                }
            }

            try await server.start()

            currentServer = server
            isRunning = true
            lastError = nil

            logger.info("Started \(self.serverMode.displayName) server on port \(self.port)")

            // Update ServerMonitor for compatibility
            ServerMonitor.shared.isServerRunning = true

            // Trigger cleanup of old sessions after server starts
            await triggerInitialCleanup()
        } catch {
            logger.error("Failed to start server: \(error.localizedDescription)")
            logContinuation?.yield(ServerLogEntry(
                level: .error,
                message: "Failed to start \(serverMode.displayName) server: \(error.localizedDescription)",
                source: serverMode
            ))
            lastError = error

            // Check if server is actually running despite the error
            if let server = currentServer, server.isRunning {
                logger.warning("Server reported as running despite startup error, syncing state")
                isRunning = true
                ServerMonitor.shared.isServerRunning = true
            } else {
                isRunning = false
                ServerMonitor.shared.isServerRunning = false
            }
        }
    }

    /// Stop the current server
    func stop() async {
        guard let server = currentServer else {
            logger.warning("No server running")
            return
        }

        let serverType = server.serverType
        logger.info("Stopping \(serverType.displayName) server")

        // Log that we're stopping the server
        logContinuation?.yield(ServerLogEntry(
            level: .info,
            message: "Stopping \(serverType.displayName) server...",
            source: serverType
        ))

        await server.stop()
        serverLogTask?.cancel()
        serverLogTask = nil
        currentServer = nil
        isRunning = false

        // Log that the server has stopped
        logContinuation?.yield(ServerLogEntry(
            level: .info,
            message: "\(serverType.displayName) server stopped",
            source: serverType
        ))

        // Update ServerMonitor for compatibility
        // Only set to false if we're not in the middle of a restart
        if !isRestarting {
            ServerMonitor.shared.isServerRunning = false
        }
    }

    /// Restart the current server
    func restart() async {
        // Set restarting flag to prevent UI from showing "stopped" state
        isRestarting = true
        defer { isRestarting = false }

        // Log that we're restarting
        logContinuation?.yield(ServerLogEntry(
            level: .info,
            message: "Restarting server...",
            source: serverMode
        ))

        await stop()
        await start()
    }

    /// Switch to a different server mode
    func switchMode(to mode: ServerMode) async {
        guard mode != serverMode else { return }

        isSwitching = true
        defer { isSwitching = false }

        let oldMode = serverMode
        logger.info("Switching from \(oldMode.displayName) to \(mode.displayName)")

        // Log the mode switch with a clear separator
        logContinuation?.yield(ServerLogEntry(
            level: .info,
            message: "════════════════════════════════════════════════════════",
            source: oldMode
        ))
        logContinuation?.yield(ServerLogEntry(
            level: .info,
            message: "Switching server mode: \(oldMode.displayName) → \(mode.displayName)",
            source: oldMode
        ))
        logContinuation?.yield(ServerLogEntry(
            level: .info,
            message: "════════════════════════════════════════════════════════",
            source: oldMode
        ))

        // Stop current server if running
        if currentServer != nil {
            await stop()
        }

        // Add a small delay for visual clarity in logs
        try? await Task.sleep(for: .milliseconds(500))

        // Update mode
        serverMode = mode

        // Start new server
        await start()

        // Log completion
        logContinuation?.yield(ServerLogEntry(
            level: .info,
            message: "════════════════════════════════════════════════════════",
            source: mode
        ))
        logContinuation?.yield(ServerLogEntry(
            level: .info,
            message: "Server mode switch completed successfully",
            source: mode
        ))
        logContinuation?.yield(ServerLogEntry(
            level: .info,
            message: "════════════════════════════════════════════════════════",
            source: mode
        ))
    }

    private func handleServerModeChange() async {
        // This is called when serverMode changes via AppStorage
        // If we have a running server, switch to the new mode
        if currentServer != nil {
            await switchMode(to: serverMode)
        }
    }

    private func createServer(for mode: ServerMode) -> ServerProtocol {
        switch mode {
        case .hummingbird:
            HummingbirdServer()
        case .rust:
            RustServer()
        }
    }

    /// Trigger cleanup of exited sessions after server startup
    private func triggerInitialCleanup() async {
        // Check if cleanup on startup is enabled
        guard cleanupOnStartup else {
            logger.info("Cleanup on startup is disabled in settings")
            return
        }

        logger.info("Triggering initial cleanup of exited sessions")

        // Small delay to ensure server is fully ready
        try? await Task.sleep(for: .milliseconds(500))

        do {
            // Create URL for cleanup endpoint
            guard let url = URL(string: "http://localhost:\(port)/api/cleanup-exited") else {
                logger.warning("Failed to create cleanup URL")
                return
            }
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
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
                        logContinuation?.yield(ServerLogEntry(
                            level: .info,
                            message: "Cleaned up \(cleanedCount) exited sessions on startup",
                            source: serverMode
                        ))
                    } else {
                        logger.info("Initial cleanup completed successfully")
                        logContinuation?.yield(ServerLogEntry(
                            level: .info,
                            message: "Cleaned up exited sessions on startup",
                            source: serverMode
                        ))
                    }
                } else {
                    logger.warning("Initial cleanup returned status code: \(httpResponse.statusCode)")
                }
            }
        } catch {
            // Log the error but don't fail startup
            logger.warning("Failed to trigger initial cleanup: \(error.localizedDescription)")
            logContinuation?.yield(ServerLogEntry(
                level: .warning,
                message: "Could not clean up old sessions: \(error.localizedDescription)",
                source: serverMode
            ))
        }
    }

    // MARK: - Crash Recovery

    /// Start monitoring for server crashes
    private func startCrashMonitoring() {
        monitoringTask = Task { [weak self] in
            while !Task.isCancelled {
                // Wait for 10 seconds between checks
                try? await Task.sleep(for: .seconds(10))

                guard let self else { return }

                // Only monitor if we're in Rust mode and server should be running
                guard serverMode == .rust,
                      isRunning,
                      !isSwitching,
                      !isRestarting else { continue }

                // Check if server is responding
                let isHealthy = await checkServerHealth()

                if !isHealthy && currentServer != nil {
                    logger.warning("Server health check failed, may have crashed")
                    await handleServerCrash()
                }
            }
        }
    }

    /// Check if the server is healthy
    private func checkServerHealth() async -> Bool {
        guard let url = URL(string: "http://localhost:\(port)/api/health") else {
            return false
        }

        do {
            let request = URLRequest(url: url, timeoutInterval: 5.0)
            let (_, response) = try await URLSession.shared.data(for: request)

            if let httpResponse = response as? HTTPURLResponse {
                return httpResponse.statusCode == 200
            }
        } catch {
            // Server not responding
        }

        return false
    }

    /// Handle server crash with exponential backoff
    private func handleServerCrash() async {
        // Update crash tracking
        let now = Date()
        if let lastCrash = lastCrashTime,
           now.timeIntervalSince(lastCrash) > 300
        { // Reset count if more than 5 minutes since last crash
            self.crashCount = 0
        }

        self.crashCount += 1
        lastCrashTime = now

        // Log the crash
        logger.error("Server crashed (crash #\(self.crashCount))")
        logContinuation?.yield(ServerLogEntry(
            level: .error,
            message: "Server crashed unexpectedly (crash #\(self.crashCount))",
            source: serverMode
        ))

        // Clear the current server reference
        currentServer = nil
        isRunning = false

        // Calculate backoff delay based on crash count
        let baseDelay: Double = 2.0 // 2 seconds base delay
        let maxDelay: Double = 60.0 // Max 1 minute delay
        let delay = min(baseDelay * pow(2.0, Double(self.crashCount - 1)), maxDelay)

        logger.info("Waiting \(delay) seconds before restart attempt...")
        logContinuation?.yield(ServerLogEntry(
            level: .info,
            message: "Waiting \(Int(delay)) seconds before restart attempt...",
            source: serverMode
        ))

        // Wait with exponential backoff
        try? await Task.sleep(for: .seconds(delay))

        // Attempt to restart
        if !Task.isCancelled && serverMode == .rust {
            logger.info("Attempting to restart server after crash...")
            logContinuation?.yield(ServerLogEntry(
                level: .info,
                message: "Attempting automatic restart after crash...",
                source: serverMode
            ))

            await start()

            // If server started successfully, reset crash count after some time
            if isRunning {
                Task {
                    try? await Task.sleep(for: .seconds(300)) // 5 minutes
                    if self.isRunning {
                        self.crashCount = 0
                        self.logger.info("Server has been stable for 5 minutes, resetting crash count")
                    }
                }
            }
        }
    }

    /// Manually trigger a server restart (for UI button)
    func manualRestart() async {
        // Reset crash count for manual restarts
        self.crashCount = 0
        self.lastCrashTime = nil

        await restart()
    }

    /// Clear the authentication cache (e.g., when password is changed or cleared)
    func clearAuthCache() async {
        // Only clear cache for Hummingbird server which uses the auth middleware
        if serverMode == .hummingbird, let hummingbirdServer = currentServer as? HummingbirdServer {
            await hummingbirdServer.clearAuthCache()
            logger.info("Cleared authentication cache")
        }
    }
}
