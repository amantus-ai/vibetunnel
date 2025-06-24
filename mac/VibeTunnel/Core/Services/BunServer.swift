import Foundation
import OSLog

/// Server state enumeration
enum ServerState {
    case idle
    case starting
    case running
    case stopping
    case crashed
}

/// Bun vibetunnel server implementation.
///
/// Manages the Bun-based vibetunnel server as a subprocess. This implementation
/// provides JavaScript/TypeScript-based terminal multiplexing by leveraging the Bun
/// runtime. It handles process lifecycle, log streaming, and error recovery.
@MainActor
final class BunServer {
    /// Callback when the server crashes unexpectedly
    var onCrash: ((Int32) -> Void)?

    // MARK: - Properties

    private var process: Process?
    private var stdoutPipe: Pipe?
    private var stderrPipe: Pipe?
    private var outputTask: Task<Void, Never>?
    private var errorTask: Task<Void, Never>?

    /// Server state machine - thread-safe through MainActor
    private var state: ServerState = .idle

    /// Resource cleanup tracking
    private var isCleaningUp = false

    private let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "BunServer")
    private let serverOutput = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "ServerOutput")

    var isRunning: Bool {
        state == .running
    }

    var port: String = ""

    var bindAddress: String = "127.0.0.1"

    // MARK: - Initialization

    init() {
        // No need for log streams anymore
    }

    // MARK: - Public Methods

    func start() async throws {
        // Update state atomically using MainActor
        let currentState = state
        if currentState == .running || currentState == .starting {
            logger.warning("Bun server already running or starting")
            return
        }
        if currentState == .stopping {
            logger.warning("Cannot start server while stopping")
            throw BunServerError.invalidState
        }
        state = .starting

        defer {
            // Ensure we reset state on error
            if state == .starting {
                state = .idle
            }
        }

        guard !port.isEmpty else {
            let error = BunServerError.invalidPort
            logger.error("Port not configured")
            throw error
        }

        logger.info("Starting Bun vibetunnel server on port \(self.port)")

        // Get the vibetunnel binary path (the Bun executable)
        guard let binaryPath = Bundle.main.path(forResource: "vibetunnel", ofType: nil) else {
            let error = BunServerError.binaryNotFound
            logger.error("vibetunnel binary not found in bundle")
            throw error
        }

        logger.info("Using Bun executable at: \(binaryPath)")

        // Ensure binary is executable
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: binaryPath)

        // Verify binary exists and is executable
        var isDirectory: ObjCBool = false
        let fileExists = FileManager.default.fileExists(atPath: binaryPath, isDirectory: &isDirectory)
        if fileExists && !isDirectory.boolValue {
            let attributes = try FileManager.default.attributesOfItem(atPath: binaryPath)
            if let permissions = attributes[.posixPermissions] as? NSNumber,
               let fileSize = attributes[.size] as? NSNumber
            {
                logger
                    .info(
                        "vibetunnel binary size: \(fileSize.intValue) bytes, permissions: \(String(permissions.intValue, radix: 8))"
                    )
            }
        } else if !fileExists {
            logger.error("vibetunnel binary NOT FOUND at: \(binaryPath)")
        }

        // Create the process using login shell
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")

        // Get the Resources directory path
        let resourcesPath = Bundle.main.resourcePath ?? Bundle.main.bundlePath

        // Set working directory to Resources/web directory where public folder is located
        let webPath = URL(fileURLWithPath: resourcesPath).appendingPathComponent("web").path
        process.currentDirectoryURL = URL(fileURLWithPath: webPath)
        logger.info("Process working directory: \(webPath)")

        // Static files are always at Resources/web/public
        let staticPath = URL(fileURLWithPath: resourcesPath).appendingPathComponent("web/public").path

        // Verify the web directory exists
        if !FileManager.default.fileExists(atPath: staticPath) {
            logger.error("Web directory not found at expected location: \(staticPath)")
        }

        // Build the vibetunnel command with all arguments
        var vibetunnelArgs = "--port \(port) --bind \(bindAddress)"

        // Add authentication flags based on configuration
        let authMode = UserDefaults.standard.string(forKey: "authenticationMode") ?? "os"
        logger.info("Configuring authentication mode: \(authMode)")

        switch authMode {
        case "none":
            vibetunnelArgs += " --no-auth"
        case "ssh":
            vibetunnelArgs += " --enable-ssh-keys --disallow-user-password"
        case "both":
            vibetunnelArgs += " --enable-ssh-keys"
        case "os":
            fallthrough
        default:
            // OS authentication is the default, no special flags needed
            break
        }
        
        // Add local bypass authentication for the Mac app
        if authMode != "none" {
            // Enable local bypass without requiring token for browser access
            vibetunnelArgs += " --allow-local-bypass"
            logger.info("Local authentication bypass enabled for localhost connections")
        }

        // Create wrapper to run vibetunnel with a parent death signal
        // Using a subshell that monitors parent process and kills vibetunnel if parent dies
        let parentPid = ProcessInfo.processInfo.processIdentifier
        let vibetunnelCommand = """
        # Start vibetunnel in background
        \(binaryPath) \(vibetunnelArgs) &
        VIBETUNNEL_PID=$!

        # Monitor parent process
        while kill -0 \(parentPid) 2>/dev/null; do
            sleep 1
        done

        # Parent died, kill vibetunnel
        kill -TERM $VIBETUNNEL_PID 2>/dev/null
        wait $VIBETUNNEL_PID
        """
        process.arguments = ["-l", "-c", vibetunnelCommand]

        logger.info("Executing command: /bin/zsh -l -c \"\(vibetunnelCommand)\"")
        logger.info("Binary location: \(resourcesPath)")

        // Set up environment - login shell will load the rest
        let environment = ProcessInfo.processInfo.environment
        process.environment = environment

        // Set up pipes for stdout and stderr
        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()
        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe

        self.process = process
        self.stdoutPipe = stdoutPipe
        self.stderrPipe = stderrPipe

        // Start monitoring output
        startOutputMonitoring()

        do {
            // Start the process (this just launches it and returns immediately)
            try await process.runAsync()

            logger.info("Bun server process started")

            // Give the process a moment to start before checking for early failures
            try await Task.sleep(for: .milliseconds(100))

            // Check if process exited immediately (indicating failure)
            if !process.isRunning {
                let exitCode = process.terminationStatus

                // Special handling for exit code 9 (port in use)
                if exitCode == 9 {
                    logger.error("Process exited immediately: Port \(self.port) is already in use (exit code: 9)")
                } else {
                    logger.error("Process exited immediately with code: \(exitCode)")
                }

                // Try to read any error output
                var errorDetails = "Exit code: \(exitCode)"
                if let stderrPipe = self.stderrPipe {
                    let errorData = stderrPipe.fileHandleForReading.availableData
                    if !errorData.isEmpty, let errorOutput = String(data: errorData, encoding: .utf8) {
                        errorDetails += "\nError: \(errorOutput.trimmingCharacters(in: .whitespacesAndNewlines))"
                    }
                }

                logger.error("Server failed to start: \(errorDetails)")
                throw BunServerError.processFailedToStart
            }

            // Mark server as running only after successful start
            state = .running

            logger.info("Bun server process started successfully")

            // Monitor process termination
            Task {
                await monitorProcessTermination()
            }
        } catch {
            // Log more detailed error information
            let errorMessage: String = if let bunError = error as? BunServerError {
                bunError.localizedDescription
            } else if let urlError = error as? URLError {
                "Network error: \(urlError.localizedDescription) (Code: \(urlError.code.rawValue))"
            } else if let posixError = error as? POSIXError {
                "System error: \(posixError.localizedDescription) (Code: \(posixError.code.rawValue))"
            } else {
                error.localizedDescription
            }

            logger.error("Failed to start Bun server: \(errorMessage)")
            throw error
        }
    }

    func stop() async {
        // Update state atomically using MainActor
        switch state {
        case .running, .crashed:
            break // Continue with stop
        default:
            logger.warning("Bun server not running (state: \(String(describing: self.state)))")
            return
        }

        // Prevent concurrent cleanup
        if isCleaningUp {
            logger.warning("Already cleaning up server")
            return
        }

        state = .stopping
        isCleaningUp = true

        defer {
            state = .idle
            isCleaningUp = false
        }

        guard let process else {
            logger.warning("No process to stop")
            await performCleanup()
            return
        }

        logger.info("Stopping Bun server")

        // Cancel output monitoring tasks
        outputTask?.cancel()
        errorTask?.cancel()

        // Close pipes to trigger EOF in monitors
        if let pipe = self.stdoutPipe {
            try? pipe.fileHandleForReading.close()
        }
        if let pipe = self.stderrPipe {
            try? pipe.fileHandleForReading.close()
        }

        // Give tasks a moment to complete
        try? await Task.sleep(for: .milliseconds(100))

        // Terminate the process
        await process.terminateAsync()

        // Wait for process to terminate (with timeout)
        let terminated = await process.waitUntilExitWithTimeout(seconds: 5)

        if !terminated {
            // Force kill if termination timeout
            process.interrupt()
            logger.warning("Force killed Bun server after timeout")
        }

        // Clean up
        await performCleanup()

        logger.info("Bun server stopped")
    }

    func restart() async throws {
        logger.info("Restarting Bun server")
        await stop()
        try await start()
    }

    func checkHealth() async -> Bool {
        guard let process else { return false }
        return process.isRunning
    }

    func getStaticFilesPath() -> String? {
        guard let resourcesPath = Bundle.main.resourcePath else { return nil }
        return URL(fileURLWithPath: resourcesPath).appendingPathComponent("web/public").path
    }

    func cleanup() async {
        await stop()
    }

    /// Get current server state
    func getState() -> ServerState {
        state
    }

    // MARK: - Private Methods

    /// Perform cleanup of all resources
    private func performCleanup() async {
        self.process = nil
        self.stdoutPipe = nil
        self.stderrPipe = nil
        self.outputTask = nil
        self.errorTask = nil
    }

    private func startOutputMonitoring() {
        // Capture pipes and port before starting detached tasks
        guard let stdoutPipe = self.stdoutPipe,
              let stderrPipe = self.stderrPipe
        else {
            logger.warning("No pipes available for monitoring")
            return
        }

        let currentPort = self.port

        // Create a sendable reference for logging
        let logHandler = LogHandler()

        // Monitor stdout on background thread with DispatchSource
        outputTask = Task.detached { [logHandler] in
            let pipe = stdoutPipe

            let handle = pipe.fileHandleForReading
            let source = DispatchSource.makeReadSource(fileDescriptor: handle.fileDescriptor)

            let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "BunServer")
            logger.debug("Starting stdout monitoring for Bun server on port \(currentPort)")

            // Create a cancellation handler
            let cancelSource = {
                source.cancel()
                try? handle.close()
            }

            source.setEventHandler { [logHandler] in
                let data = handle.availableData
                if data.isEmpty {
                    // EOF reached
                    cancelSource()
                    return
                }

                if let output = String(data: data, encoding: .utf8) {
                    let lines = output.trimmingCharacters(in: .whitespacesAndNewlines)
                        .components(separatedBy: .newlines)
                    for line in lines where !line.isEmpty {
                        // Skip shell initialization messages
                        if line.contains("zsh:") || line.hasPrefix("Last login:") {
                            continue
                        }

                        // Log to OSLog with appropriate level
                        logHandler.log(line, isError: false)
                    }
                }
            }

            source.setCancelHandler {
                logger.debug("Stopped stdout monitoring for Bun server")
            }

            source.activate()

            // Keep the task alive until cancelled
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(100))
            }

            cancelSource()
        }

        // Monitor stderr on background thread with DispatchSource
        errorTask = Task.detached { [logHandler] in
            let pipe = stderrPipe

            let handle = pipe.fileHandleForReading
            let source = DispatchSource.makeReadSource(fileDescriptor: handle.fileDescriptor)

            let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "BunServer")
            logger.debug("Starting stderr monitoring for Bun server on port \(currentPort)")

            // Create a cancellation handler
            let cancelSource = {
                source.cancel()
                try? handle.close()
            }

            source.setEventHandler { [logHandler] in
                let data = handle.availableData
                if data.isEmpty {
                    // EOF reached
                    cancelSource()
                    return
                }

                if let output = String(data: data, encoding: .utf8) {
                    let lines = output.trimmingCharacters(in: .whitespacesAndNewlines)
                        .components(separatedBy: .newlines)
                    for line in lines where !line.isEmpty {
                        // Log stderr as errors/warnings
                        logHandler.log(line, isError: true)
                    }
                }
            }

            source.setCancelHandler {
                logger.debug("Stopped stderr monitoring for Bun server")
            }

            source.activate()

            // Keep the task alive until cancelled
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(100))
            }

            cancelSource()
        }
    }

    private func logServerOutput(_ line: String, isError: Bool) {
        let lowercased = line.lowercased()

        if isError || lowercased.contains("error") || lowercased.contains("failed") || lowercased.contains("fatal") {
            serverOutput.error("\(line, privacy: .public)")
        } else if lowercased.contains("warn") || lowercased.contains("warning") {
            serverOutput.warning("\(line, privacy: .public)")
        } else if lowercased.contains("debug") || lowercased.contains("verbose") {
            serverOutput.debug("\(line, privacy: .public)")
        } else {
            serverOutput.info("\(line, privacy: .public)")
        }
    }

    private func withTimeoutOrNil<T: Sendable>(
        seconds: TimeInterval,
        operation: @escaping @Sendable () async -> T
    )
        async -> T?
    {
        await withTaskGroup(of: T?.self) { group in
            group.addTask {
                await operation()
            }

            group.addTask {
                try? await Task.sleep(for: .seconds(seconds))
                return nil
            }

            for await result in group {
                group.cancelAll()
                return result
            }

            return nil
        }
    }

    private func monitorProcessTermination() async {
        guard let process else { return }

        // Wait for process exit
        await process.waitUntilExitAsync()

        let exitCode = process.terminationStatus

        // Check current state
        let currentState = state
        let wasRunning = currentState == .running
        if wasRunning {
            state = .crashed
        }

        if wasRunning {
            // Unexpected termination
            self.logger.error("Bun server terminated unexpectedly with exit code: \(exitCode)")

            // Clean up process reference
            self.process = nil

            // Notify about the crash
            if let onCrash = self.onCrash {
                self.logger.info("Notifying ServerManager about server crash")
                onCrash(exitCode)
            }
        } else {
            // Normal termination
            self.logger.info("Bun server terminated normally with exit code: \(exitCode)")
        }
    }

    // MARK: - Utilities
}

// MARK: - Errors

enum BunServerError: LocalizedError {
    case binaryNotFound
    case processFailedToStart
    case invalidPort
    case invalidState

    var errorDescription: String? {
        switch self {
        case .binaryNotFound:
            "The vibetunnel binary was not found in the app bundle"
        case .processFailedToStart:
            "The server process failed to start"
        case .invalidPort:
            "Server port is not configured"
        case .invalidState:
            "Server is in an invalid state for this operation"
        }
    }
}

// MARK: - Process Extensions

extension Process {
    /// Run the process asynchronously
    func runAsync() async throws {
        try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    try self.run()
                    continuation.resume()
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    /// Wait for the process to exit asynchronously
    func waitUntilExitAsync() async {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                self.waitUntilExit()
                continuation.resume()
            }
        }
    }

    /// Terminate the process asynchronously
    func terminateAsync() async {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                if self.isRunning {
                    self.terminate()
                }
                continuation.resume()
            }
        }
    }

    /// Wait for exit with timeout
    func waitUntilExitWithTimeout(seconds: TimeInterval) async -> Bool {
        await withTaskGroup(of: Bool.self) { group in
            group.addTask {
                await self.waitUntilExitAsync()
                return true
            }

            group.addTask {
                try? await Task.sleep(for: .seconds(seconds))
                return false
            }

            for await result in group {
                group.cancelAll()
                return result
            }

            return false
        }
    }
}

// MARK: - LogHandler

/// A sendable log handler for use in detached tasks
private final class LogHandler: Sendable {
    private let serverOutput = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "ServerOutput")

    func log(_ line: String, isError: Bool) {
        let lowercased = line.lowercased()

        if isError || lowercased.contains("error") || lowercased.contains("failed") || lowercased.contains("fatal") {
            serverOutput.error("\(line, privacy: .public)")
        } else if lowercased.contains("warn") || lowercased.contains("warning") {
            serverOutput.warning("\(line, privacy: .public)")
        } else if lowercased.contains("debug") || lowercased.contains("verbose") {
            serverOutput.debug("\(line, privacy: .public)")
        } else {
            serverOutput.info("\(line, privacy: .public)")
        }
    }
}
