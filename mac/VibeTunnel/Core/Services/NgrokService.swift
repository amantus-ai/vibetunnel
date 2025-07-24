import Foundation
import Observation
import os

/// Errors that can occur during ngrok operations.
///
/// Represents various failure modes when working with ngrok tunnels,
/// from installation issues to runtime configuration problems.
enum NgrokError: LocalizedError, Equatable {
    case notInstalled
    case authTokenMissing
    case tunnelCreationFailed(String)
    case invalidConfiguration
    case networkError(String)

    var errorDescription: String? {
        switch self {
        case .notInstalled:
            ErrorMessages.ngrokNotInstalled
        case .authTokenMissing:
            ErrorMessages.ngrokAuthTokenMissing
        case .tunnelCreationFailed(let message):
            "Failed to create tunnel: \(message)"
        case .invalidConfiguration:
            ErrorMessages.invalidNgrokConfiguration
        case .networkError(let message):
            "Network error: \(message)"
        }
    }
}

/// Represents the status of an ngrok tunnel.
///
/// Contains the current state of an active ngrok tunnel including
/// its public URL, traffic metrics, and creation timestamp.
struct NgrokTunnelStatus: Codable {
    let publicUrl: String
    let metrics: TunnelMetrics
    let startedAt: Date
}

/// Protocol for ngrok tunnel operations.
///
/// Defines the interface for managing ngrok tunnel lifecycle,
/// including creation, monitoring, and termination.
protocol NgrokTunnelProtocol {
    func start(port: Int) async throws -> String
    func stop() async throws
    func getStatus() async -> NgrokTunnelStatus?
    func isRunning() async -> Bool
}

/// Manages ngrok tunnel lifecycle and configuration.
///
/// `NgrokService` provides a high-level interface for creating and managing ngrok tunnels
/// to expose local VibeTunnel servers to the internet. It handles authentication,
/// process management, and status monitoring while integrating with the system keychain
/// for secure token storage. The service operates as a singleton on the main actor.
@Observable
@MainActor
final class NgrokService: NgrokTunnelProtocol {
    static let shared = NgrokService()

    /// Current tunnel status
    private(set) var tunnelStatus: NgrokTunnelStatus?

    /// Indicates if a tunnel is currently active
    private(set) var isActive = false

    /// The public URL of the active tunnel
    private(set) var publicUrl: String?

    /// Auth token for ngrok (stored securely in Keychain)
    var authToken: String? {
        get {
            let token = KeychainHelper.getNgrokAuthToken()
            logger.info("Getting auth token from keychain: \(token != nil ? "present" : "nil")")
            return token
        }
        set {
            logger.info("Setting auth token in keychain: \(newValue != nil ? "present" : "nil")")
            if let token = newValue {
                KeychainHelper.setNgrokAuthToken(token)
            } else {
                KeychainHelper.deleteNgrokAuthToken()
            }
        }
    }

    /// Check if auth token exists without triggering keychain prompt
    var hasAuthToken: Bool {
        KeychainHelper.hasNgrokAuthToken()
    }

    /// The ngrok process if using CLI mode
    private var ngrokProcess: Process?

    /// Task for periodic status updates
    private var statusTask: Task<Void, Never>?

    private let logger = Logger(subsystem: BundleIdentifiers.main, category: "NgrokService")

    private init() {}

    /// Starts an ngrok tunnel for the specified port
    func start(port: Int) async throws -> String {
        logger.info("Starting ngrok tunnel on port \(port)")

        guard let authToken, !authToken.isEmpty else {
            logger.error("Auth token is missing")
            throw NgrokError.authTokenMissing
        }

        logger.info("Auth token is present, proceeding with CLI start")

        // For now, we'll use the ngrok CLI approach
        // Later we can switch to the SDK when available
        return try await startWithCLI(port: port)
    }

    /// Stops the active ngrok tunnel
    func stop() async throws {
        logger.info("Stopping ngrok tunnel")

        if let process = ngrokProcess {
            process.terminate()
            ngrokProcess = nil
        }

        statusTask?.cancel()
        statusTask = nil

        isActive = false
        publicUrl = nil
        tunnelStatus = nil
    }

    /// Gets the current tunnel status
    func getStatus() async -> NgrokTunnelStatus? {
        tunnelStatus
    }

    /// Checks if a tunnel is currently running
    func isRunning() async -> Bool {
        isActive && ngrokProcess?.isRunning == true
    }

    // MARK: - Private Methods

    /// Starts ngrok using the CLI
    private func startWithCLI(port: Int) async throws -> String {
        // Check if ngrok is installed
        let checkProcess = Process()
        checkProcess.executableURL = URL(fileURLWithPath: FilePathConstants.which)
        checkProcess.arguments = ["ngrok"]

        // Add common Homebrew paths to PATH for the check
        var environment = ProcessInfo.processInfo.environment
        let currentPath = environment[EnvironmentKeys.path] ?? "\(FilePathConstants.usrBin):\(FilePathConstants.bin)"
        let homebrewPaths = "\(FilePathConstants.optHomebrewBin):\(FilePathConstants.usrLocalBin)"
        environment[EnvironmentKeys.path] = "\(homebrewPaths):\(currentPath)"
        checkProcess.environment = environment

        let checkPipe = Pipe()
        checkProcess.standardOutput = checkPipe
        checkProcess.standardError = Pipe()

        do {
            try checkProcess.run()
            checkProcess.waitUntilExit()

            let ngrokPath: String?
            do {
                if let data = try checkPipe.fileHandleForReading.readToEnd() {
                    ngrokPath = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
                } else {
                    ngrokPath = nil
                }
            } catch {
                logger.debug("Could not read ngrok path: \(error.localizedDescription)")
                ngrokPath = nil
            }

            guard let ngrokPath, !ngrokPath.isEmpty else {
                throw NgrokError.notInstalled
            }

            // Set up ngrok with auth token
            let authProcess = Process()
            authProcess.executableURL = URL(fileURLWithPath: ngrokPath)
            guard let authToken else {
                throw NgrokError.authTokenMissing
            }
            authProcess.arguments = ["config", "add-authtoken", authToken]

            try authProcess.run()
            authProcess.waitUntilExit()

            // Start ngrok tunnel
            let process = Process()
            process.executableURL = URL(fileURLWithPath: ngrokPath)
            process.arguments = ["http", "\(port)", "--log=stdout", "--log-format=json"]

            let outputPipe = Pipe()
            process.standardOutput = outputPipe
            process.standardError = Pipe()

            // Monitor output for the public URL
            let outputHandle = outputPipe.fileHandleForReading

            _ = false // publicUrlFound - removed as unused
            let urlExpectation = Task<String, Error> {
                for try await line in outputHandle.lines {
                    if let data = line.data(using: .utf8),
                       let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
                    {
                        // Look for tunnel established message
                        if let msg = json["msg"] as? String,
                           msg.contains("started tunnel"),
                           let url = json["url"] as? String
                        {
                            return url
                        }

                        // Alternative: look for public URL in addr field
                        if let addr = json["addr"] as? String,
                           addr.starts(with: "https://")
                        {
                            return addr
                        }
                    }
                }
                throw NgrokError.tunnelCreationFailed(ErrorMessages.ngrokPublicURLNotFound)
            }

            try process.run()
            self.ngrokProcess = process

            // Wait for URL with timeout
            let url = try await withTimeout(seconds: 10) {
                try await urlExpectation.value
            }

            self.publicUrl = url
            self.isActive = true

            // Start monitoring tunnel status
            startStatusMonitoring()

            logger.info("ngrok tunnel started: \(url)")
            return url
        } catch {
            logger.error("Failed to start ngrok: \(error)")
            throw error
        }
    }

    /// Monitors tunnel status periodically
    private func startStatusMonitoring() {
        statusTask?.cancel()

        statusTask = Task { @MainActor in
            while !Task.isCancelled {
                await self.updateTunnelStatus()
                try? await Task.sleep(nanoseconds: 5_000_000_000) // 5 seconds
            }
        }
    }

    /// Updates the current tunnel status
    private func updateTunnelStatus() async {
        // In a real implementation, we would query ngrok's API
        // For now, just check if the process is still running
        if let process = ngrokProcess, process.isRunning {
            if tunnelStatus == nil {
                tunnelStatus = NgrokTunnelStatus(
                    publicUrl: publicUrl ?? "",
                    metrics: TunnelMetrics(connectionsCount: 0, bytesIn: 0, bytesOut: 0),
                    startedAt: Date()
                )
            }
        } else {
            isActive = false
            publicUrl = nil
            tunnelStatus = nil
        }
    }

    /// Executes an async task with a timeout
    private func withTimeout<T: Sendable>(
        seconds: TimeInterval,
        operation: @Sendable @escaping () async throws -> T
    )
        async throws -> T
    {
        try await withThrowingTaskGroup(of: T.self) { group in
            group.addTask {
                try await operation()
            }

            group.addTask {
                try await Task.sleep(for: .seconds(seconds))
                throw NgrokError.networkError("Operation timed out")
            }

            guard let result = try await group.next() else {
                throw NgrokError.networkError("No result received")
            }
            group.cancelAll()
            return result
        }
    }
}

// MARK: - AsyncSequence Extension for FileHandle

extension FileHandle {
    var lines: AsyncLineSequence {
        AsyncLineSequence(fileHandle: self)
    }
}

/// Async sequence for reading lines from a FileHandle.
///
/// Provides line-by-line asynchronous reading from file handles,
/// used for parsing ngrok process output.
struct AsyncLineSequence: AsyncSequence {
    typealias Element = String

    let fileHandle: FileHandle

    struct AsyncIterator: AsyncIteratorProtocol {
        let fileHandle: FileHandle
        var buffer = Data()

        mutating func next() async -> String? {
            while true {
                let lineBreakData = Data("\n".utf8)
                if let range = buffer.range(of: lineBreakData) {
                    let line = String(data: buffer[..<range.lowerBound], encoding: .utf8)
                    buffer.removeSubrange(..<range.upperBound)
                    return line
                }

                let newData = fileHandle.availableData
                if newData.isEmpty {
                    if !buffer.isEmpty {
                        defer { buffer.removeAll() }
                        return String(data: buffer, encoding: .utf8)
                    }
                    return nil
                }

                buffer.append(newData)
            }
        }
    }

    func makeAsyncIterator() -> AsyncIterator {
        AsyncIterator(fileHandle: fileHandle)
    }
}

// MARK: - Keychain Helper

/// Helper for secure storage of ngrok auth tokens in Keychain.
///
/// Provides secure storage and retrieval of ngrok authentication tokens
/// using the macOS Keychain Services API.
private enum KeychainHelper {
    private static let service = KeychainConstants.vibeTunnelService
    private static let account = "ngrok-auth-token"

    static func getNgrokAuthToken() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess,
              let data = result as? Data,
              let token = String(data: data, encoding: .utf8)
        else {
            return nil
        }

        return token
    }

    /// Check if a token exists without retrieving it (won't trigger keychain prompt)
    static func hasNgrokAuthToken() -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecMatchLimit as String: kSecMatchLimitOne,
            kSecReturnAttributes as String: false,
            kSecReturnData as String: false
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        return status == errSecSuccess
    }

    static func setNgrokAuthToken(_ token: String) {
        guard let data = token.data(using: .utf8) else {
            return
        }

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]

        // Try to update first
        var updateQuery = query
        updateQuery[kSecValueData as String] = data

        var status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)

        if status == errSecItemNotFound {
            // Item doesn't exist, create it
            var addQuery = query
            addQuery[kSecValueData as String] = data
            status = SecItemAdd(addQuery as CFDictionary, nil)
        }
    }

    static func deleteNgrokAuthToken() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]

        SecItemDelete(query as CFDictionary)
    }
}
