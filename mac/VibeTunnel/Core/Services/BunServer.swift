import CryptoKit
import Darwin
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

    private let logger = Logger(subsystem: BundleIdentifiers.loggerSubsystem, category: "BunServer")
    private let serverOutput = Logger(subsystem: BundleIdentifiers.loggerSubsystem, category: "ServerOutput")

    var isRunning: Bool {
        state == .running
    }

    var port: String = ""

    var bindAddress: String = "127.0.0.1"

    /// The process identifier of the running server, if available
    var processIdentifier: Int32? {
        process?.processIdentifier
    }

    /// Local authentication token for bypassing auth on localhost
    private let localAuthToken: String = {
        // Generate a secure random token for this session
        let randomData = Data((0..<32).map { _ in UInt8.random(in: 0...255) })
        return randomData.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }()

    /// Get the local auth token for use in HTTP requests
    var localToken: String? {
        // Check if authentication is disabled
        let authConfig = AuthConfig.current()
        if authConfig.mode == "none" {
            return nil
        }
        return localAuthToken
    }

    /// Get the current authentication mode
    var authMode: String {
        AuthConfig.current().mode
    }

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

        // Check if we should use dev server
        let devConfig = DevServerConfig.current()

        if devConfig.useDevServer && !devConfig.devServerPath.isEmpty {
            logger.notice("🔧 Starting DEVELOPMENT SERVER with hot reload (pnpm run dev) on port \(self.port)")
            logger.info("Development path: \(devConfig.devServerPath)")
            serverOutput.notice("🔧 VibeTunnel Development Mode - Hot reload enabled")
            serverOutput.info("Project: \(devConfig.devServerPath)")
            try await startDevServer(path: devConfig.devServerPath)
        } else {
            logger.info("Starting production server (built-in SPA) on port \(self.port)")
            try await startProductionServer()
        }
    }

    private func startProductionServer() async throws {
        // Get the vibetunnel binary path (the Bun executable)
        guard let binaryPath = Bundle.main.path(forResource: "vibetunnel", ofType: nil) else {
            let error = BunServerError.binaryNotFound
            logger.error("vibetunnel binary not found in bundle")

            // Additional diagnostics for CI debugging
            logger.error("Bundle path: \(Bundle.main.bundlePath)")
            logger.error("Resources path: \(Bundle.main.resourcePath ?? "nil")")

            // List contents of Resources directory
            if let resourcesPath = Bundle.main.resourcePath {
                do {
                    let contents = try FileManager.default.contentsOfDirectory(atPath: resourcesPath)
                    logger.error("Resources directory contents: \(contents.joined(separator: ", "))")
                } catch {
                    logger.error("Failed to list Resources directory: \(error)")
                }
            }

            throw error
        }

        logger.info("Using Bun executable at: \(binaryPath)")

        // Ensure binary is executable
        do {
            try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: binaryPath)
        } catch {
            logger.error("Failed to set executable permissions on binary: \(error.localizedDescription)")
            throw BunServerError.binaryNotFound
        }

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

        // Build the vibetunnel command arguments as an array
        // Add Node.js V8 memory options first
        var vibetunnelArgs = ["--port", String(port), "--bind", bindAddress]

        // Add authentication flags based on configuration
        let authConfig = AuthConfig.current()
        logger.info("Configuring authentication mode: \(authConfig.mode)")

        switch authConfig.mode {
        case "none":
            vibetunnelArgs.append("--no-auth")
        case "ssh":
            vibetunnelArgs.append(contentsOf: ["--enable-ssh-keys", "--disallow-user-password"])
        case "both":
            vibetunnelArgs.append("--enable-ssh-keys")
        case "os", _:
            // OS authentication is the default, no special flags needed
            break
        }

        // Add local bypass authentication for the Mac app
        if authConfig.mode != "none" {
            // Enable local bypass with our generated token
            vibetunnelArgs.append(contentsOf: ["--allow-local-bypass", "--local-auth-token", localAuthToken])
            logger.info("Local authentication bypass enabled for Mac app")
        }

        // Repository base path is now loaded from config.json by the server
        // No CLI argument needed

        // Add Tailscale Serve integration if enabled
        let tailscaleServeEnabled = UserDefaults.standard
            .bool(forKey: AppConstants.UserDefaultsKeys.tailscaleServeEnabled)
        if tailscaleServeEnabled {
            vibetunnelArgs.append("--enable-tailscale-serve")
            logger.info("Tailscale Serve integration enabled")

            // Force localhost binding for security when using Tailscale Serve
            if bindAddress == "0.0.0.0" {
                logger.warning("Overriding bind address to localhost for Tailscale Serve security")
                // Update the vibetunnelArgs that were already set above
                if let bindIndex = vibetunnelArgs.firstIndex(of: "--bind") {
                    vibetunnelArgs[bindIndex + 1] = "127.0.0.1"
                }
            }
        }

        // Create wrapper to run vibetunnel with parent death monitoring AND crash detection
        let parentPid = ProcessInfo.processInfo.processIdentifier

        // Properly escape arguments for shell
        let escapedArgs = vibetunnelArgs
            .map { arg in
                // Escape single quotes by replacing ' with '\''
                let escaped = arg.replacingOccurrences(of: "'", with: "'\\''")
                return "'\(escaped)'"
            }
            .joined(separator: " ")

        let vibetunnelCommand = """
        # Start vibetunnel in background
        '\(binaryPath)' \(escapedArgs) &
        VIBETUNNEL_PID=$!

        # Monitor both parent process AND vibetunnel process
        while kill -0 \(parentPid) 2>/dev/null && kill -0 $VIBETUNNEL_PID 2>/dev/null; do
            sleep 1
        done

        # Check why we exited the loop
        if ! kill -0 $VIBETUNNEL_PID 2>/dev/null; then
            # Vibetunnel died - wait to get its exit code
            wait $VIBETUNNEL_PID
            EXIT_CODE=$?
            echo "VibeTunnel server process died with exit code: $EXIT_CODE" >&2
            exit $EXIT_CODE
        else
            # Parent died - kill vibetunnel
            kill -TERM $VIBETUNNEL_PID 2>/dev/null
            wait $VIBETUNNEL_PID
            exit 0
        fi
        """
        process.arguments = ["-l", "-c", vibetunnelCommand]

        // Set up a termination handler for logging
        process.terminationHandler = { [weak self] process in
            self?.logger.info("vibetunnel process terminated with status: \(process.terminationStatus)")
        }

        logger.info("Executing command: /bin/zsh -l -c \"\(vibetunnelCommand)\"")
        logger.info("Binary location: \(resourcesPath)")
        logger.info("Server configuration: port=\(self.port), bindAddress=\(self.bindAddress)")

        // Set up a minimal environment for the SEA binary
        // SEA binaries can be sensitive to certain environment variables
        var environment = [String: String]()
        environment["NODE_OPTIONS"] = "--max-old-space-size=4096 --max-semi-space-size=128"

        // Copy only essential environment variables
        let essentialVars = [
            EnvironmentKeys.path,
            "HOME",
            "USER",
            "SHELL",
            EnvironmentKeys.lang,
            "LC_ALL",
            "LC_CTYPE",
            "VIBETUNNEL_DEBUG"
        ]
        for key in essentialVars {
            if let value = ProcessInfo.processInfo.environment[key] {
                environment[key] = value
            }
        }

        // Set NODE_ENV to development in debug builds to disable caching
        #if DEBUG
            environment["NODE_ENV"] = "development"
            logger.info("Running in DEBUG configuration - setting NODE_ENV=development to disable caching")
        #endif

        // Add Node.js memory settings as command line arguments instead of NODE_OPTIONS
        // NODE_OPTIONS can interfere with SEA binaries

        // Set BUILD_PUBLIC_PATH to help the server find static files in the app bundle
        environment["BUILD_PUBLIC_PATH"] = staticPath
        logger.info("Setting BUILD_PUBLIC_PATH=\(staticPath)")

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
            // Start the process with parent termination handling
            try await process.runWithParentTerminationAsync()

            logger.info("Bun server process started")

            // Give the process a moment to start before checking for early failures
            try await Task.sleep(for: .milliseconds(100))

            // Check if process exited immediately (indicating failure)
            if !process.isRunning {
                let exitCode = process.terminationStatus

                // Special handling for specific exit codes
                if exitCode == 126 {
                    logger.error("Process exited immediately: Command not executable (exit code: 126)")
                    throw BunServerError.binaryNotFound
                } else if exitCode == 9 {
                    logger.error("Process exited immediately: Port \(self.port) is already in use (exit code: 9)")
                } else {
                    logger.error("Process exited immediately with code: \(exitCode)")
                }

                // Try to read any error output
                var errorDetails = "Exit code: \(exitCode)"
                if let stderrPipe = self.stderrPipe {
                    do {
                        if let errorData = try stderrPipe.fileHandleForReading.readToEnd(),
                           !errorData.isEmpty
                        {
                            let errorOutput = String(bytes: errorData, encoding: .utf8) ?? "<Invalid UTF-8>"
                            errorDetails += "\nError: \(errorOutput.trimmingCharacters(in: .whitespacesAndNewlines))"
                        }
                    } catch {
                        logger.debug("Could not read stderr: \(error.localizedDescription)")
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

    private func startDevServer(path: String) async throws {
        let devServerManager = DevServerManager.shared
        let expandedPath = devServerManager.expandedPath(for: path)

        // Validate the path first
        let validation = devServerManager.validate(path: path)
        guard validation.isValid else {
            let error = BunServerError.devServerInvalid(validation.errorMessage ?? "Invalid dev server path")
            logger.error("Dev server validation failed: \(error.localizedDescription)")
            throw error
        }

        // Create the process using login shell
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")

        // Set working directory to the web project
        process.currentDirectoryURL = URL(fileURLWithPath: expandedPath)
        logger.info("Dev server working directory: \(expandedPath)")

        // Get authentication mode
        let authConfig = AuthConfig.current()

        // Build the dev server arguments
        var effectiveBindAddress = bindAddress

        // Check if Tailscale Serve is enabled and force localhost binding
        let tailscaleServeEnabled = UserDefaults.standard
            .bool(forKey: AppConstants.UserDefaultsKeys.tailscaleServeEnabled)
        if tailscaleServeEnabled && bindAddress == "0.0.0.0" {
            logger.warning("Overriding bind address to localhost for Tailscale Serve security")
            effectiveBindAddress = "127.0.0.1"
        }

        let devArgs = devServerManager.buildDevServerArguments(
            port: port,
            bindAddress: effectiveBindAddress,
            authMode: authConfig.mode,
            localToken: localToken
        )

        // Find pnpm executable
        guard let pnpmPath = devServerManager.findPnpmPath() else {
            let error = BunServerError.devServerInvalid("pnpm executable not found")
            logger.error("Failed to find pnpm executable")
            throw error
        }

        logger.info("Using pnpm at: \(pnpmPath)")

        // Create wrapper to run pnpm with parent death monitoring AND crash detection
        let parentPid = ProcessInfo.processInfo.processIdentifier
        let pnpmDir = URL(fileURLWithPath: pnpmPath).deletingLastPathComponent().path
        let pnpmCommand = """
        # Change to the project directory
        cd '\(expandedPath)'

        # Add pnpm to PATH for the dev script
        export PATH="\(pnpmDir):$PATH"

        # Start pnpm dev in background
        # We'll use pkill later to ensure all related processes are terminated
        \(pnpmPath) \(devArgs.joined(separator: " ")) &
        PNPM_PID=$!

        # Monitor both parent process AND pnpm process
        while kill -0 \(parentPid) 2>/dev/null && kill -0 $PNPM_PID 2>/dev/null; do
            sleep 1
        done

        # Check why we exited the loop
        if ! kill -0 $PNPM_PID 2>/dev/null; then
            # Pnpm died - wait to get its exit code
            wait $PNPM_PID
            EXIT_CODE=$?
            echo "🔴 Development server crashed with exit code: $EXIT_CODE" >&2
            echo "Check 'pnpm run dev' output above for errors" >&2
            exit $EXIT_CODE
        else
            # Parent died - kill pnpm and all its children
            echo "🛑 VibeTunnel is shutting down, stopping development server..." >&2

            # First try to kill pnpm gracefully
            kill -TERM $PNPM_PID 2>/dev/null

            # Give it a moment to clean up
            sleep 0.5

            # If still running, force kill
            if kill -0 $PNPM_PID 2>/dev/null; then
                kill -KILL $PNPM_PID 2>/dev/null
            fi

            # Also kill any node processes that might have been spawned
            # This ensures we don't leave orphaned processes
            pkill -P $PNPM_PID 2>/dev/null || true

            wait $PNPM_PID 2>/dev/null
            exit 0
        fi
        """
        process.arguments = ["-l", "-c", pnpmCommand]

        // Set up a termination handler for logging
        process.terminationHandler = { [weak self] process in
            self?.logger.info("Dev server process terminated with status: \(process.terminationStatus)")
            self?.serverOutput.notice("🛑 Development server stopped")
        }

        logger.info("Executing command: /bin/zsh -l -c \"\(pnpmCommand)\"")
        logger.info("Working directory: \(expandedPath)")
        logger.info("Dev server configuration: port=\(self.port), bindAddress=\(self.bindAddress)")

        // Set up environment for dev server
        var environment = ProcessInfo.processInfo.environment
        // Add Node.js memory settings
        environment["NODE_OPTIONS"] = "--max-old-space-size=4096 --max-semi-space-size=128"

        // Always set NODE_ENV to development for dev server to ensure caching is disabled
        environment["NODE_ENV"] = "development"
        logger.info("Dev server mode - setting NODE_ENV=development to disable caching")

        // Add pnpm to PATH so that scripts can use it
        // pnpmDir is already defined above
        if let existingPath = environment[EnvironmentKeys.path] {
            environment[EnvironmentKeys.path] = "\(pnpmDir):\(existingPath)"
        } else {
            environment[EnvironmentKeys.path] = pnpmDir
        }
        logger.info("Added pnpm directory to PATH: \(pnpmDir)")

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
            // Start the process with parent termination handling
            try await process.runWithParentTerminationAsync()

            logger.info("Dev server process started")

            // Output a clear banner in the server logs
            serverOutput.notice("")
            serverOutput.notice("==========================================")
            serverOutput.notice("🔧 DEVELOPMENT MODE ACTIVE")
            serverOutput.notice("------------------------------------------")
            serverOutput.notice("Hot reload enabled - changes auto-refresh")
            serverOutput.notice("Project: \(expandedPath, privacy: .public)")
            serverOutput.notice("Port: \(self.port, privacy: .public)")
            serverOutput.notice("==========================================")
            serverOutput.notice("")

            // Give the process a moment to start before checking for early failures
            try await Task.sleep(for: .milliseconds(500)) // Dev server takes longer to start

            // Check if process exited immediately (indicating failure)
            if !process.isRunning {
                let exitCode = process.terminationStatus
                logger.error("Dev server process exited immediately with code: \(exitCode)")

                // Try to read any error output
                var errorDetails = "Exit code: \(exitCode)"
                if let stderrPipe = self.stderrPipe {
                    do {
                        if let errorData = try stderrPipe.fileHandleForReading.readToEnd(),
                           !errorData.isEmpty
                        {
                            let errorOutput = String(bytes: errorData, encoding: .utf8) ?? "<Invalid UTF-8>"
                            errorDetails += "\nError: \(errorOutput.trimmingCharacters(in: .whitespacesAndNewlines))"
                        }
                    } catch {
                        logger.debug("Could not read stderr: \(error.localizedDescription)")
                    }
                }

                logger.error("Dev server failed to start: \(errorDetails)")
                throw BunServerError.processFailedToStart
            }

            // Mark server as running only after successful start
            state = .running

            logger.notice("✅ Development server started successfully with hot reload")
            serverOutput.notice("🔧 Development server is running - changes will auto-reload")

            // Monitor process termination
            Task {
                await monitorProcessTermination()
            }
        } catch {
            // Log more detailed error information
            logger.error("Failed to start dev server: \(error.localizedDescription)")
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

            let logger = Logger(subsystem: BundleIdentifiers.loggerSubsystem, category: "BunServer")
            logger.debug("Starting stdout monitoring for Bun server on port \(currentPort)")

            // Create a cancellation handler
            let cancelSource = {
                source.cancel()
                try? handle.close()
            }

            source.setEventHandler { [logHandler] in
                // Read data in a non-blocking way to prevent hangs on large output
                var buffer = Data()
                let maxBytesPerRead = 65_536 // 64KB chunks

                // Read available data without blocking
                while true {
                    var readBuffer = Data(count: maxBytesPerRead)
                    let bytesRead = readBuffer.withUnsafeMutableBytes { bytes in
                        guard let baseAddress = bytes.baseAddress else {
                            logger.error("Failed to get base address for read buffer")
                            return -1
                        }
                        return Darwin.read(handle.fileDescriptor, baseAddress, maxBytesPerRead)
                    }

                    if bytesRead > 0 {
                        buffer.append(readBuffer.prefix(bytesRead))

                        // Check if more data is immediately available
                        var pollfd = pollfd(fd: handle.fileDescriptor, events: Int16(POLLIN), revents: 0)
                        let pollResult = poll(&pollfd, 1, 0) // 0 timeout = non-blocking

                        if pollResult <= 0 || (pollfd.revents & Int16(POLLIN)) == 0 {
                            break // No more data immediately available
                        }
                    } else if bytesRead == 0 {
                        // EOF reached
                        cancelSource()
                        return
                    } else {
                        // Error occurred
                        if errno != EAGAIN && errno != EWOULDBLOCK {
                            logger.error("Read error on stdout: \(String(cString: strerror(errno)))")
                            cancelSource()
                            return
                        }
                        break // No data available right now
                    }
                }

                // Process accumulated data
                if !buffer.isEmpty {
                    // Simply use the built-in lossy conversion instead of manual filtering
                    let output = String(bytes: buffer, encoding: .utf8) ?? "<Invalid UTF-8>"
                    Self.processOutputStatic(output, logHandler: logHandler, isError: false)
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

            let logger = Logger(subsystem: BundleIdentifiers.loggerSubsystem, category: "BunServer")
            logger.debug("Starting stderr monitoring for Bun server on port \(currentPort)")

            // Create a cancellation handler
            let cancelSource = {
                source.cancel()
                try? handle.close()
            }

            source.setEventHandler { [logHandler] in
                // Read data in a non-blocking way to prevent hangs on large output
                var buffer = Data()
                let maxBytesPerRead = 65_536 // 64KB chunks

                // Read available data without blocking
                while true {
                    var readBuffer = Data(count: maxBytesPerRead)
                    let bytesRead = readBuffer.withUnsafeMutableBytes { bytes in
                        guard let baseAddress = bytes.baseAddress else {
                            logger.error("Failed to get base address for read buffer")
                            return -1
                        }
                        return Darwin.read(handle.fileDescriptor, baseAddress, maxBytesPerRead)
                    }

                    if bytesRead > 0 {
                        buffer.append(readBuffer.prefix(bytesRead))

                        // Check if more data is immediately available
                        var pollfd = pollfd(fd: handle.fileDescriptor, events: Int16(POLLIN), revents: 0)
                        let pollResult = poll(&pollfd, 1, 0) // 0 timeout = non-blocking

                        if pollResult <= 0 || (pollfd.revents & Int16(POLLIN)) == 0 {
                            break // No more data immediately available
                        }
                    } else if bytesRead == 0 {
                        // EOF reached
                        cancelSource()
                        return
                    } else {
                        // Error occurred
                        if errno != EAGAIN && errno != EWOULDBLOCK {
                            logger.error("Read error on stderr: \(String(cString: strerror(errno)))")
                            cancelSource()
                            return
                        }
                        break // No data available right now
                    }
                }

                // Process accumulated data
                if !buffer.isEmpty {
                    // Simply use the built-in lossy conversion instead of manual filtering
                    let output = String(bytes: buffer, encoding: .utf8) ?? "<Invalid UTF-8>"
                    Self.processOutputStatic(output, logHandler: logHandler, isError: true)
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
            let devConfig = DevServerConfig.current()
            let serverType = devConfig.useDevServer ? "Development server (pnpm run dev)" : "Production server"

            self.logger.error("\(serverType) terminated unexpectedly with exit code: \(exitCode)")

            if devConfig.useDevServer {
                self.serverOutput.error("🔴 Development server crashed (exit code: \(exitCode))")
                self.serverOutput.error("Check the output above for error details")
            }

            // Clean up process reference
            self.process = nil

            // Notify about the crash
            if let onCrash = self.onCrash {
                self.logger.info("Notifying ServerManager about server crash")
                onCrash(exitCode)
            }
        } else {
            // Normal termination
            let devConfig = DevServerConfig.current()
            let serverType = devConfig.useDevServer ? "Development server" : "Production server"
            self.logger.info("\(serverType) terminated normally with exit code: \(exitCode)")
        }
    }

    // MARK: - Utilities
}

// MARK: - Errors

enum BunServerError: LocalizedError, Equatable {
    case binaryNotFound
    case processFailedToStart
    case invalidPort
    case invalidState
    case devServerInvalid(String)

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
        case .devServerInvalid(let reason):
            "Dev server configuration invalid: \(reason)"
        }
    }
}

// MARK: - Private Output Processing

extension BunServer {
    /// Process output with chunking for large lines and rate limiting awareness
    fileprivate nonisolated static func processOutputStatic(_ output: String, logHandler: LogHandler, isError: Bool) {
        let maxLineLength = 4_096 // Max chars per log line to avoid os.log truncation
        let lines = output.trimmingCharacters(in: .whitespacesAndNewlines)
            .components(separatedBy: .newlines)

        for line in lines where !line.isEmpty {
            // Skip shell initialization messages
            if line.contains("zsh:") || line.hasPrefix("Last login:") {
                continue
            }

            // If line is too long, chunk it to avoid os.log limits
            if line.count > maxLineLength {
                // Log that we're chunking a large line
                logHandler.log("[Large output: \(line.count) chars, chunking...]", isError: isError)

                // Chunk the line
                var startIndex = line.startIndex
                var chunkNumber = 1
                while startIndex < line.endIndex {
                    let endIndex = line.index(startIndex, offsetBy: maxLineLength, limitedBy: line.endIndex) ?? line
                        .endIndex
                    let chunk = String(line[startIndex..<endIndex])
                    logHandler.log("[Chunk \(chunkNumber)] \(chunk)", isError: isError)
                    startIndex = endIndex
                    chunkNumber += 1

                    // Add small delay between chunks to avoid rate limiting
                    if chunkNumber.isMultiple(of: 10) {
                        usleep(1_000) // 1ms delay every 10 chunks
                    }
                }
            } else {
                // Log normally
                logHandler.log(line, isError: isError)
            }
        }
    }
}

// MARK: - LogHandler

/// A sendable log handler for use in detached tasks
private final class LogHandler: Sendable {
    private let serverOutput = Logger(subsystem: BundleIdentifiers.loggerSubsystem, category: "ServerOutput")

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
