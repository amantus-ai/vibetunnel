import Foundation

/// A thread-safe wrapper for managing continuation resumption.
///
/// This class ensures that a continuation is only resumed once, preventing
/// crashes from multiple resumptions. It uses NSLock for thread-safe access
/// to the internal state.
final class ContinuationWrapper<T>: @unchecked Sendable {
    private let lock = NSLock()
    private var hasResumed = false
    private let continuation: CheckedContinuation<T, Error>

    init(continuation: CheckedContinuation<T, Error>) {
        self.continuation = continuation
    }

    /// Resumes the continuation with an error.
    ///
    /// - Parameter error: The error to throw
    func resume(throwing error: Error) {
        self.lock.lock()
        defer { lock.unlock() }

        guard !self.hasResumed else { return }
        self.hasResumed = true
        self.continuation.resume(throwing: error)
    }

    /// Resumes the continuation with a value.
    ///
    /// - Parameter value: The value to return
    func resume(returning value: sending T) {
        self.lock.lock()
        defer { lock.unlock() }

        guard !self.hasResumed else { return }
        self.hasResumed = true
        self.continuation.resume(returning: value)
    }
}
