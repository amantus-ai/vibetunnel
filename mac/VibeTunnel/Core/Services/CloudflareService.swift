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

    /// Sends a termination signal to the cloudflared process without waiting
    /// This is used during app termination for quick cleanup
    func sendTerminationSignal() {
        logger.info("🚀 Quick termination signal requested")
        
        // Cancel monitoring tasks immediately
        statusMonitoringTask?.cancel()
        statusMonitoringTask = nil
        outputMonitoringTasks.forEach { $0.cancel() }
        outputMonitoringTasks.removeAll()
        
        // Send termination signal to our process if we have one
        if let process = cloudflaredProcess {
            logger.info("🚀 Sending SIGTERM to cloudflared process PID \(process.processIdentifier)")
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
        isRunning = false
        publicUrl = nil
        cloudflaredProcess = nil
        
        logger.info("🚀 Quick termination signal sent")
    }

    /// Stops the running Quick Tunnel
    func stopQuickTunnel() async {
        logger.info("🛑 Starting cloudflared Quick Tunnel stop process")
        
        // Cancel monitoring tasks first
        statusMonitoringTask?.cancel()
        statusMonitoringTask = nil
        outputMonitoringTasks.forEach { $0.cancel() }
        outputMonitoringTasks.removeAll()

        // Try to terminate the process we spawned first
        if let process = cloudflaredProcess {
            logger.info("🛑 Found cloudflared process to terminate: PID \(process.processIdentifier)")
            
            // Send terminate signal
            process.terminate()
            
            // For normal stops, we can wait a bit
            try? await Task.sleep(nanoseconds: 500_000_000) // 0.5 seconds
            
            // Check if it's still running and force kill if needed
            if process.isRunning {
                logger.warning("🛑 Process didn't terminate gracefully, sending SIGKILL")
                process.interrupt()
                
                // Wait for exit with timeout
                await withTaskGroup(of: Void.self) { group in
                    group.addTask {
                        process.waitUntilExit()
                    }
                    
                    group.addTask {
                        try? await Task.sleep(nanoseconds: 2_000_000_000) // 2 second timeout
                    }
                    
                    // Cancel remaining tasks after first one completes
                    await group.next()
                    group.cancelAll()
                }
            }
        }

        // Clean up any orphaned processes
        await cleanupOrphanedProcessesAsync()

        // Clean up state
        cloudflaredProcess = nil
        isRunning = false
        publicUrl = nil
        statusError = nil
        
        logger.info("🛑 Cloudflared Quick Tunnel stop completed")
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

    /// Kills orphaned cloudflared tunnel processes using system-level process management
    /// This is a fallback cleanup method that handles cases where the Process reference was lost
    private func killOrphanedCloudflaredProcesses() {
        logger.info("🔍 ENHANCED DEBUG: Searching for orphaned cloudflared tunnel processes")
        
        // Find all cloudflared tunnel processes
        let searchStartTime = Date()
        let tunnelProcesses = findCloudflaredTunnelProcesses()
        let searchElapsed = Date().timeIntervalSince(searchStartTime)
        
        logger.info("🔍 Process search completed in \(searchElapsed)s, found \(tunnelProcesses.count) processes")
        
        var killedCount = 0
        for process in tunnelProcesses {
            logger.info("🔍 Found orphaned cloudflared tunnel process: PID \(process)")
            
            let killStartTime = Date()
            if killProcess(pid: process) {
                killedCount += 1
                let killElapsed = Date().timeIntervalSince(killStartTime)
                logger.info("🔍 Successfully killed orphaned cloudflared process PID \(process) in \(killElapsed)s")
            } else {
                let killElapsed = Date().timeIntervalSince(killStartTime)
                logger.warning("🔍 Failed to kill orphaned cloudflared process PID \(process) after \(killElapsed)s")
            }
        }
        
        // Always try system command as fallback (more reliable)
        logger.error("🔍 Trying system command fallback: pkill -f 'cloudflared.*tunnel.*--url'")
        let pkillResult = runSystemPkill()
        logger.error("🔍 pkill result: \(pkillResult) (0 = success/processes killed, 1 = no processes found)")
        
        if killedCount > 0 {
            logger.error("🔍 Killed \(killedCount) orphaned cloudflared tunnel process(es) via Swift + system command")
        } else if pkillResult == 0 {
            logger.error("🔍 No processes killed via Swift, but system command succeeded")
        } else {
            logger.error("🔍 No orphaned cloudflared tunnel processes found by either method")
        }
    }
    
    /// Find all running cloudflared tunnel processes
    private func findCloudflaredTunnelProcesses() -> [Int32] {
        var processes: [Int32] = []
        
        logger.info("🔍 Getting all running processes")
        let allProcesses = getAllProcesses()
        logger.info("🔍 Scanning \(allProcesses.count) total processes for cloudflared")
        
        var candidateCount = 0
        for process in allProcesses {
            // Look for cloudflared processes
            if process.path.contains("cloudflared") {
                candidateCount += 1
                logger.info("🔍 Found cloudflared binary: PID \(process.pid) at \(process.path)")
                
                // Check if it's a tunnel process by examining arguments
                if hasCloudflaredTunnelArguments(pid: process.pid) {
                    processes.append(process.pid)
                    logger.info("🔍 ✅ PID \(process.pid) is a tunnel process")
                } else {
                    logger.info("🔍 ❌ PID \(process.pid) is not a tunnel process")
                }
            }
        }
        
        logger.info("🔍 Found \(candidateCount) cloudflared processes, \(processes.count) are tunnel processes")
        return processes
    }
    
    /// Get all running processes with their paths
    private func getAllProcesses() -> [(pid: Int32, path: String)] {
        var processes: [(pid: Int32, path: String)] = []
        
        // Set up the mib (Management Information Base) for getting all processes
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_ALL, 0]
        
        // Get process list size
        var size: size_t = 0
        if sysctl(&mib, 4, nil, &size, nil, 0) != 0 {
            logger.error("Failed to get process list size")
            return processes
        }
        
        // Allocate memory for process list
        let count = size / MemoryLayout<kinfo_proc>.size
        var procList = [kinfo_proc](repeating: kinfo_proc(), count: count)
        size = procList.count * MemoryLayout<kinfo_proc>.size
        
        // Get process list
        if sysctl(&mib, 4, &procList, &size, nil, 0) != 0 {
            logger.error("Failed to get process list")
            return processes
        }
        
        // Extract process information
        let actualCount = size / MemoryLayout<kinfo_proc>.size
        for i in 0..<actualCount {
            let proc = procList[i]
            let pid = proc.kp_proc.p_pid
            
            // Get process path
            var pathBuffer = [CChar](repeating: 0, count: Int(MAXPATHLEN))
            let pathSize = UInt32(MAXPATHLEN)
            
            if proc_pidpath(pid, &pathBuffer, pathSize) > 0 {
                pathBuffer.withUnsafeBufferPointer { buffer in
                    if let baseAddress = buffer.baseAddress,
                       let path = String(validatingCString: baseAddress) {
                        processes.append((pid: pid, path: path))
                    }
                }
            }
        }
        
        return processes
    }
    
    /// Check if a process has cloudflared tunnel arguments
    private func hasCloudflaredTunnelArguments(pid: Int32) -> Bool {
        // Get process arguments using sysctl
        var mib: [Int32] = [CTL_KERN, KERN_PROCARGS2, pid]
        var argmax: Int = 0
        var size = MemoryLayout<Int>.size
        
        // Get the maximum argument size
        if sysctl(&mib, 3, &argmax, &size, nil, 0) == -1 {
            return false
        }
        
        // Allocate memory for arguments
        var procargs = [CChar](repeating: 0, count: argmax)
        size = argmax
        
        // Get the arguments
        if sysctl(&mib, 3, &procargs, &size, nil, 0) == -1 {
            return false
        }
        
        // Convert to string and check for tunnel arguments
        let argsString = procargs.withUnsafeBufferPointer { buffer in
            if let baseAddress = buffer.baseAddress {
                return String(validatingCString: baseAddress) ?? ""
            }
            return ""
        }
        
        // Check for cloudflared tunnel with --url argument
        return argsString.contains("tunnel") && argsString.contains("--url")
    }
    
    /// Kill a process by PID using the same approach as ProcessKiller
    private func killProcess(pid: Int32) -> Bool {
        logger.info("🔥 Attempting to kill cloudflared process PID \(pid)")
        
        // First check if we can signal the process
        if kill(pid, 0) != 0 {
            if errno == ESRCH {
                // Process doesn't exist, consider it a success
                logger.info("🔥 Process \(pid) doesn't exist (ESRCH), considering it killed")
                return true
            } else if errno == EPERM {
                logger.error("🔥 No permission to kill cloudflared process \(pid) (EPERM)")
                return false
            } else {
                logger.error("🔥 Failed to probe process \(pid), errno: \(errno)")
                return false
            }
        }
        
        logger.info("🔥 Process \(pid) exists and is accessible, proceeding with kill")
        
        // Try SIGTERM first for graceful shutdown
        if kill(pid, SIGTERM) == 0 {
            logger.info("🔥 Sent SIGTERM to cloudflared process \(pid)")
            
            // Give it a moment to terminate gracefully
            Thread.sleep(forTimeInterval: 1.0)
            
            // Check if it's still running
            if kill(pid, 0) == 0 {
                // Still running, use SIGKILL
                logger.warning("🔥 Process \(pid) still running after SIGTERM, sending SIGKILL")
                if kill(pid, SIGKILL) == 0 {
                    logger.info("🔥 Forcefully killed cloudflared process \(pid) with SIGKILL")
                    return true
                } else {
                    logger.error("🔥 Failed to send SIGKILL to process \(pid), errno: \(errno)")
                    return false
                }
            } else {
                // Process died from SIGTERM
                logger.info("🔥 Cloudflared process \(pid) terminated gracefully from SIGTERM")
                return true
            }
        } else {
            logger.warning("🔥 Failed to send SIGTERM to process \(pid), errno: \(errno)")
        }
        
        // If SIGTERM failed, try SIGKILL directly
        logger.info("🔥 Attempting direct SIGKILL on process \(pid)")
        if kill(pid, SIGKILL) == 0 {
            logger.info("🔥 Forcefully killed cloudflared process \(pid) with SIGKILL")
            return true
        } else {
            logger.error("🔥 Failed to kill cloudflared process \(pid) with SIGKILL, errno: \(errno)")
            return false
        }
    }

    /// Debug method to test orphaned process detection separately
    /// This can be called manually to test the process detection logic
    func debugOrphanedProcessDetection() {
        logger.info("🧪 DEBUG: Manual orphaned process detection test")
        killOrphanedCloudflaredProcesses()
    }
    
    /// Run system pkill command using Process instead of system()
    private func runSystemPkill() -> Int32 {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/pkill")
        process.arguments = ["-f", "cloudflared.*tunnel.*--url"]
        
        do {
            try process.run()
            process.waitUntilExit()
            return process.terminationStatus
        } catch {
            logger.error("🔍 Failed to run pkill: \(error)")
            return -1
        }
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