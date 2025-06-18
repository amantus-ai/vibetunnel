import Foundation
import HTTPTypes
import Hummingbird
import HummingbirdCore
import Logging
import NIOCore
import NIOPosix
import Observation
import os

/// Errors that can occur during server operations
enum ServerError: LocalizedError {
    case failedToStart(String)

    var errorDescription: String? {
        switch self {
        case .failedToStart(let message):
            message
        }
    }
}

/// Represents a tty-fwd session from the command-line tool
struct TtyFwdSession: Codable {
    let cmdline: [String]
    let cwd: String
    let exitCode: Int?
    let name: String
    let pid: Int
    let startedAt: String
    let status: String
    let stdin: String
    let streamOut: String

    enum CodingKeys: String, CodingKey {
        case cmdline
        case cwd
        case name
        case pid
        case status
        case stdin
        case exitCode = "exit_code"
        case startedAt = "started_at"
        case streamOut = "stream-out"
    }
}

/// Simplified session information for API responses
struct TtyFwdSessionInfo: Codable {
    let id: String
    let command: String
    let workingDir: String
    let status: String
    let exitCode: Int?
    let startedAt: String
    let lastModified: String
    let pid: Int
}

/// File/directory information for filesystem browsing
struct FileInfo: Codable {
    let name: String
    let created: String
    let lastModified: String
    let size: Int64
    let isDir: Bool
}

/// Directory listing response containing files and path
struct DirectoryListing: Codable {
    let absolutePath: String
    let files: [FileInfo]
}

/// Generic response for simple success/failure operations
struct SimpleResponse: Codable {
    let success: Bool
    let message: String
}

/// Response containing a newly created session ID
struct SessionIdResponse: Codable {
    let sessionId: String
}

/// Response for session creation matching Rust API format
struct SessionCreatedResponse: Codable {
    let success: Bool
    let message: String
    let sessionId: String
}

/// Response for streaming endpoints
struct StreamResponse: Codable {
    let message: String
    let streamPath: String
}

/// Actor to manage session streaming tasks safely
private actor SessionTaskManager {
    private var tasks: [String: Task<Void, Never>] = [:]

    func add(sessionId: String, task: Task<Void, Never>) {
        tasks[sessionId] = task
    }

    func cancelAll() {
        for task in tasks.values {
            task.cancel()
        }
        tasks.removeAll()
    }
}

/// HTTP server that provides API endpoints for terminal session management.
///
/// `TunnelServer` implements a Hummingbird-based HTTP server that bridges web clients
/// with the tty-fwd terminal multiplexer. It provides RESTful APIs for session management,
/// command execution, and filesystem browsing, along with WebSocket support for real-time
/// terminal streaming. The server serves the web UI as static files and handles all
/// terminal-related operations through a local HTTP interface.
///
/// This server runs locally and provides:
/// - Session creation, listing, and management
/// - Terminal I/O streaming
/// - Filesystem browsing
/// - Static file serving for the web UI
@MainActor
@Observable
public final class TunnelServer {
    public private(set) var isRunning = false
    public private(set) var port: Int
    public var lastError: Error?

    private var app: Application<Router<BasicRequestContext>.Responder>?
    private let logger = Logger(label: "VibeTunnel.TunnelServer")
    private let terminalManager = TerminalManager()
    private let ngrokService = NgrokService.shared
    private var serverTask: Task<Void, Error>?
    private let ttyFwdControlDir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".vibetunnel")
        .appendingPathComponent("control").path

    private var bindAddress: String
    private var authMiddleware: LazyBasicAuthMiddleware<BasicRequestContext>?

    public init(port: Int = 4_020, bindAddress: String = "127.0.0.1") {
        self.port = port
        self.bindAddress = bindAddress
    }

    public func start() async throws {
        guard !isRunning else { return }

        logger.info("Starting TunnelServer on port \(port)")

        do {
            let router = Router(context: BasicRequestContext.self)

            // Add middleware
            router.add(middleware: LogRequestsMiddleware(.info))

            // Add lazy basic auth middleware - defers password loading until needed
            let authMiddleware = LazyBasicAuthMiddleware<BasicRequestContext>()
            self.authMiddleware = authMiddleware
            router.add(middleware: authMiddleware)

            // Health check endpoint
            router.get("/api/health") { _, _ async -> Response in
                let response = SimpleResponse(success: true, message: "OK")
                return await self.jsonResponse(response)
            }

            // Info endpoint
            router.get("/info") { _, _ -> Response in
                let info = [
                    "name": "VibeTunnel",
                    "version": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0",
                    "uptime": ProcessInfo.processInfo.systemUptime
                ]

                let jsonData = (try? JSONSerialization.data(withJSONObject: info)) ?? Data()
                var buffer = ByteBuffer()
                buffer.writeBytes(jsonData)

                return Response(
                    status: .ok,
                    headers: [.contentType: "application/json"],
                    body: ResponseBody(byteBuffer: buffer)
                )
            }

            // API routes for session management
            router.get("/api/sessions") { _, _ async -> Response in
                await self.listSessions()
            }

            router.post("/api/sessions") { request, _ async -> Response in
                await self.createSession(request: request)
            }

            router.delete("/api/sessions/:sessionId") { _, context async -> Response in
                guard let sessionId = context.parameters.get("sessionId") else {
                    return self.errorResponse(message: "Session ID required", status: .badRequest)
                }
                return await self.killSession(sessionId: sessionId)
            }

            router.delete("/api/sessions/:sessionId/cleanup") { _, context async -> Response in
                guard let sessionId = context.parameters.get("sessionId") else {
                    return self.errorResponse(message: "Session ID required", status: .badRequest)
                }
                return await self.cleanupSession(sessionId: sessionId)
            }

            router.get("/api/sessions/:sessionId/stream") { _, context async -> Response in
                guard let sessionId = context.parameters.get("sessionId") else {
                    return self.errorResponse(message: "Session ID required", status: .badRequest)
                }
                return await self.streamSessionOutput(sessionId: sessionId)
            }

            router.get("/api/sessions/:sessionId/snapshot") { _, context async -> Response in
                guard let sessionId = context.parameters.get("sessionId") else {
                    return self.errorResponse(message: "Session ID required", status: .badRequest)
                }
                return await self.getSessionSnapshot(sessionId: sessionId)
            }

            router.post("/api/sessions/:sessionId/input") { request, context async -> Response in
                guard let sessionId = context.parameters.get("sessionId") else {
                    return self.errorResponse(message: "Session ID required", status: .badRequest)
                }
                return await self.sendSessionInput(request: request, sessionId: sessionId)
            }

            router.get("/api/sessions/:sessionId/cast") { _, context async -> Response in
                guard let sessionId = context.parameters.get("sessionId") else {
                    return self.errorResponse(message: "Session ID required", status: .badRequest)
                }
                return await self.getSessionCast(sessionId: sessionId)
            }

            router.get("/api/sessions/multistream") { request, _ async -> Response in
                await self.multiStreamSessions(request: request)
            }

            router.post("/api/cleanup-exited") { _, _ async -> Response in
                await self.cleanupExitedSessions()
            }

            router.get("/api/fs/browse") { request, _ async -> Response in
                await self.browseFileSystem(request: request)
            }

            router.post("/api/mkdir") { request, _ async -> Response in
                await self.createDirectory(request: request)
            }

            // ngrok tunnel management endpoints
            router.post("/api/ngrok/start") { _, _ async -> Response in
                await self.startNgrokTunnel()
            }

            router.post("/api/ngrok/stop") { _, _ async -> Response in
                await self.stopNgrokTunnel()
            }

            router.get("/api/ngrok/status") { _, _ async -> Response in
                await self.getNgrokStatus()
            }

            // Legacy endpoint for backwards compatibility
            router.get("/sessions") { _, _ async -> Response in
                let process = await MainActor.run {
                    TTYForwardManager.shared.createTTYForwardProcess(with: [
                        "--control-path",
                        self.ttyFwdControlDir,
                        "--list-sessions"
                    ])
                }

                guard let process else {
                    self.logger.error("Failed to create tty-fwd process")
                    let errorJson = "{\"error\": \"tty-fwd binary not found\"}"
                    var buffer = ByteBuffer()
                    buffer.writeString(errorJson)
                    return Response(
                        status: .internalServerError,
                        headers: [.contentType: "application/json"],
                        body: ResponseBody(byteBuffer: buffer)
                    )
                }

                let outputPipe = Pipe()
                let errorPipe = Pipe()
                process.standardOutput = outputPipe
                process.standardError = errorPipe

                do {
                    try process.run()
                    process.waitUntilExit()

                    if process.terminationStatus == 0 {
                        // Read the JSON output
                        let outputData = outputPipe.fileHandleForReading.readDataToEndOfFile()
                        var buffer = ByteBuffer()
                        buffer.writeBytes(outputData)

                        return Response(
                            status: .ok,
                            headers: [.contentType: "application/json"],
                            body: ResponseBody(byteBuffer: buffer)
                        )
                    } else {
                        // Read error output
                        let errorData = errorPipe.fileHandleForReading.readDataToEndOfFile()
                        let errorString = String(data: errorData, encoding: .utf8)?
                            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

                        // Provide more descriptive error messages based on exit code
                        let statusCode = Int(process.terminationStatus)
                        let errorDescription: String = switch statusCode {
                        case 9:
                            "Process was killed (SIGKILL). The control directory may not exist or be accessible."
                        case -9:
                            "Process was terminated by SIGKILL. This might be due to macOS security restrictions."
                        default:
                            errorString.isEmpty ? "Process exited with code \(statusCode)" : errorString
                        }

                        // Log additional debugging information
                        self.logger.error("tty-fwd executable path: \(process.executableURL?.path ?? "unknown")")
                        self.logger.error("Control directory path: \(self.ttyFwdControlDir)")
                        self.logger
                            .error(
                                "Control directory exists: \(FileManager.default.fileExists(atPath: self.ttyFwdControlDir))"
                            )

                        self.logger.error("tty-fwd failed with status \(statusCode): \(errorDescription)")

                        let errorJson =
                            "{\"error\": \"Failed to list sessions: \(errorDescription.replacingOccurrences(of: "\"", with: "\\\""))\"}"
                        var buffer = ByteBuffer()
                        buffer.writeString(errorJson)
                        return Response(
                            status: .internalServerError,
                            headers: [.contentType: "application/json"],
                            body: ResponseBody(byteBuffer: buffer)
                        )
                    }
                } catch {
                    self.logger.error("Failed to run tty-fwd: \(error)")
                    let errorJson =
                        "{\"error\": \"Failed to execute tty-fwd: \(error.localizedDescription.replacingOccurrences(of: "\"", with: "\\\""))\"}"
                    var buffer = ByteBuffer()
                    buffer.writeString(errorJson)
                    return Response(
                        status: .internalServerError,
                        headers: [.contentType: "application/json"],
                        body: ResponseBody(byteBuffer: buffer)
                    )
                }
            }

            // Serve index.html from root path
            router.get("/") { _, _ async -> Response in
                await self.serveStaticFile(path: "index.html")
            }

            // Serve static files from web/public folder (catch-all route - must be last)
            router.get("**") { request, _ async -> Response in
                // Get the full path from the request URI
                let requestPath = request.uri.path
                // Remove leading slash
                let path = String(requestPath.dropFirst())

                // If it's empty (root path), we already handled it above
                if path.isEmpty {
                    return self.errorResponse(message: "File not found", status: .notFound)
                }

                return await self.serveStaticFile(path: path)
            }

            // Create application configuration
            // Use bindAddress to control server accessibility
            let configuration = ApplicationConfiguration(
                address: .hostname(bindAddress, port: port),
                serverName: "VibeTunnel"
            )

            // Create the application
            let app = Application(
                responder: router.buildResponder(),
                configuration: configuration,
                logger: logger
            )

            // Store the app reference first
            self.app = app

            // Run the server in a detached task to ensure it keeps running
            serverTask = Task.detached(priority: .background) { [weak self, logger] in
                do {
                    logger.info("Starting Hummingbird application...")
                    try await app.run()
                    logger.info("Hummingbird application stopped")
                } catch {
                    logger.error("Hummingbird error: \(error)")
                    await MainActor.run { [weak self] in
                        self?.lastError = error
                        self?.isRunning = false
                    }
                    throw error
                }
            }

            // Wait for the server to actually start listening
            var serverStarted = false
            for _ in 0..<10 { // Try for up to 1 second
                try await Task.sleep(for: .milliseconds(100))

                // Check if the server is actually listening
                if await isServerListening(on: port) {
                    serverStarted = true
                    break
                }
            }

            if serverStarted {
                isRunning = true
                logger.info("Server started and listening on port \(port)")
            } else {
                throw ServerError.failedToStart("Server did not start listening on port \(port)")
            }
        } catch {
            lastError = error
            isRunning = false
            throw error
        }
    }

    public func stop() async throws {
        guard isRunning else { return }

        logger.info("Stopping server...")

        // Cancel the server task - this will stop the application
        serverTask?.cancel()
        serverTask = nil

        // Clear the application reference
        self.app = nil

        isRunning = false
    }

    /// Clears the cached password in the authentication middleware
    public func clearAuthCache() async {
        await authMiddleware?.clearCache()
        logger.info("Cleared authentication cache")
    }

    /// Verifies the server is listening by attempting an HTTP health check
    private func isServerListening(on port: Int) async -> Bool {
        do {
            guard let url = URL(string: "http://127.0.0.1:\(port)/api/health") else {
                return false
            }
            let request = URLRequest(url: url, timeoutInterval: 1.0)
            let (_, response) = try await URLSession.shared.data(for: request)

            if let httpResponse = response as? HTTPURLResponse {
                return httpResponse.statusCode == 200
            }
        } catch {
            // Server not yet ready
        }
        return false
    }

    // MARK: - Helper Functions

    private func executeTtyFwd(args: [String]) async throws -> String {
        let process = TTYForwardManager.shared.createTTYForwardProcess(with: args)
        guard let process else {
            throw NSError(
                domain: "TtyFwdError",
                code: 1,
                userInfo: [
                    NSLocalizedDescriptionKey: "tty-fwd binary not found. Please ensure the app was built correctly."
                ]
            )
        }

        let outputPipe = Pipe()
        let errorPipe = Pipe()
        process.standardOutput = outputPipe
        process.standardError = errorPipe

        try process.run()
        process.waitUntilExit()

        if process.terminationStatus == 0 {
            let outputData = outputPipe.fileHandleForReading.readDataToEndOfFile()
            return String(data: outputData, encoding: .utf8) ?? ""
        } else {
            let errorData = errorPipe.fileHandleForReading.readDataToEndOfFile()
            let errorString = String(data: errorData, encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

            // Provide more descriptive error messages based on exit code
            let statusCode = Int(process.terminationStatus)
            let errorDescription: String = switch statusCode {
            case 1:
                "General error: \(errorString.isEmpty ? "Command failed" : errorString)"
            case 2:
                "Misuse of shell command: \(errorString.isEmpty ? "Invalid arguments" : errorString)"
            case 9:
                "Process was killed (SIGKILL). The control directory may not exist or be accessible."
            case -9:
                "Process was terminated by SIGKILL. This might be due to macOS security restrictions."
            case 126:
                "Command found but not executable"
            case 127:
                "Command not found"
            case 130:
                "Process terminated by Ctrl+C"
            case 139:
                "Segmentation fault"
            default:
                errorString.isEmpty ? "Process exited with code \(statusCode)" : errorString
            }

            // Log additional debugging information for SIGKILL
            if statusCode == 9 || statusCode == -9 {
                logger.error("tty-fwd executable path: \(process.executableURL?.path ?? "unknown")")
                logger.error("Arguments: \(args.joined(separator: " "))")
                logger
                    .error("Control directory exists: \(FileManager.default.fileExists(atPath: self.ttyFwdControlDir))")
            }

            throw NSError(
                domain: "TtyFwdError",
                code: statusCode,
                userInfo: [NSLocalizedDescriptionKey: errorDescription]
            )
        }
    }

    private func resolvePath(_ inputPath: String, fallback: String = NSHomeDirectory()) -> String {
        if inputPath.isEmpty {
            return fallback
        }

        if inputPath.hasPrefix("~") {
            return NSString(string: inputPath).expandingTildeInPath
        }

        return NSString(string: inputPath).standardizingPath
    }

    private nonisolated func errorResponse(
        message: String,
        status: HTTPResponse.Status = .internalServerError
    )
        -> Response
    {
        let errorJson = "{\"error\": \"\(message.replacingOccurrences(of: "\"", with: "\\\""))\"}"
        var buffer = ByteBuffer()
        buffer.writeString(errorJson)

        return Response(
            status: status,
            headers: [.contentType: "application/json"],
            body: ResponseBody(byteBuffer: buffer)
        )
    }

    private func jsonResponse(_ object: some Codable, status: HTTPResponse.Status = .ok) -> Response {
        do {
            let jsonData = try JSONEncoder().encode(object)
            var buffer = ByteBuffer()
            buffer.writeBytes(jsonData)

            return Response(
                status: status,
                headers: [.contentType: "application/json"],
                body: ResponseBody(byteBuffer: buffer)
            )
        } catch {
            return errorResponse(message: "Failed to encode JSON response")
        }
    }

    // MARK: - Static File Serving

    private func serveStaticFile(path: String) async -> Response {
        // Serve files only from the bundled Resources folder
        guard let resourcePath = Bundle.main.resourcePath else {
            logger.error("Bundle resource path not found")
            return errorResponse(message: "Resource bundle not available", status: .internalServerError)
        }

        let webPublicPath = resourcePath + "/web/public"

        // Sanitize path to prevent directory traversal attacks
        let sanitizedPath = path.replacingOccurrences(of: "..", with: "")
        let fullPath = webPublicPath + "/" + sanitizedPath

        // Check if the web directory exists in Resources
        var isWebDirExists: ObjCBool = false
        if !FileManager.default.fileExists(atPath: webPublicPath, isDirectory: &isWebDirExists) || !isWebDirExists
            .boolValue
        {
            logger.error("Web resources not found at: \(webPublicPath)")
            logger.error("Make sure the app was built with the 'Build Web Frontend' phase")
            return errorResponse(message: "Web resources not bundled", status: .internalServerError)
        }

        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: fullPath, isDirectory: &isDirectory) else {
            return errorResponse(message: "File not found", status: .notFound)
        }

        // If it's a directory, try to serve index.html from that directory
        if isDirectory.boolValue {
            let indexPath = fullPath + "/index.html"
            if FileManager.default.fileExists(atPath: indexPath) {
                // Recursively serve the index.html file
                return await serveStaticFile(path: sanitizedPath + "/index.html")
            }
            return errorResponse(message: "Directory access not allowed", status: .notFound)
        }

        do {
            let fileData = try Data(contentsOf: URL(fileURLWithPath: fullPath))
            var buffer = ByteBuffer()
            buffer.writeBytes(fileData)

            let contentType = getContentType(for: path)

            return Response(
                status: .ok,
                headers: [.contentType: contentType],
                body: ResponseBody(byteBuffer: buffer)
            )
        } catch {
            return errorResponse(message: "Failed to read file", status: .internalServerError)
        }
    }

    private func getContentType(for path: String) -> String {
        let pathExtension = (path as NSString).pathExtension.lowercased()

        switch pathExtension {
        case "html", "htm":
            return "text/html"
        case "css":
            return "text/css"
        case "js":
            return "application/javascript"
        case "json":
            return "application/json"
        case "png":
            return "image/png"
        case "jpg", "jpeg":
            return "image/jpeg"
        case "gif":
            return "image/gif"
        case "svg":
            return "image/svg+xml"
        case "ico":
            return "image/x-icon"
        case "woff":
            return "font/woff"
        case "woff2":
            return "font/woff2"
        case "ttf":
            return "font/ttf"
        case "eot":
            return "application/vnd.ms-fontobject"
        case "map":
            return "application/json"
        default:
            return "application/octet-stream"
        }
    }

    // MARK: - API Endpoints

    private func listSessions() async -> Response {
        do {
            let output = try await executeTtyFwd(args: ["--control-path", ttyFwdControlDir, "--list-sessions"])
            let sessionsData = output.data(using: .utf8) ?? Data()

            let sessions = try JSONDecoder().decode([String: TtyFwdSession].self, from: sessionsData)

            let sessionInfos = sessions.compactMap { sessionId, sessionInfo -> TtyFwdSessionInfo? in
                var lastModified = sessionInfo.startedAt

                let streamOutPath = sessionInfo.streamOut
                if FileManager.default.fileExists(atPath: streamOutPath) {
                    do {
                        let attrs = try FileManager.default.attributesOfItem(atPath: streamOutPath)
                        if let modDate = attrs[.modificationDate] as? Date {
                            let formatter = ISO8601DateFormatter()
                            lastModified = formatter.string(from: modDate)
                        }
                    } catch {
                        // Use startedAt as fallback
                    }
                }

                return TtyFwdSessionInfo(
                    id: sessionId,
                    command: sessionInfo.cmdline.joined(separator: " "),
                    workingDir: sessionInfo.cwd,
                    status: sessionInfo.status,
                    exitCode: sessionInfo.exitCode,
                    startedAt: sessionInfo.startedAt,
                    lastModified: lastModified,
                    pid: sessionInfo.pid
                )
            }
            .sorted { first, second in
                let dateA = ISO8601DateFormatter().date(from: first.lastModified) ?? Date.distantPast
                let dateB = ISO8601DateFormatter().date(from: second.lastModified) ?? Date.distantPast
                return dateA > dateB
            }

            return jsonResponse(sessionInfos)
        } catch {
            logger.error("Failed to list sessions: \(error)")
            return errorResponse(message: "Failed to list sessions")
        }
    }

    private func createSession(request: Request) async -> Response {
        do {
            let buffer = try await request.body.collect(upTo: 1_024 * 1_024) // 1MB limit
            let requestData = Data(buffer: buffer)

            struct CreateSessionRequest: Codable {
                let command: [String]
                let workingDir: String?
                let term: String?
                let spawnTerminal: Bool?

                enum CodingKeys: String, CodingKey {
                    case command
                    case workingDir
                    case term
                    case spawnTerminal = "spawn_terminal"
                }
            }

            let sessionRequest = try JSONDecoder().decode(CreateSessionRequest.self, from: requestData)

            if sessionRequest.command.isEmpty {
                return errorResponse(message: "Command array is required and cannot be empty", status: .badRequest)
            }

            // Handle terminal spawning if requested
            if sessionRequest.spawnTerminal ?? false {
                logger.info("Spawn terminal requested for command: \(sessionRequest.command.joined(separator: " "))")

                let sessionId = UUID().uuidString
                let workingDir = resolvePath(
                    sessionRequest.workingDir ?? "~/",
                    fallback: FileManager.default.homeDirectoryForCurrentUser.path
                )
                let command = sessionRequest.command.joined(separator: " ")

                // Call TerminalLauncher directly instead of using socket
                do {
                    try await MainActor.run {
                        try TerminalLauncher.shared.launchOptimizedTerminalSession(
                            workingDirectory: workingDir,
                            command: command,
                            sessionId: sessionId,
                            ttyFwdPath: nil // Use bundled tty-fwd
                        )
                    }

                    logger.info("Terminal spawned successfully with session ID: \(sessionId)")

                    let response = SessionCreatedResponse(
                        success: true,
                        message: "Terminal spawned successfully",
                        sessionId: sessionId
                    )
                    return jsonResponse(response)
                } catch {
                    logger.error("Failed to spawn terminal: \(error)")
                    return errorResponse(
                        message: "Failed to spawn terminal: \(error.localizedDescription)",
                        status: .internalServerError
                    )
                }
            }

            let sessionName = "session_\(Int(Date().timeIntervalSince1970))_\(UUID().uuidString.prefix(9))"
            let cwd = resolvePath(sessionRequest.workingDir ?? "", fallback: FileManager.default.currentDirectoryPath)
            let term = sessionRequest.term ?? "xterm-256color"

            var args = ["--control-path", ttyFwdControlDir, "--session-name", sessionName]
            // Add term environment variable if specified
            if !term.isEmpty {
                args.append(contentsOf: ["--term", term])
            }
            args.append("--")
            args.append(contentsOf: sessionRequest.command)

            logger.info("Creating session: \(args.joined(separator: " "))")

            let process = TTYForwardManager.shared.createTTYForwardProcess(with: args)
            guard let process else {
                return errorResponse(message: "tty-fwd binary not found")
            }

            // Set up pipes to capture stdout for session ID
            let outputPipe = Pipe()
            let errorPipe = Pipe()
            process.standardOutput = outputPipe
            process.standardError = errorPipe

            process.currentDirectoryPath = cwd
            try process.run()

            // Wait for session ID from stdout (similar to Node.js implementation)
            var sessionId: String?
            let outputData = outputPipe.fileHandleForReading.availableData
            if !outputData.isEmpty {
                let output = String(data: outputData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
                if let output, !output.isEmpty {
                    // First line of output should be the session ID (UUID)
                    sessionId = output
                    logger.info("Session created with ID: \(sessionId ?? "unknown")")
                }
            }

            // If we didn't get a session ID, wait a bit and try again
            if sessionId == nil {
                // Wait up to 3 seconds for session ID
                let maxAttempts = 30
                for _ in 0..<maxAttempts {
                    try await Task.sleep(for: .milliseconds(100))

                    let moreData = outputPipe.fileHandleForReading.availableData
                    if !moreData.isEmpty {
                        let output = String(data: moreData, encoding: .utf8)?
                            .trimmingCharacters(in: .whitespacesAndNewlines)
                        if let output, !output.isEmpty {
                            sessionId = output
                            logger.info("Session created with ID: \(sessionId ?? "unknown")")
                            break
                        }
                    }
                }
            }

            guard let finalSessionId = sessionId else {
                logger.error("Failed to get session ID from tty-fwd")
                return errorResponse(message: "Failed to create session - no session ID returned")
            }

            let response = SessionCreatedResponse(
                success: true,
                message: "Session created successfully",
                sessionId: finalSessionId
            )
            return jsonResponse(response)
        } catch {
            logger.error("Error creating session: \(error)")
            return errorResponse(message: "Failed to create session")
        }
    }

    private func killSession(sessionId: String) async -> Response {
        do {
            let output = try await executeTtyFwd(args: ["--control-path", ttyFwdControlDir, "--list-sessions"])
            let sessionsData = output.data(using: .utf8) ?? Data()
            let sessions = try JSONDecoder().decode([String: TtyFwdSession].self, from: sessionsData)

            guard let session = sessions[sessionId] else {
                return errorResponse(message: "Session not found", status: .notFound)
            }

            if session.pid > 0 {
                let pid = pid_t(session.pid)

                // First try SIGTERM for graceful shutdown
                kill(pid, SIGTERM)

                // Wait up to 5 seconds for process to die
                var processExited = false
                for _ in 0..<50 { // 50 * 100ms = 5 seconds
                    try await Task.sleep(for: .milliseconds(100))

                    // Check if process still exists (kill with signal 0)
                    if kill(pid, 0) != 0 {
                        processExited = true
                        break
                    }
                }

                // If process didn't exit, force kill with SIGKILL
                if !processExited {
                    kill(pid, SIGKILL)

                    // Wait a bit more for SIGKILL to take effect
                    for _ in 0..<10 { // 10 * 100ms = 1 second
                        try await Task.sleep(for: .milliseconds(100))
                        if kill(pid, 0) != 0 {
                            processExited = true
                            break
                        }
                    }
                }

                let message = processExited
                    ? "Session killed successfully"
                    : "Session kill signal sent but process may still be running"

                let response = SimpleResponse(success: processExited, message: message)
                return jsonResponse(response)
            }

            let response = SimpleResponse(success: true, message: "Session already exited")
            return jsonResponse(response)
        } catch {
            logger.error("Error killing session: \(error)")
            return errorResponse(message: "Failed to kill session")
        }
    }

    private func cleanupSession(sessionId: String) async -> Response {
        do {
            _ = try await executeTtyFwd(args: ["--control-path", ttyFwdControlDir, "--session", sessionId, "--cleanup"])

            let response = SimpleResponse(success: true, message: "Session cleaned up")
            return jsonResponse(response)
        } catch {
            logger.info("tty-fwd cleanup failed, force removing directory")
            let sessionDir = URL(fileURLWithPath: ttyFwdControlDir).appendingPathComponent(sessionId).path

            do {
                if FileManager.default.fileExists(atPath: sessionDir) {
                    try FileManager.default.removeItem(atPath: sessionDir)
                }
                let response = SimpleResponse(success: true, message: "Session force cleaned up")
                return jsonResponse(response)
            } catch {
                logger.error("Error force removing session directory: \(error)")
                return errorResponse(message: "Failed to cleanup session")
            }
        }
    }

    private func streamSessionOutput(sessionId: String) async -> Response {
        let streamOutPath = URL(fileURLWithPath: ttyFwdControlDir).appendingPathComponent(sessionId)
            .appendingPathComponent("stream-out").path

        guard FileManager.default.fileExists(atPath: streamOutPath) else {
            return errorResponse(message: "Session not found", status: .notFound)
        }

        // Create SSE response with proper headers
        var headers = HTTPFields()
        headers[.contentType] = "text/event-stream"
        headers[.cacheControl] = "no-cache, no-store, must-revalidate"
        headers[.connection] = "keep-alive"
        if let xAccelBuffering = HTTPField.Name("X-Accel-Buffering") {
            headers[xAccelBuffering] = "no" // Disable proxy buffering
        }
        if let accessControlAllowOrigin = HTTPField.Name("Access-Control-Allow-Origin") {
            headers[accessControlAllowOrigin] = "*"
        }

        // Create async sequence for streaming
        let stream = AsyncStream<ByteBuffer> { continuation in
            let task = Task {
                await self.streamFileContents(
                    streamOutPath: streamOutPath,
                    continuation: continuation
                )
            }

            continuation.onTermination = { _ in
                task.cancel()
            }
        }

        return Response(
            status: .ok,
            headers: headers,
            body: ResponseBody(asyncSequence: stream)
        )
    }

    private func streamFileContents(
        streamOutPath: String,
        continuation: AsyncStream<ByteBuffer>.Continuation
    )
        async
    {
        let startTime = Date()
        var headerSent = false
        var fileMonitor: DispatchSourceFileSystemObject?

        defer {
            // Ensure file monitor is cancelled when function exits
            fileMonitor?.cancel()
        }

        // Send initial connection established message
        var initialMessage = ByteBuffer()
        initialMessage.writeString(": connected\n\n")
        continuation.yield(initialMessage)

        // Send existing content first
        do {
            let content = try String(contentsOfFile: streamOutPath, encoding: .utf8)
            let lines = content.components(separatedBy: .newlines)

            for line in lines {
                let trimmedLine = line.trimmingCharacters(in: .whitespaces)
                if !trimmedLine.isEmpty {
                    if let data = trimmedLine.data(using: .utf8),
                       let parsed = try? JSONSerialization.jsonObject(with: data)
                    {
                        if let dict = parsed as? [String: Any],
                           dict["version"] != nil && dict["width"] != nil && dict["height"] != nil
                        {
                            // Send header
                            var buffer = ByteBuffer()
                            buffer.writeString("data: \(trimmedLine)\n\n")
                            continuation.yield(buffer)
                            headerSent = true
                        } else if let array = parsed as? [Any], array.count >= 3 {
                            // Send event with instant timestamp (0)
                            let instantEvent = [0.0, array[1], array[2]]
                            if let eventData = try? JSONSerialization.data(withJSONObject: instantEvent),
                               let eventString = String(data: eventData, encoding: .utf8)
                            {
                                var buffer = ByteBuffer()
                                buffer.writeString("data: \(eventString)\n\n")
                                continuation.yield(buffer)
                            }
                        }
                    }
                }
            }
        } catch {
            logger.error("Error reading existing content: \(error)")
        }

        // Send default header if none found
        if !headerSent {
            let defaultHeader: [String: Any] = [
                "version": 2,
                "width": 80,
                "height": 24,
                "timestamp": Int(startTime.timeIntervalSince1970),
                "env": ["TERM": "xterm-256color"]
            ]

            if let headerData = try? JSONSerialization.data(withJSONObject: defaultHeader),
               let headerString = String(data: headerData, encoding: .utf8)
            {
                var buffer = ByteBuffer()
                buffer.writeString("data: \(headerString)\n\n")
                continuation.yield(buffer)
            }
        }

        // Stream new content by monitoring file changes
        fileMonitor = await monitorFileChanges(
            streamOutPath: streamOutPath,
            startTime: startTime,
            continuation: continuation
        )

        // Keep the stream open until cancelled with periodic heartbeats
        await withTaskCancellationHandler {
            // Send heartbeat every 15 seconds to keep connection alive
            while !Task.isCancelled {
                do {
                    try await Task.sleep(for: .seconds(15))

                    // Send SSE comment as heartbeat (comments start with ':')
                    var heartbeat = ByteBuffer()
                    heartbeat.writeString(": heartbeat\n\n")
                    continuation.yield(heartbeat)
                } catch {
                    // Task was cancelled
                    break
                }
            }
        } onCancel: {
            // fileMonitor?.cancel()
        }

        continuation.finish()
    }

    private func monitorFileChanges(
        streamOutPath: String,
        startTime: Date,
        continuation: AsyncStream<ByteBuffer>.Continuation
    )
        async -> DispatchSourceFileSystemObject?
    {
        // Open file for reading
        let fileDescriptor = open(streamOutPath, O_RDONLY)
        guard fileDescriptor >= 0 else {
            logger.error("Failed to open file for monitoring: \(streamOutPath)")
            return nil
        }

        // Store buffer for incomplete lines
        var lineBuffer = ""

        // Read entire file content from the beginning
        let fileSize = lseek(fileDescriptor, 0, SEEK_END)
        if fileSize > 0 {
            // Seek to beginning
            lseek(fileDescriptor, 0, SEEK_SET)

            // Read entire file content
            let buffer = UnsafeMutablePointer<CChar>.allocate(capacity: Int(fileSize) + 1)
            defer { buffer.deallocate() }

            var totalBytesRead = 0
            while totalBytesRead < fileSize {
                let bytesRead = read(fileDescriptor, buffer + totalBytesRead, Int(fileSize) - totalBytesRead)
                if bytesRead <= 0 { break }
                totalBytesRead += bytesRead
            }

            if totalBytesRead > 0 {
                let data = Data(bytes: buffer, count: totalBytesRead)
                if let initialContent = String(data: data, encoding: .utf8) {
                    lineBuffer = initialContent
                    let lines = lineBuffer.components(separatedBy: .newlines)

                    // Process all complete lines synchronously to maintain order
                    for i in 0..<lines.count - 1 {
                        let line = lines[i]
                        await processNewLine(
                            line: line,
                            startTime: startTime,
                            continuation: continuation
                        )
                    }

                    // Keep the last incomplete line in buffer
                    lineBuffer = lines.last ?? ""
                }
            }
        }

        // Set position to current end for monitoring new content
        var lastReadPosition = lseek(fileDescriptor, 0, SEEK_END)

        // Create dispatch source for monitoring file writes
        let source = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: fileDescriptor,
            eventMask: [.write, .extend],
            queue: DispatchQueue.main
        )

        source.setEventHandler { [weak self] in
            guard let self else { return }

            // Get current file size
            let currentPosition = lseek(fileDescriptor, 0, SEEK_END)

            // Calculate how much new data to read
            let bytesToRead = currentPosition - lastReadPosition
            guard bytesToRead > 0 else { return }

            // Seek to last read position
            lseek(fileDescriptor, lastReadPosition, SEEK_SET)

            // Read new data
            let buffer = UnsafeMutablePointer<CChar>.allocate(capacity: Int(bytesToRead) + 1)
            defer { buffer.deallocate() }

            let bytesRead = read(fileDescriptor, buffer, Int(bytesToRead))
            guard bytesRead > 0 else { return }

            // Convert to string (handle potential UTF-8 boundary issues)
            let data = Data(bytes: buffer, count: bytesRead)
            guard let contentString = String(data: data, encoding: .utf8) else {
                // If UTF-8 decoding fails, it might be due to split multi-byte character
                // Store the bytes and try again with next chunk
                return
            }

            // Update last read position
            lastReadPosition = currentPosition

            // Process new content
            lineBuffer += contentString
            let lines = lineBuffer.components(separatedBy: .newlines)

            // Process all complete lines synchronously to maintain order
            if lines.count > 1 {
                Task { @MainActor in
                    for i in 0..<(lines.count - 1) {
                        let line = lines[i]
                        await self.processNewLine(
                            line: line,
                            startTime: startTime,
                            continuation: continuation
                        )
                    }
                }
                // Keep the last incomplete line in buffer
                lineBuffer = lines.last ?? ""
            }
        }

        source.setCancelHandler {
            close(fileDescriptor)
        }

        // Start monitoring
        source.resume()

        return source
    }

    private func processNewLine(
        line: String,
        startTime: Date,
        continuation: AsyncStream<ByteBuffer>.Continuation
    )
        async
    {
        let trimmedLine = line.trimmingCharacters(in: .whitespaces)

        if let data = trimmedLine.data(using: .utf8),
           let parsed = try? JSONSerialization.jsonObject(with: data)
        {
            // Skip duplicate headers
            if let dict = parsed as? [String: Any],
               dict["version"] != nil && dict["width"] != nil && dict["height"] != nil
            {
                return
            }

            if let array = parsed as? [Any], array.count >= 3 {
                let currentTime = Date()
                let realTimeEvent = [
                    currentTime.timeIntervalSince(startTime),
                    array[1],
                    array[2]
                ]

                if let eventData = try? JSONSerialization.data(withJSONObject: realTimeEvent),
                   let eventString = String(data: eventData, encoding: .utf8)
                {
                    var buffer = ByteBuffer()
                    buffer.writeString("data: \(eventString)\n\n")
                    continuation.yield(buffer)
                }
            }
        } else {
            // Handle non-JSON as raw output
            let currentTime = Date()
            let castEvent: [Any] = [
                currentTime.timeIntervalSince(startTime),
                "o",
                trimmedLine
            ]

            if let eventData = try? JSONSerialization.data(withJSONObject: castEvent),
               let eventString = String(data: eventData, encoding: .utf8)
            {
                var buffer = ByteBuffer()
                buffer.writeString("data: \(eventString)\n\n")
                continuation.yield(buffer)
            }
        }
    }

    private func getSessionSnapshot(sessionId: String) async -> Response {
        let streamOutPath = URL(fileURLWithPath: ttyFwdControlDir).appendingPathComponent(sessionId)
            .appendingPathComponent("stream-out").path

        guard FileManager.default.fileExists(atPath: streamOutPath) else {
            return errorResponse(message: "Session not found", status: .notFound)
        }

        do {
            let content = try String(contentsOfFile: streamOutPath, encoding: .utf8)
            let optimizedContent = optimizeSnapshotContent(content)

            var buffer = ByteBuffer()
            buffer.writeString(optimizedContent)

            return Response(
                status: .ok,
                headers: [.contentType: "text/plain"],
                body: ResponseBody(byteBuffer: buffer)
            )
        } catch {
            logger.error("Error reading session snapshot: \(error)")
            return errorResponse(message: "Failed to read session snapshot")
        }
    }

    /// Optimizes snapshot content by finding the last clear screen command and returning
    /// only the content after it, similar to the Rust implementation.
    private func optimizeSnapshotContent(_ content: String) -> String {
        guard !content.isEmpty else { return content }

        var lastClearPos: String.Index?
        let lines = content.components(separatedBy: .newlines)
        var optimizedLines: [String] = []

        // Process lines to find asciinema events
        for line in lines {
            let trimmedLine = line.trimmingCharacters(in: .whitespaces)
            guard !trimmedLine.isEmpty else { continue }

            // Try to parse as JSON array (asciinema event format)
            if let data = trimmedLine.data(using: .utf8),
               let parsed = try? JSONSerialization.jsonObject(with: data) as? [Any],
               parsed.count >= 3,
               let outputString = parsed[2] as? String
            {
                // Check for clear screen sequences
                if outputString.contains("\u{001b}[H\u{001b}[2J") || // ESC[H ESC[2J
                    outputString.contains("\u{001b}[2J") || // ESC[2J
                    outputString.contains("\u{001b}[3J") || // ESC[3J
                    outputString.contains("\u{001b}c")
                { // ESC c
                    // Found clear screen, mark this position
                    lastClearPos = line.endIndex
                    optimizedLines.removeAll() // Clear accumulated lines
                }
            }

            optimizedLines.append(line)
        }

        // If we found a clear screen, return only content after it
        if lastClearPos != nil {
            return optimizedLines.joined(separator: "\n")
        }

        // No clear screen found, return original content
        return content
    }

    private func getSessionCast(sessionId: String) async -> Response {
        let streamOutPath = URL(fileURLWithPath: ttyFwdControlDir).appendingPathComponent(sessionId)
            .appendingPathComponent("stream-out").path

        guard FileManager.default.fileExists(atPath: streamOutPath) else {
            return errorResponse(message: "Session not found", status: .notFound)
        }

        do {
            // Get session info to extract command and title
            let sessionInfoOutput = try await executeTtyFwd(args: [
                "--control-path",
                ttyFwdControlDir,
                "--list-sessions"
            ])

            var sessionCommand: String?
            var sessionTitle: String?

            if let sessionData = sessionInfoOutput.data(using: .utf8),
               let sessions = try? JSONDecoder().decode([String: TtyFwdSession].self, from: sessionData),
               let session = sessions[sessionId]
            {
                sessionCommand = session.cmdline.joined(separator: " ")
                sessionTitle = "VibeTunnel Session: \(session.name)"
            }

            // Generate cast file
            let castGenerator = CastFileGenerator()
            let castData = try castGenerator.generateCastFile(
                sessionId: sessionId,
                streamOutPath: streamOutPath,
                width: 80,
                height: 24,
                title: sessionTitle,
                command: sessionCommand
            )

            var buffer = ByteBuffer()
            buffer.writeBytes(castData)

            return Response(
                status: .ok,
                headers: [
                    .contentType: "application/x-asciicast",
                    .contentDisposition: "attachment; filename=\"\(sessionId).cast\""
                ],
                body: ResponseBody(byteBuffer: buffer)
            )
        } catch {
            logger.error("Error generating cast file: \(error)")
            return errorResponse(message: "Failed to generate cast file")
        }
    }

    private func sendSessionInput(request: Request, sessionId: String) async -> Response {
        do {
            let buffer = try await request.body.collect(upTo: 1_024 * 1_024)
            let requestData = Data(buffer: buffer)

            struct InputRequest: Codable {
                let text: String?
            }

            let inputRequest = try JSONDecoder().decode(InputRequest.self, from: requestData)

            // Validate text is provided
            guard let text = inputRequest.text else {
                return errorResponse(message: "Text is required", status: .badRequest)
            }

            logger.info("Sending input to session \(sessionId): \(text)")

            // Validate session exists and is running
            let sessionInfoOutput = try await executeTtyFwd(args: [
                "--control-path",
                ttyFwdControlDir,
                "--list-sessions"
            ])

            guard let sessionData = sessionInfoOutput.data(using: .utf8),
                  let sessions = try? JSONDecoder().decode([String: TtyFwdSession].self, from: sessionData),
                  let session = sessions[sessionId]
            else {
                logger.error("Session \(sessionId) not found in active sessions")
                return errorResponse(message: "Session not found", status: .notFound)
            }

            // Check if session is running
            if session.status != "running" {
                logger.error("Session \(sessionId) is not running (status: \(session.status))")
                return errorResponse(message: "Session is not running", status: .badRequest)
            }

            // Check if the process is actually still alive
            if session.pid > 0 {
                let processExists = kill(pid_t(session.pid), 0) == 0
                if !processExists {
                    logger.error("Session \(sessionId) process \(session.pid) is dead, cleaning up")

                    // Try to cleanup the stale session
                    do {
                        _ = try await executeTtyFwd(args: [
                            "--control-path",
                            ttyFwdControlDir,
                            "--session",
                            sessionId,
                            "--cleanup"
                        ])
                    } catch {
                        logger.error("Failed to cleanup stale session: \(error)")
                    }

                    return errorResponse(message: "Session process has died", status: HTTPResponse.Status(code: 410))
                }
            }

            let specialKeys = [
                "arrow_up",
                "arrow_down",
                "arrow_left",
                "arrow_right",
                "escape",
                "enter",
                "ctrl_enter",
                "shift_enter"
            ]
            let isSpecialKey = specialKeys.contains(text)

            let startTime = Date()

            if isSpecialKey {
                _ = try await executeTtyFwd(args: [
                    "--control-path",
                    ttyFwdControlDir,
                    "--session",
                    sessionId,
                    "--send-key",
                    text
                ])
                let elapsed = Date().timeIntervalSince(startTime) * 1_000
                logger.info("Successfully sent key: \(text) (\(Int(elapsed))ms)")
            } else {
                _ = try await executeTtyFwd(args: [
                    "--control-path",
                    ttyFwdControlDir,
                    "--session",
                    sessionId,
                    "--send-text",
                    text
                ])
                let elapsed = Date().timeIntervalSince(startTime) * 1_000
                logger.info("Successfully sent text: \(text) (\(Int(elapsed))ms)")
            }

            struct SuccessResponse: Codable {
                let success: Bool
                let message: String
            }

            let response = SuccessResponse(success: true, message: "Input sent successfully")
            return jsonResponse(response)
        } catch let decodingError as DecodingError {
            logger.error("Error decoding input request: \(decodingError)")
            return errorResponse(message: "Invalid request format", status: .badRequest)
        } catch {
            logger.error("Error sending input via tty-fwd: \(error)")
            let errorMessage = error.localizedDescription
            return errorResponse(message: "Failed to send input: \(errorMessage)", status: .internalServerError)
        }
    }

    private func cleanupExitedSessions() async -> Response {
        do {
            _ = try await executeTtyFwd(args: ["--control-path", ttyFwdControlDir, "--cleanup"])

            let response = SimpleResponse(success: true, message: "All exited sessions cleaned up")
            return jsonResponse(response)
        } catch {
            logger.error("Error cleaning up exited sessions: \(error)")
            return errorResponse(message: "Failed to cleanup exited sessions")
        }
    }

    private func browseFileSystem(request: Request) async -> Response {
        let dirPath = String(request.uri.queryParameters.first { $0.key == "path" }?.value ?? "~")

        do {
            let expandedPath = resolvePath(dirPath, fallback: "~")

            guard FileManager.default.fileExists(atPath: expandedPath) else {
                return errorResponse(message: "Directory not found", status: .notFound)
            }

            var isDirectory: ObjCBool = false
            FileManager.default.fileExists(atPath: expandedPath, isDirectory: &isDirectory)

            guard isDirectory.boolValue else {
                return errorResponse(message: "Path is not a directory", status: .badRequest)
            }

            let fileNames = try FileManager.default.contentsOfDirectory(atPath: expandedPath)
            let files = try fileNames.compactMap { name -> FileInfo? in
                let filePath = URL(fileURLWithPath: expandedPath).appendingPathComponent(name).path
                let attributes = try FileManager.default.attributesOfItem(atPath: filePath)

                let isDir = (attributes[.type] as? FileAttributeType) == .typeDirectory
                let size = attributes[.size] as? Int64 ?? 0
                let created = attributes[.creationDate] as? Date ?? Date()
                let modified = attributes[.modificationDate] as? Date ?? Date()

                let formatter = ISO8601DateFormatter()

                return FileInfo(
                    name: name,
                    created: formatter.string(from: created),
                    lastModified: formatter.string(from: modified),
                    size: size,
                    isDir: isDir
                )
            }
            .sorted { first, second in
                if first.isDir && !second.isDir { return true }
                if !first.isDir && second.isDir { return false }
                return first.name.localizedCompare(second.name) == .orderedAscending
            }

            let listing = DirectoryListing(absolutePath: expandedPath, files: files)
            return jsonResponse(listing)
        } catch {
            logger.error("Error listing directory: \(error)")
            return errorResponse(message: "Failed to list directory")
        }
    }

    private func createDirectory(request: Request) async -> Response {
        do {
            let buffer = try await request.body.collect(upTo: 1_024 * 1_024) // 1MB limit
            let requestData = Data(buffer: buffer)

            struct MkdirRequest: Codable {
                let path: String
            }

            let mkdirRequest = try JSONDecoder().decode(MkdirRequest.self, from: requestData)

            if mkdirRequest.path.isEmpty {
                return errorResponse(message: "Path cannot be empty", status: .badRequest)
            }

            let expandedPath = resolvePath(mkdirRequest.path, fallback: mkdirRequest.path)

            try FileManager.default.createDirectory(
                atPath: expandedPath,
                withIntermediateDirectories: true,
                attributes: nil
            )

            let response = SimpleResponse(
                success: true,
                message: "Directory created successfully"
            )

            return jsonResponse(response)
        } catch let decodingError as DecodingError {
            logger.error("Error decoding mkdir request: \(decodingError)")
            return errorResponse(message: "Invalid request body. Expected JSON with 'path' field", status: .badRequest)
        } catch {
            logger.error("Error creating directory: \(error)")
            return errorResponse(
                message: "Failed to create directory: \(error.localizedDescription)",
                status: .internalServerError
            )
        }
    }

    // MARK: - ngrok Integration

    private func startNgrokTunnel() async -> Response {
        do {
            let publicUrl = try await ngrokService.start(port: self.port)

            struct NgrokStartResponse: Codable {
                let success: Bool
                let publicUrl: String
                let message: String
            }

            let response = NgrokStartResponse(
                success: true,
                publicUrl: publicUrl,
                message: "ngrok tunnel started successfully"
            )

            return jsonResponse(response)
        } catch {
            logger.error("Failed to start ngrok tunnel: \(error)")
            return errorResponse(message: error.localizedDescription)
        }
    }

    private func stopNgrokTunnel() async -> Response {
        do {
            try await ngrokService.stop()

            let response = SimpleResponse(
                success: true,
                message: "ngrok tunnel stopped successfully"
            )

            return jsonResponse(response)
        } catch {
            logger.error("Failed to stop ngrok tunnel: \(error)")
            return errorResponse(message: error.localizedDescription)
        }
    }

    private func getNgrokStatus() async -> Response {
        struct NgrokStatusResponse: Codable {
            let isActive: Bool
            let publicUrl: String?
            let status: NgrokTunnelStatus?
        }

        let isActive = await ngrokService.isRunning()
        let status = await ngrokService.getStatus()

        let response = NgrokStatusResponse(
            isActive: isActive,
            publicUrl: ngrokService.publicUrl,
            status: status
        )

        return jsonResponse(response)
    }

    // MARK: - Multi-stream Sessions

    private func multiStreamSessions(request: Request) async -> Response {
        logger.info("Starting multiplex streaming with dynamic session discovery")

        // Create SSE response headers
        var headers = HTTPFields()
        headers[.contentType] = "text/event-stream"
        headers[.cacheControl] = "no-cache, no-store, must-revalidate"
        headers[.connection] = "keep-alive"
        if let xAccelBuffering = HTTPField.Name("X-Accel-Buffering") {
            headers[xAccelBuffering] = "no"
        }
        if let accessControlAllowOrigin = HTTPField.Name("Access-Control-Allow-Origin") {
            headers[accessControlAllowOrigin] = "*"
        }

        // Create async sequence for streaming multiple sessions
        let stream = AsyncStream<ByteBuffer> { continuation in
            let task = Task {
                await self.streamMultipleSessions(continuation: continuation)
            }

            continuation.onTermination = { _ in
                task.cancel()
            }
        }

        return Response(
            status: .ok,
            headers: headers,
            body: ResponseBody(asyncSequence: stream)
        )
    }

    private func streamMultipleSessions(continuation: AsyncStream<ByteBuffer>.Continuation) async {
        // Send initial connection message
        var initialMessage = ByteBuffer()
        initialMessage.writeString(": connected\n\n")
        continuation.yield(initialMessage)

        // Track active sessions
        var activeSessions = Set<String>()
        let sessionTasks = SessionTaskManager()

        // Monitor for new sessions
        let monitorTask = Task {
            while !Task.isCancelled {
                do {
                    // List all sessions
                    let sessionsOutput = try await executeTtyFwd(args: [
                        "--control-path",
                        ttyFwdControlDir,
                        "--list-sessions"
                    ])

                    if let sessionData = sessionsOutput.data(using: .utf8),
                       let sessions = try? JSONDecoder().decode([String: TtyFwdSession].self, from: sessionData)
                    {
                        // Start streaming for new sessions
                        for (sessionId, _) in sessions {
                            if !activeSessions.contains(sessionId) {
                                activeSessions.insert(sessionId)
                                logger.info("Starting stream for new session: \(sessionId)")

                                // Create task for this session
                                let task = Task {
                                    await self.streamSessionForMultiplex(
                                        sessionId: sessionId,
                                        continuation: continuation
                                    )
                                }
                                await sessionTasks.add(sessionId: sessionId, task: task)
                            }
                        }

                        // Clean up completed sessions
                        activeSessions = activeSessions.filter { sessions.keys.contains($0) }
                    }

                    // Check every second
                    try await Task.sleep(for: .seconds(1))
                } catch {
                    if !Task.isCancelled {
                        logger.error("Error monitoring sessions: \(error)")
                    }
                    break
                }
            }
        }

        // Keep streaming until cancelled
        await withTaskCancellationHandler {
            while !Task.isCancelled {
                do {
                    try await Task.sleep(for: .seconds(15))

                    // Send heartbeat
                    var heartbeat = ByteBuffer()
                    heartbeat.writeString(": heartbeat\n\n")
                    continuation.yield(heartbeat)
                } catch {
                    break
                }
            }
        } onCancel: {
            monitorTask.cancel()

            // Cancel all session tasks in a new task
            Task {
                await sessionTasks.cancelAll()
            }
        }

        continuation.finish()
    }

    private func streamSessionForMultiplex(
        sessionId: String,
        continuation: AsyncStream<ByteBuffer>.Continuation
    )
        async
    {
        let streamOutPath = URL(fileURLWithPath: ttyFwdControlDir)
            .appendingPathComponent(sessionId)
            .appendingPathComponent("stream-out").path

        guard FileManager.default.fileExists(atPath: streamOutPath) else {
            return
        }

        // Read and forward events from this session
        do {
            let fileHandle = try FileHandle(forReadingFrom: URL(fileURLWithPath: streamOutPath))
            defer { fileHandle.closeFile() }

            var buffer = ""

            while !Task.isCancelled {
                let data = fileHandle.availableData
                guard !data.isEmpty else {
                    try await Task.sleep(for: .milliseconds(100))
                    continue
                }

                if let content = String(data: data, encoding: .utf8) {
                    buffer += content
                    let lines = buffer.components(separatedBy: .newlines)

                    // Process complete lines
                    for i in 0..<(lines.count - 1) {
                        let line = lines[i]
                        let trimmedLine = line.trimmingCharacters(in: .whitespaces)

                        if !trimmedLine.isEmpty {
                            // Create prefixed event: sessionId:event
                            let prefixedEvent = "\(sessionId):\(trimmedLine)"

                            var eventBuffer = ByteBuffer()
                            eventBuffer.writeString("data: \(prefixedEvent)\n\n")
                            continuation.yield(eventBuffer)
                        }
                    }

                    // Keep incomplete line in buffer
                    buffer = lines.last ?? ""
                }
            }
        } catch {
            logger.error("Error streaming session \(sessionId): \(error)")
        }
    }
}
