import Foundation
import Logging

/// Holds pipes for a terminal session.
///
/// Encapsulates the standard I/O pipes used for communicating
/// with a terminal process.
private struct SessionPipes {
    let stdin: Pipe
    let stdout: Pipe
    let stderr: Pipe
}

/// Manages terminal sessions and command execution.
///
/// An actor that handles the lifecycle of terminal sessions, including
/// process creation, I/O handling, and command execution. Provides
/// thread-safe management of multiple concurrent terminal sessions.
actor TerminalManager {
    private var sessions: [UUID: TunnelSession] = [:]
    private var processes: [UUID: Process] = [:]
    private var pipes: [UUID: SessionPipes] = [:]
    private let logger = Logger(label: "VibeTunnel.TerminalManager")

    /// Create a new terminal session
    func createSession(request: CreateSessionRequest) throws -> TunnelSession {
        let session = TunnelSession()
        sessions[session.id] = session

        // Set up process and pipes
        let process = Process()
        let stdinPipe = Pipe()
        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()

        // Configure the process
        process.executableURL = URL(fileURLWithPath: request.shell ?? FilePathConstants.defaultShell)
        process.standardInput = stdinPipe
        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe

        if let workingDirectory = request.workingDirectory {
            process.currentDirectoryURL = URL(fileURLWithPath: workingDirectory)
        }

        if let environment = request.environment {
            process.environment = ProcessInfo.processInfo.environment.merging(environment) { _, new in new }
        }

        // Start the process
        do {
            try process.run()
            processes[session.id] = process
            pipes[session.id] = SessionPipes(stdin: stdinPipe, stdout: stdoutPipe, stderr: stderrPipe)

            logger.info("Created session \(session.id) with process \(process.processIdentifier)")
        } catch {
            sessions.removeValue(forKey: session.id)
            throw error
        }

        return session
    }

    /// Execute a command in a session
    func executeCommand(sessionId: UUID, command: String) async throws -> (output: String, error: String) {
        guard var session = sessions[sessionId],
              let process = processes[sessionId],
              let sessionPipes = pipes[sessionId],
              process.isRunning
        else {
            throw TunnelError.sessionNotFound
        }

        // Update session activity
        session.updateActivity()
        sessions[sessionId] = session

        // Send command to stdin
        guard let commandData = (command + "\n").data(using: .utf8) else {
            throw TunnelError.commandExecutionFailed("Failed to encode command")
        }
        sessionPipes.stdin.fileHandleForWriting.write(commandData)

        // Read output with timeout
        let outputData = try await withTimeout(seconds: 5) {
            sessionPipes.stdout.fileHandleForReading.availableData
        }

        let errorData = try await withTimeout(seconds: 0.1) {
            sessionPipes.stderr.fileHandleForReading.availableData
        }

        let output = String(data: outputData, encoding: .utf8) ?? ""
        let error = String(data: errorData, encoding: .utf8) ?? ""

        return (output, error)
    }

    /// Get all active sessions
    func listSessions() -> [TunnelSession] {
        Array(sessions.values)
    }

    /// Get a specific session
    func getSession(id: UUID) -> TunnelSession? {
        sessions[id]
    }

    /// Close a session
    func closeSession(id: UUID) {
        if let process = processes[id] {
            process.terminate()
            processes.removeValue(forKey: id)
        }
        pipes.removeValue(forKey: id)
        sessions.removeValue(forKey: id)

        logger.info("Closed session \(id)")
    }

    /// Clean up inactive sessions
    func cleanupInactiveSessions(olderThan minutes: Int = 30) {
        let cutoffDate = Date().addingTimeInterval(-Double(minutes * 60))

        for (id, session) in sessions where session.lastActivity < cutoffDate {
            closeSession(id: id)
            logger.info("Cleaned up inactive session \(id)")
        }
    }

    /// Helper function for timeout
    private func withTimeout<T: Sendable>(
        seconds: TimeInterval,
        operation: @escaping @Sendable () async throws -> T
    )
        async throws -> T
    {
        try await withThrowingTaskGroup(of: T.self) { group in
            group.addTask {
                try await operation()
            }

            group.addTask {
                try await Task.sleep(for: .seconds(seconds))
                throw TunnelError.timeout
            }

            guard let result = try await group.next() else {
                throw TunnelError.timeout
            }
            group.cancelAll()
            return result
        }
    }
}

/// Errors that can occur in tunnel operations.
///
/// Represents various failure modes in terminal session management
/// including missing sessions, execution failures, and timeouts.
enum TunnelError: LocalizedError, Equatable {
    case sessionNotFound
    case commandExecutionFailed(String)
    case timeout
    case invalidRequest

    var errorDescription: String? {
        switch self {
        case .sessionNotFound:
            ErrorMessages.sessionNotFound
        case .commandExecutionFailed(let message):
            "Command execution failed: \(message)"
        case .timeout:
            ErrorMessages.operationTimeout
        case .invalidRequest:
            ErrorMessages.invalidRequest
        }
    }
}
