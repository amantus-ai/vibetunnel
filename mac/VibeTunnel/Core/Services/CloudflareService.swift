import AppKit
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
        "/usr/bin/cloudflared"
    ]

    /// Logger instance for debugging
    private let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "CloudflareService")

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

    /// Currently running cloudflared process
    private var cloudflaredProcess: Process?

    /// Task for monitoring tunnel status
    private var statusMonitoringTask: Task<Void, Never>?
    
    /// Background tasks for monitoring output
    private var outputMonitoringTasks: [Task<Void, Never>] = []

    private init() {
        Task {
            await checkCloudflaredStatus()
        }
    }

    /// Checks if cloudflared CLI is installed
    func checkCLIInstallation() -> Bool {
        // Check standard paths first
        for path in Self.cloudflaredPaths {
            if FileManager.default.fileExists(atPath: path) {
                cloudflaredPath = path
                logger.info("Found cloudflared at: \(path)")
                return true
            }
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
                   !path.isEmpty {
                    cloudflaredPath = path
                    logger.info("Found cloudflared via 'which' at: \(path)")
                    return true
                }
            }
        } catch {
            logger.debug("Failed to run 'which cloudflared': \(error)")
        }

        logger.info("cloudflared CLI not found")
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
            logger.debug("Failed to check running cloudflared processes: \(error)")
        }

        return false
    }

    /// Checks the current cloudflared status and updates properties
    func checkCloudflaredStatus() async {
        // First check if CLI is installed
        isInstalled = checkCLIInstallation()

        guard isInstalled else {
            isRunning = false
            publicUrl = nil
            statusError = "cloudflared is not installed"
            return
        }

        // Check if there's a running process
        let wasRunning = isRunning
        isRunning = checkRunningProcess()

        if isRunning {
            statusError = nil
            logger.info("cloudflared tunnel is running")
            
            // Don't clear publicUrl if we already have it
            // Only clear it if we're transitioning from running to not running
            if !wasRunning {
                // Tunnel just started, URL will be set by startQuickTunnel
                logger.info("Tunnel detected as running, preserving existing URL: \(self.publicUrl ?? "none")")
            }
        } else {
            // Only clear URL when tunnel is not running
            publicUrl = nil
            statusError = "No active cloudflared tunnel"
            logger.info("No active cloudflared tunnel found")
        }
    }

    /// Starts a Quick Tunnel using cloudflared
    func startQuickTunnel(port: Int = 4020) async throws {
        guard isInstalled, let binaryPath = cloudflaredPath else {
            throw CloudflareError.notInstalled
        }

        guard !isRunning else {
            throw CloudflareError.tunnelAlreadyRunning
        }

        logger.info("Starting cloudflared Quick Tunnel on port \(port)")

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
            cloudflaredProcess = process
            
            // Immediately mark as running since process started successfully
            isRunning = true
            statusError = nil
            
            // Start background monitoring for URL extraction
            startTunnelURLMonitoring(outputPipe: outputPipe, errorPipe: errorPipe)
            
            // Start periodic monitoring
            startPeriodicMonitoring()
            
            logger.info("Cloudflare tunnel process started successfully, URL will be available shortly")
            
        } catch {
            // Clean up on failure
            if let process = cloudflaredProcess {
                process.terminate()
                cloudflaredProcess = nil
            }
            
            logger.error("Failed to start cloudflared process: \(error)")
            throw CloudflareError.tunnelCreationFailed(error.localizedDescription)
        }
    }

    /// Stops the running Quick Tunnel
    func stopQuickTunnel() async {
        guard let process = cloudflaredProcess else {
            logger.warning("No cloudflared process to stop")
            // Still clean up state in case it's out of sync
            isRunning = false
            publicUrl = nil
            statusError = nil
            return
        }

        logger.info("Stopping cloudflared Quick Tunnel")

        // Cancel monitoring tasks first
        statusMonitoringTask?.cancel()
        statusMonitoringTask = nil
        
        // Cancel output monitoring tasks
        outputMonitoringTasks.forEach { $0.cancel() }
        outputMonitoringTasks.removeAll()

        // Terminate process
        process.terminate()
        
        // Give it a moment to terminate gracefully
        try? await Task.sleep(nanoseconds: 500_000_000) // 0.5 seconds
        
        // Force kill if still running
        if process.isRunning {
            logger.warning("Process didn't terminate gracefully, sending SIGKILL")
            process.interrupt()
        }
        
        // Wait for process to exit
        process.waitUntilExit()

        // Clean up state
        cloudflaredProcess = nil
        isRunning = false
        publicUrl = nil
        statusError = nil
        
        logger.info("Cloudflared Quick Tunnel stopped successfully")
    }

    /// Start background monitoring for tunnel URL extraction
    private func startTunnelURLMonitoring(outputPipe: Pipe, errorPipe: Pipe) {
        // Cancel any existing monitoring tasks
        outputMonitoringTasks.forEach { $0.cancel() }
        outputMonitoringTasks.removeAll()
        
        // Monitor stdout in background
        let stdoutTask = Task.detached { @Sendable in
            let handle = outputPipe.fileHandleForReading
            await CloudflareService.shared.processOutput("🔍 Started monitoring stdout", isError: false)
            
            // Use availableData approach with polling
            while !Task.isCancelled {
                let data = handle.availableData
                if !data.isEmpty {
                    if let output = String(data: data, encoding: .utf8) {
                        await CloudflareService.shared.processOutput(output, isError: false)
                    }
                }
                // Short sleep to prevent busy waiting
                try? await Task.sleep(nanoseconds: 100_000_000) // 0.1 seconds
            }
            await CloudflareService.shared.processOutput("🔍 Stopped monitoring stdout", isError: false)
        }
        
        // Monitor stderr in background
        let stderrTask = Task.detached { @Sendable in
            let handle = errorPipe.fileHandleForReading
            await CloudflareService.shared.processOutput("🔍 Started monitoring stderr", isError: true)
            
            // Use availableData approach with polling
            while !Task.isCancelled {
                let data = handle.availableData
                if !data.isEmpty {
                    if let output = String(data: data, encoding: .utf8) {
                        await CloudflareService.shared.processOutput(output, isError: true)
                    }
                }
                // Short sleep to prevent busy waiting
                try? await Task.sleep(nanoseconds: 100_000_000) // 0.1 seconds
            }
            await CloudflareService.shared.processOutput("🔍 Stopped monitoring stderr", isError: true)
        }
        
        // Store tasks for cancellation
        outputMonitoringTasks = [stdoutTask, stderrTask]
    }
    
    /// Process output from cloudflared (called on MainActor)
    private func processOutput(_ output: String, isError: Bool) async {
        let prefix = isError ? "cloudflared stderr" : "cloudflared output"
        logger.debug("\(prefix): \(output)")
        
        if let url = extractTunnelURL(from: output) {
            logger.info("🔗 Setting publicUrl to: \(url)")
            self.publicUrl = url
            logger.info("🔗 publicUrl is now: \(self.publicUrl ?? "nil")")
        }
    }

    /// Start periodic monitoring to check if tunnel is still running
    private func startPeriodicMonitoring() {
        statusMonitoringTask?.cancel()
        
        statusMonitoringTask = Task.detached { @Sendable in
            while !Task.isCancelled {
                // Check every 5 seconds if the process is still running
                try? await Task.sleep(nanoseconds: 5_000_000_000) // 5 seconds
                
                await CloudflareService.shared.checkProcessStatus()
            }
        }
    }
    
    /// Check if the tunnel process is still running (called on MainActor)
    private func checkProcessStatus() async {
        guard let process = cloudflaredProcess else {
            // Process is gone, update status
            isRunning = false
            publicUrl = nil
            statusError = "Tunnel process terminated"
            return
        }
        
        if !process.isRunning {
            // Process died, update status
            isRunning = false
            publicUrl = nil
            statusError = "Tunnel process terminated unexpectedly"
            cloudflaredProcess = nil
            return
        }
    }

    /// Extracts tunnel URL from cloudflared output
    private func extractTunnelURL(from output: String) -> String? {
        // Look for https://something.trycloudflare.com URLs
        let pattern = "https://[a-zA-Z0-9-]+\\.trycloudflare\\.com"
        let regex = try? NSRegularExpression(pattern: pattern, options: [])
        let range = NSRange(location: 0, length: output.count)
        
        if let match = regex?.firstMatch(in: output, options: [], range: range) {
            let urlRange = Range(match.range, in: output)
            if let urlRange = urlRange {
                let url = String(output[urlRange])
                logger.info("Extracted tunnel URL: \(url)")
                return url
            }
        }
        
        return nil
    }



    /// Opens the Homebrew installation command
    func openHomebrewInstall() {
        let command = "brew install cloudflared"
        let pasteboard = NSPasteboard.general
        pasteboard.declareTypes([.string], owner: nil)
        pasteboard.setString(command, forType: .string)
        
        logger.info("Copied Homebrew install command to clipboard: \(command)")
        
        // Optionally open Terminal to run the command
        if let url = URL(string: "https://formulae.brew.sh/formula/cloudflared") {
            NSWorkspace.shared.open(url)
        }
    }

    /// Opens the direct download page
    func openDownloadPage() {
        if let url = URL(string: "https://github.com/cloudflare/cloudflared/releases/latest") {
            NSWorkspace.shared.open(url)
        }
    }

    /// Opens the setup guide
    func openSetupGuide() {
        if let url = URL(string: "https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/") {
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
            return "cloudflared is not installed"
        case .tunnelAlreadyRunning:
            return "A tunnel is already running"
        case .tunnelCreationFailed(let message):
            return "Failed to create tunnel: \(message)"
        case .networkError(let message):
            return "Network error: \(message)"
        case .invalidOutput:
            return "Invalid output from cloudflared"
        case .processTerminated:
            return "cloudflared process terminated unexpectedly"
        }
    }
}

// MARK: - String Extensions

private extension String {
    var isNilOrEmpty: Bool {
        return self.isEmpty
    }
}

private extension Optional where Wrapped == String {
    var isNilOrEmpty: Bool {
        return self?.isEmpty ?? true
    }
}