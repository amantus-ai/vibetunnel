import AppKit
import Darwin
import Foundation
import Observation
import os

/// Manages Cloudflare tunnel integration and status checking.
///
/// `CloudflareService` provides functionality to check if cloudflared CLI is installed
/// and running on the system, and manages Quick Tunnels for exposing the local
/// VibeTunnel server. Unlike ngrok, cloudflared Quick Tunnels don't require auth tokens.
@Observable
@MainActor
final class CloudflareService {
    static let shared = CloudflareService()

    /// Standard paths to check for cloudflared binary
    private static let cloudflaredPaths = [
        "/usr/local/bin/cloudflared",
        "/opt/homebrew/bin/cloudflared",
        "/usr/bin/cloudflared",
    ]

    // MARK: - Constants

    /// Periodic status check interval in seconds
    private static let statusCheckInterval: TimeInterval = 5.0

    /// Timeout for stopping tunnel in seconds
    private static let stopTimeoutSeconds: UInt64 = 500_000_000 // 0.5 seconds in nanoseconds

    /// Timeout for process termination in seconds
    private static let processTerminationTimeout: UInt64 = 2_000_000_000 // 2 seconds in nanoseconds

    /// Server stop timeout during app termination in milliseconds
    private static let serverStopTimeoutMillis = 500

    /// Logger instance for debugging
    private let logger = Logger(subsystem: BundleIdentifiers.loggerSubsystem, category: "CloudflareService")

    /// Indicates if cloudflared CLI is installed on the system
    private(set) var isInstalled = false

    /// Indicates if a Cloudflare tunnel is currently running
    private(set) var isRunning = false

    /// The public URL for the active tunnel (e.g., "https://random-words.trycloudflare.com")
    private(set) var publicUrl: String?

    /// Error message if status check fails
    private(set) var statusError: String?

    /// Path to the cloudflared binary if found
    private(set) var cloudflaredPath: String?

    /// Flag to disable URL opening in tests
    static var isTestMode = false

    /// Currently running cloudflared process
    private var cloudflaredProcess: Process?

    /// Task for monitoring tunnel status
    private var statusMonitoringTask: Task<Void, Never>?

    /// Background tasks for monitoring output
    private var outputMonitoringTasks: [Task<Void, Never>] = []

    private init() {
        Task {
            await self.checkCloudflaredStatus()
        }
    }

    /// Checks if cloudflared CLI is installed
    func checkCLIInstallation() -> Bool {
        // Check standard paths first
        for path in Self.cloudflaredPaths where FileManager.default.fileExists(atPath: path) {
            cloudflaredPath = path
            logger.info("Found cloudflared at: \(path)")
            return true
        }

        // Try using 'which' command as fallback
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/which")
        process.arguments = ["cloudflared"]

        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = Pipe()

        do {
            try process.run()
            process.waitUntilExit()

            if process.terminationStatus == 0 {
                let data = pipe.fileHandleForReading.readDataToEndOfFile()
                if let path = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
                   !path.isEmpty
                {
                    self.cloudflaredPath = path
                    self.logger.info("Found cloudflared via 'which' at: \(path)")
                    return true
                }
            }
        } catch {
            self.logger.debug("Failed to run 'which cloudflared': \(error)")
        }

        self.logger.info("cloudflared CLI not found")
        return false
    }

    /// Checks if there's a running cloudflared Quick Tunnel process
    private func checkRunningProcess() -> Bool {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/pgrep")
        process.arguments = ["-f", "cloudflared.*tunnel.*--url"]

        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = Pipe()

        do {
            try process.run()
            process.waitUntilExit()

            if process.terminationStatus == 0 {
                let data = pipe.fileHandleForReading.readDataToEndOfFile()
                let output = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
                return !output.isNilOrEmpty
            }
        } catch {
            self.logger.debug("Failed to check running cloudflared processes: \(error)")
        }

        return false
    }

    /// Checks the current cloudflared status and updates properties
    func checkCloudflaredStatus() async {
        // First check if CLI is installed
        self.isInstalled = self.checkCLIInstallation()

        guard self.isInstalled else {
            self.isRunning = false
            self.publicUrl = nil
            self.statusError = "cloudflared is not installed"
            return
        }

        // Check if there's a running process
        let wasRunning = self.isRunning
        self.isRunning = self.checkRunningProcess()

        if self.isRunning {
            self.statusError = nil
            self.logger.info("cloudflared tunnel is running")

            // Don't clear publicUrl if we already have it
            // Only clear it if we're transitioning from running to not running
            if !wasRunning {
                // Tunnel just started, URL will be set by startQuickTunnel
                self.logger.info("Tunnel detected as running, preserving existing URL: \(self.publicUrl ?? "none")")
            }
        } else {
            // Only clear URL when tunnel is not running
            self.publicUrl = nil
            self.statusError = "No active cloudflared tunnel"
            self.logger.info("No active cloudflared tunnel found")
        }
    }

    /// Starts a Quick Tunnel using cloudflared
    func startQuickTunnel(port: Int) async throws {
        guard self.isInstalled, let binaryPath = cloudflaredPath else {
            throw CloudflareError.notInstalled
        }

        guard !self.isRunning else {
            throw CloudflareError.tunnelAlreadyRunning
        }

        self.logger.info("Starting cloudflared Quick Tunnel on port \(port)")

        let process = Process()
        process.executableURL = URL(fileURLWithPath: binaryPath)
        process.arguments = ["tunnel", "--url", "http://localhost:\(port)"]

        // Create pipes for monitoring
        let outputPipe = Pipe()
        let errorPipe = Pipe()
        process.standardOutput = outputPipe
        process.standardError = errorPipe

        do {
            try process.run()
            self.cloudflaredProcess = process

            // Immediately mark as running since process started successfully
            self.isRunning = true
            self.statusError = nil

            // Start background monitoring for URL extraction
            self.startTunnelURLMonitoring(outputPipe: outputPipe, errorPipe: errorPipe)

            // Start periodic monitoring
            self.startPeriodicMonitoring()

            self.logger.info("Cloudflare tunnel process started successfully, URL will be available shortly")
        } catch {
            // Clean up on failure
            if let process = cloudflaredProcess {
                process.terminate()
                self.cloudflaredProcess = nil
            }

            self.logger.error("Failed to start cloudflared process: \(error)")
            throw CloudflareError.tunnelCreationFailed(error.localizedDescription)
        }
    }

    /// Sends a termination signal to the cloudflared process without waiting
    /// This is used during app termination for quick cleanup
    func sendTerminationSignal() {
        self.logger.info("🚀 Quick termination signal requested")

        // Cancel monitoring tasks immediately
        self.statusMonitoringTask?.cancel()
        self.statusMonitoringTask = nil
        self.outputMonitoringTasks.forEach { $0.cancel() }
        self.outputMonitoringTasks.removeAll()

        // Send termination signal to our process if we have one
        if let process = cloudflaredProcess {
            self.logger.info("🚀 Sending SIGTERM to cloudflared process PID \(process.processIdentifier)")
            process.terminate()
            // Don't wait - let it clean up asynchronously
        }

        // Also send pkill command but don't wait for it
        let pkillProcess = Process()
        pkillProcess.executableURL = URL(fileURLWithPath: "/usr/bin/pkill")
        pkillProcess.arguments = ["-TERM", "-f", "cloudflared.*tunnel.*--url"]
        try? pkillProcess.run()
        // Don't wait for pkill to complete

        // Update state immediately
        self.isRunning = false
        self.publicUrl = nil
        self.cloudflaredProcess = nil

        self.logger.info("🚀 Quick termination signal sent")
    }

    /// Stops the running Quick Tunnel
    func stopQuickTunnel() async {
        self.logger.info("🛑 Starting cloudflared Quick Tunnel stop process")

        // Cancel monitoring tasks first
        self.statusMonitoringTask?.cancel()
        self.statusMonitoringTask = nil
        self.outputMonitoringTasks.forEach { $0.cancel() }
        self.outputMonitoringTasks.removeAll()

        // Try to terminate the process we spawned first
        if let process = cloudflaredProcess {
            self.logger.info("🛑 Found cloudflared process to terminate: PID \(process.processIdentifier)")

            // Send terminate signal
            process.terminate()

            // For normal stops, we can wait a bit
            try? await Task.sleep(nanoseconds: Self.stopTimeoutSeconds)

            // Check if it's still running and force kill if needed
            if process.isRunning {
                self.logger.warning("🛑 Process didn't terminate gracefully, sending SIGKILL")
                process.interrupt()

                // Wait for exit with timeout
                await withTaskGroup(of: Void.self) { group in
                    group.addTask {
                        process.waitUntilExit()
                    }

                    group.addTask {
                        try? await Task.sleep(nanoseconds: Self.processTerminationTimeout)
                    }

                    // Cancel remaining tasks after first one completes
                    await group.next()
                    group.cancelAll()
                }
            }
        }

        // Clean up any orphaned processes
        await self.cleanupOrphanedProcessesAsync()

        // Clean up state
        self.cloudflaredProcess = nil
        self.isRunning = false
        self.publicUrl = nil
        self.statusError = nil

        self.logger.info("🛑 Cloudflared Quick Tunnel stop completed")
    }

    /// Async version of orphaned process cleanup for normal stops
    private func cleanupOrphanedProcessesAsync() async {
        await Task.detached {
            // Run pkill in background
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/pkill")
            process.arguments = ["-f", "cloudflared.*tunnel.*--url"]

            do {
                try process.run()
                process.waitUntilExit()
            } catch {
                // Ignore errors during cleanup
            }
        }.value
    }

    /// Lightweight process check without the heavy sysctl operations
    private func quickProcessCheck() -> Bool {
        // Just check if our process reference is still valid and running
        if let process = cloudflaredProcess, process.isRunning {
            return true
        }

        // Do a quick pgrep check without heavy processing
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/pgrep")
        process.arguments = ["-f", "cloudflared.*tunnel.*--url"]

        do {
            try process.run()
            process.waitUntilExit()
            return process.terminationStatus == 0
        } catch {
            return false
        }
    }

    /// Start background monitoring for tunnel URL extraction
    private func startTunnelURLMonitoring(outputPipe: Pipe, errorPipe: Pipe) {
        // Cancel any existing monitoring tasks
        self.outputMonitoringTasks.forEach { $0.cancel() }
        self.outputMonitoringTasks.removeAll()

        // Monitor stdout using readabilityHandler
        let stdoutHandle = outputPipe.fileHandleForReading
        stdoutHandle.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            if !data.isEmpty {
                if let output = String(data: data, encoding: .utf8) {
                    Task { @MainActor in
                        await self?.processOutput(output, isError: false)
                    }
                }
            } else {
                // No more data, stop monitoring
                handle.readabilityHandler = nil
            }
        }

        // Monitor stderr using readabilityHandler
        let stderrHandle = errorPipe.fileHandleForReading
        stderrHandle.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            if !data.isEmpty {
                if let output = String(data: data, encoding: .utf8) {
                    Task { @MainActor in
                        await self?.processOutput(output, isError: true)
                    }
                }
            } else {
                // No more data, stop monitoring
                handle.readabilityHandler = nil
            }
        }

        // Store cleanup task for proper handler removal
        let cleanupTask = Task.detached { @Sendable [weak self] in
            // Wait for cancellation
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 1_000_000_000) // 1 second
            }

            // Clean up handlers when cancelled
            await MainActor.run {
                stdoutHandle.readabilityHandler = nil
                stderrHandle.readabilityHandler = nil
                self?.logger.info("🔍 Cleaned up file handle readability handlers")
            }
        }

        self.outputMonitoringTasks = [cleanupTask]
    }

    /// Process output from cloudflared (called on MainActor)
    private func processOutput(_ output: String, isError: Bool) async {
        let prefix = isError ? "cloudflared stderr" : "cloudflared output"
        self.logger.debug("\(prefix): \(output)")

        if let url = extractTunnelURL(from: output) {
            self.logger.info("🔗 Setting publicUrl to: \(url)")
            self.publicUrl = url
            self.logger.info("🔗 publicUrl is now: \(self.publicUrl ?? "nil")")
        }
    }

    /// Start periodic monitoring to check if tunnel is still running
    private func startPeriodicMonitoring() {
        self.statusMonitoringTask?.cancel()

        self.statusMonitoringTask = Task.detached { @Sendable in
            while !Task.isCancelled {
                // Check periodically if the process is still running
                try? await Task.sleep(nanoseconds: UInt64(Self.statusCheckInterval * 1_000_000_000))

                await Self.shared.checkProcessStatus()
            }
        }
    }

    /// Check if the tunnel process is still running (called on MainActor)
    private func checkProcessStatus() async {
        guard let process = cloudflaredProcess else {
            // Process is gone, update status
            self.isRunning = false
            self.publicUrl = nil
            self.statusError = "Tunnel process terminated"
            return
        }

        if !process.isRunning {
            // Process died, update status
            self.isRunning = false
            self.publicUrl = nil
            self.statusError = "Tunnel process terminated unexpectedly"
            self.cloudflaredProcess = nil
            return
        }
    }

    /// Extracts tunnel URL from cloudflared output
    private func extractTunnelURL(from output: String) -> String? {
        // More specific regex to match exactly the cloudflare tunnel URL format
        // Matches: https://subdomain.trycloudflare.com with optional trailing slash
        let pattern = #"https://[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.trycloudflare\.com/?(?:\s|$)"#

        guard let regex = try? NSRegularExpression(pattern: pattern, options: []) else {
            self.logger.error("Failed to create regex for URL extraction")
            return nil
        }

        let range = NSRange(location: 0, length: output.utf16.count)

        if let match = regex.firstMatch(in: output, options: [], range: range) {
            let urlRange = Range(match.range, in: output)
            if let urlRange {
                var url = String(output[urlRange]).trimmingCharacters(in: .whitespacesAndNewlines)
                // Remove trailing slash if present
                if url.hasSuffix("/") {
                    url = String(url.dropLast())
                }
                self.logger.info("Extracted tunnel URL: \(url)")
                return url
            }
        }

        return nil
    }

    /// Kills orphaned cloudflared tunnel processes using pkill
    /// This is a simple, reliable cleanup method for processes that may have been orphaned
    private func killOrphanedCloudflaredProcesses() {
        self.logger.info("🔍 Cleaning up orphaned cloudflared tunnel processes")

        // Use pkill to terminate any cloudflared tunnel processes
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/pkill")
        process.arguments = ["-f", "cloudflared.*tunnel.*--url"]

        do {
            try process.run()
            process.waitUntilExit()

            if process.terminationStatus == 0 {
                self.logger.info("🔍 Successfully cleaned up orphaned cloudflared processes")
            } else {
                self.logger.debug("🔍 No orphaned cloudflared processes found")
            }
        } catch {
            self.logger.error("🔍 Failed to run pkill: \(error)")
        }
    }

    /// Opens the Homebrew installation command
    func openHomebrewInstall() {
        let command = "brew install cloudflared"
        let pasteboard = NSPasteboard.general
        pasteboard.declareTypes([.string], owner: nil)
        pasteboard.setString(command, forType: .string)

        self.logger.info("Copied Homebrew install command to clipboard: \(command)")

        // Optionally open Terminal to run the command
        if !Self.isTestMode, let url = URL(string: "https://formulae.brew.sh/formula/cloudflared") {
            NSWorkspace.shared.open(url)
        }
    }

    /// Opens the direct download page
    func openDownloadPage() {
        if !Self.isTestMode, let url = URL(string: "https://github.com/cloudflare/cloudflared/releases/latest") {
            NSWorkspace.shared.open(url)
        }
    }

    /// Opens the setup guide
    func openSetupGuide() {
        if !Self.isTestMode,
           let url =
           URL(string: "https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/")
        {
            NSWorkspace.shared.open(url)
        }
    }
}

/// Cloudflare-specific errors
enum CloudflareError: LocalizedError, Equatable {
    case notInstalled
    case tunnelAlreadyRunning
    case tunnelCreationFailed(String)
    case networkError(String)
    case invalidOutput
    case processTerminated

    var errorDescription: String? {
        switch self {
        case .notInstalled:
            "cloudflared is not installed"
        case .tunnelAlreadyRunning:
            "A tunnel is already running"
        case let .tunnelCreationFailed(message):
            "Failed to create tunnel: \(message)"
        case let .networkError(message):
            "Network error: \(message)"
        case .invalidOutput:
            "Invalid output from cloudflared"
        case .processTerminated:
            "cloudflared process terminated unexpectedly"
        }
    }
}

// MARK: - String Extensions

extension String {
    fileprivate var isNilOrEmpty: Bool {
        self.isEmpty
    }
}

extension String? {
    fileprivate var isNilOrEmpty: Bool {
        self?.isEmpty ?? true
    }
}
