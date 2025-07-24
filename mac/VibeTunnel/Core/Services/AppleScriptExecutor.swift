@preconcurrency import AppKit
import Foundation
import OSLog

/// Sendable wrapper for NSAppleEventDescriptor.
///
/// Provides thread-safe wrapping of NSAppleEventDescriptor for use
/// across actor boundaries while maintaining safety guarantees.
private struct SendableDescriptor: @unchecked Sendable {
    let descriptor: NSAppleEventDescriptor?
}

/// Safely executes AppleScript commands with proper error handling and crash prevention.
///
/// This class ensures AppleScript execution is deferred to the next run loop to avoid
/// crashes when called directly from SwiftUI actions. It provides centralized error
/// handling and logging for all AppleScript operations in the app.
@MainActor
final class AppleScriptExecutor {
    private let logger = Logger(
        subsystem: BundleIdentifiers.loggerSubsystem,
        category: "AppleScriptExecutor"
    )

    /// Shared instance for app-wide AppleScript execution
    static let shared = AppleScriptExecutor()

    private init() {}

    /// Core AppleScript execution logic shared between sync and async methods.
    ///
    /// - Parameter script: The AppleScript source code to execute
    /// - Returns: The result of the AppleScript execution, if any
    /// - Throws: `AppleScriptError` if execution fails
    /// - Note: This method must be called on the main thread
    @MainActor
    private func executeCore(_ script: String) throws -> NSAppleEventDescriptor? {
        var error: NSDictionary?
        guard let scriptObject = NSAppleScript(source: script) else {
            logger.error("Failed to create NSAppleScript object")
            throw AppleScriptError.scriptCreationFailed
        }

        let result = scriptObject.executeAndReturnError(&error)

        if let error {
            let errorMessage = error["NSAppleScriptErrorMessage"] as? String ?? "Unknown error"
            let errorNumber = error["NSAppleScriptErrorNumber"] as? Int

            // Log error details
            logger.error("AppleScript execution failed:")
            logger.error("  Error code: \(errorNumber ?? -1)")
            logger.error("  Error message: \(errorMessage)")
            if let errorRange = error["NSAppleScriptErrorRange"] as? NSRange {
                logger.error("  Error range: \(errorRange)")
            }
            if let errorBriefMessage = error["NSAppleScriptErrorBriefMessage"] as? String {
                logger.error("  Brief message: \(errorBriefMessage)")
            }

            throw AppleScriptError.executionFailed(
                message: errorMessage,
                errorCode: errorNumber
            )
        }

        logger.debug("AppleScript \(script) executed successfully")
        return result
    }

    /// Executes an AppleScript synchronously with proper error handling.
    ///
    /// This method runs on the main thread and is suitable for use in
    /// synchronous contexts where async/await is not available.
    ///
    /// - Parameters:
    ///   - script: The AppleScript source code to execute
    ///   - timeout: The timeout in seconds (default: 5.0, max: 30.0)
    /// - Throws: `AppleScriptError` if execution fails
    /// - Returns: The result of the AppleScript execution, if any
    @discardableResult
    func execute(_ script: String, timeout: TimeInterval = 5.0) throws -> NSAppleEventDescriptor? {
        // If we're already on the main thread, execute directly
        if Thread.isMainThread {
            // Add a small delay to avoid crashes from SwiftUI actions
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.01))
            return try executeCore(script)
        } else {
            // If on background thread, dispatch to main and wait
            var result: Result<NSAppleEventDescriptor?, Error>?

            DispatchQueue.main.sync {
                do {
                    result = try .success(execute(script, timeout: timeout))
                } catch {
                    result = .failure(error)
                }
            }

            switch result {
            case .success(let value):
                return value
            case .failure(let error):
                throw error
            case .none:
                throw AppleScriptError.executionFailed(message: "Script execution result was nil", errorCode: nil)
            }
        }
    }

    /// Executes an AppleScript asynchronously.
    ///
    /// This method ensures AppleScript runs on the main thread with proper
    /// timeout handling using Swift's modern concurrency features.
    ///
    /// - Parameters:
    ///   - script: The AppleScript source code to execute
    ///   - timeout: The timeout in seconds (default: 5.0, max: 30.0)
    /// - Returns: The result of the AppleScript execution, if any
    func executeAsync(_ script: String, timeout: TimeInterval = 5.0) async throws -> NSAppleEventDescriptor? {
        let timeoutDuration = min(timeout, 30.0)

        return try await withTaskCancellationHandler {
            let sendableResult: SendableDescriptor = try await withCheckedThrowingContinuation { continuation in
                let wrapper = ContinuationWrapper<SendableDescriptor>(continuation: continuation)

                Task { @MainActor in
                    // Small delay to ensure we're not in a SwiftUI action context
                    do {
                        try await Task.sleep(nanoseconds: 100_000_000) // 0.1 seconds
                    } catch {
                        wrapper.resume(throwing: error)
                        return
                    }

                    do {
                        let result = try executeCore(script)
                        wrapper.resume(returning: SendableDescriptor(descriptor: result))
                    } catch {
                        wrapper.resume(throwing: error)
                    }
                }

                // Set up timeout
                Task {
                    do {
                        try await Task.sleep(nanoseconds: UInt64(timeoutDuration * 1_000_000_000))
                        logger.error("AppleScript execution timed out after \(timeoutDuration) seconds")
                        wrapper.resume(throwing: AppleScriptError.timeout)
                    } catch {
                        // Task was cancelled, do nothing
                    }
                }
            }
            return sendableResult.descriptor
        } onCancel: {
            // Handle cancellation if needed
        }
    }

    /// Executes an AppleScript and returns its string result.
    ///
    /// This method is useful when you need to get a string result from AppleScript,
    /// such as window IDs or other identifiers.
    ///
    /// - Parameters:
    ///   - script: The AppleScript source code to execute
    ///   - timeout: The timeout in seconds (default: 5.0, max: 30.0)
    /// - Returns: The string result of the AppleScript execution
    /// - Throws: `AppleScriptError` if execution fails
    func executeWithResult(_ script: String, timeout: TimeInterval = 5.0) throws -> String {
        let descriptor = try execute(script, timeout: timeout)
        return descriptor?.stringValue ?? ""
    }

    /// Checks if AppleScript permission is granted by executing a simple test script.
    ///
    /// - Returns: true if permission is granted, false otherwise
    func checkPermission() async -> Bool {
        let testScript = """
            tell application "System Events"
                return name of first process whose frontmost is true
            end tell
        """

        do {
            _ = try await executeAsync(testScript)
            return true
        } catch let error as AppleScriptError {
            if error.isPermissionError {
                logger.info("AppleScript permission check: Permission denied")
                return false
            }
            logger.error("AppleScript permission check failed with error: \(error)")
            return false
        } catch {
            logger.error("AppleScript permission check failed with unexpected error: \(error)")
            return false
        }
    }
}

/// Errors that can occur during AppleScript execution.
///
/// Provides detailed error cases for AppleScript failures including
/// script creation issues, execution errors, and permission problems.
enum AppleScriptError: LocalizedError {
    case scriptCreationFailed
    case executionFailed(message: String, errorCode: Int?)
    case permissionDenied
    case timeout

    var errorDescription: String? {
        switch self {
        case .scriptCreationFailed:
            "Failed to create AppleScript object"
        case .executionFailed(let message, let errorCode):
            if let code = errorCode {
                "AppleScript error \(code): \(message)"
            } else {
                "AppleScript error: \(message)"
            }
        case .permissionDenied:
            "AppleScript permission denied. Please grant permission in System Settings."
        case .timeout:
            "AppleScript execution timed out"
        }
    }

    var failureReason: String? {
        switch self {
        case .permissionDenied:
            return "VibeTunnel needs Automation permission to control other applications."
        case .executionFailed(_, let errorCode):
            if let code = errorCode {
                switch code {
                case -1_743:
                    return "User permission is required to control other applications."
                case -1_728:
                    return "The application is not running or cannot be controlled."
                case -1_708:
                    return "The event was not handled by the target application."
                case -2_741:
                    return "AppleScript syntax error - check for unescaped quotes or invalid identifiers."
                default:
                    return nil
                }
            }
            return nil
        default:
            return nil
        }
    }

    /// Checks if this error represents a permission denial
    var isPermissionError: Bool {
        switch self {
        case .permissionDenied:
            true
        case .executionFailed(_, let errorCode):
            errorCode == -1_743
        default:
            false
        }
    }

    /// Converts this error to a TerminalLauncherError if appropriate
    func toTerminalLauncherError() -> TerminalLauncherError {
        if isPermissionError {
            return .appleScriptPermissionDenied
        }

        switch self {
        case .executionFailed(let message, let errorCode):
            return .appleScriptExecutionFailed(message, errorCode: errorCode)
        default:
            return .appleScriptExecutionFailed(self.localizedDescription, errorCode: nil)
        }
    }
}
