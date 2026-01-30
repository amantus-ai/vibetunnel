import Foundation

/// Represents a terminal session that can be controlled remotely.
///
/// A `TunnelSession` encapsulates the state and metadata of a terminal session
/// that can be accessed through the web interface. Each session has a unique identifier,
/// creation timestamp, and tracks its activity status.
public struct TunnelSession: Identifiable, Codable, Sendable {
    public let id: UUID
    public let createdAt: Date
    public var lastActivity: Date
    public let processID: Int32?
    public var isActive: Bool

    public init(id: UUID = UUID(), processID: Int32? = nil) {
        self.id = id
        self.createdAt = Date()
        self.lastActivity = Date()
        self.processID = processID
        self.isActive = true
    }

    public mutating func updateActivity() {
        self.lastActivity = Date()
    }
}

/// Request to create a new terminal session.
///
/// Contains optional configuration for initializing a new terminal session,
/// including working directory, environment variables, and shell preference.
public struct CreateSessionRequest: Codable, Sendable {
    public let workingDirectory: String?
    public let environment: [String: String]?
    public let shell: String?

    public init(workingDirectory: String? = nil, environment: [String: String]? = nil, shell: String? = nil) {
        self.workingDirectory = workingDirectory
        self.environment = environment
        self.shell = shell
    }
}

/// Response after creating a session.
///
/// Contains the newly created session's identifier and timestamp.
public struct CreateSessionResponse: Codable, Sendable {
    public let sessionId: String
    public let createdAt: Date

    public init(sessionId: String, createdAt: Date) {
        self.sessionId = sessionId
        self.createdAt = createdAt
    }
}

/// Command execution request.
///
/// Encapsulates a command to be executed within a specific terminal session,
/// with optional arguments and environment variables.
public struct CommandRequest: Codable, Sendable {
    public let sessionId: String
    public let command: String
    public let args: [String]?
    public let environment: [String: String]?

    public init(sessionId: String, command: String, args: [String]? = nil, environment: [String: String]? = nil) {
        self.sessionId = sessionId
        self.command = command
        self.args = args
        self.environment = environment
    }
}

/// Command execution response.
///
/// Contains the results of a command execution including output streams,
/// exit code, and execution timestamp.
public struct CommandResponse: Codable, Sendable {
    public let sessionId: String
    public let output: String?
    public let error: String?
    public let exitCode: Int32?
    public let timestamp: Date

    public init(
        sessionId: String,
        output: String? = nil,
        error: String? = nil,
        exitCode: Int32? = nil,
        timestamp: Date = Date())
    {
        self.sessionId = sessionId
        self.output = output
        self.error = error
        self.exitCode = exitCode
        self.timestamp = timestamp
    }
}

/// Session information.
///
/// Provides a summary of a terminal session's current state and activity.
public struct SessionInfo: Codable, Sendable {
    public let id: String
    public let createdAt: Date
    public let lastActivity: Date
    public let isActive: Bool

    public init(id: String, createdAt: Date, lastActivity: Date, isActive: Bool) {
        self.id = id
        self.createdAt = createdAt
        self.lastActivity = lastActivity
        self.isActive = isActive
    }
}

/// List sessions response.
///
/// Contains an array of all available terminal sessions.
public struct ListSessionsResponse: Codable, Sendable {
    public let sessions: [SessionInfo]

    public init(sessions: [SessionInfo]) {
        self.sessions = sessions
    }
}

extension TunnelSession {
    /// Client information for session creation.
    ///
    /// Contains metadata about the client system creating a session,
    /// including hostname, user details, and system architecture.
    public struct ClientInfo: Codable, Sendable {
        public let hostname: String
        public let username: String
        public let homeDirectory: String
        public let operatingSystem: String
        public let architecture: String

        public init(
            hostname: String,
            username: String,
            homeDirectory: String,
            operatingSystem: String,
            architecture: String)
        {
            self.hostname = hostname
            self.username = username
            self.homeDirectory = homeDirectory
            self.operatingSystem = operatingSystem
            self.architecture = architecture
        }
    }

    /// Request to create a new session.
    ///
    /// Wraps optional client information for session initialization.
    public struct CreateRequest: Codable, Sendable {
        public let clientInfo: ClientInfo?

        public init(clientInfo: ClientInfo? = nil) {
            self.clientInfo = clientInfo
        }
    }

    /// Response after creating a session.
    ///
    /// Contains both the session identifier and full session object.
    public struct CreateResponse: Codable, Sendable {
        public let id: String
        public let session: TunnelSession

        public init(id: String, session: TunnelSession) {
            self.id = id
            self.session = session
        }
    }

    /// Request to execute a command.
    ///
    /// Specifies a command to run in a terminal session with optional
    /// environment variables and working directory.
    public struct ExecuteCommandRequest: Codable, Sendable {
        public let sessionId: String
        public let command: String
        public let environment: [String: String]?
        public let workingDirectory: String?

        public init(
            sessionId: String,
            command: String,
            environment: [String: String]? = nil,
            workingDirectory: String? = nil)
        {
            self.sessionId = sessionId
            self.command = command
            self.environment = environment
            self.workingDirectory = workingDirectory
        }
    }

    /// Response from command execution.
    ///
    /// Contains the command's exit code and captured output streams.
    public struct ExecuteCommandResponse: Codable, Sendable {
        public let exitCode: Int32
        public let stdout: String
        public let stderr: String

        public init(exitCode: Int32, stdout: String, stderr: String) {
            self.exitCode = exitCode
            self.stdout = stdout
            self.stderr = stderr
        }
    }

    /// List sessions response.
    ///
    /// Contains an array of all active tunnel sessions.
    public struct ListResponse: Codable, Sendable {
        public let sessions: [TunnelSession]

        public init(sessions: [TunnelSession]) {
            self.sessions = sessions
        }
    }

    /// Error response from server.
    ///
    /// Standardized error format with message and optional error code.
    public struct ErrorResponse: Codable, Sendable {
        public let error: String
        public let code: String?

        public init(error: String, code: String? = nil) {
            self.error = error
            self.code = code
        }
    }
}
