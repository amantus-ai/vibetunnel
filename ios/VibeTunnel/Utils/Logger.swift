import Foundation
import OSLog

/// Simple logging utility for debugging and diagnostics using the unified logging system.
/// Provides category-based logging that integrates with Console.app and log stream.
struct Logger {
    private let osLogger: os.Logger

    init(category: String) {
        // Use the same subsystem as the Mac app for consistency
        self.osLogger = os.Logger(subsystem: "sh.vibetunnel.vibetunnel", category: category)
    }

    func verbose(_ message: String) {
        osLogger.trace("\(message, privacy: .public)")
    }

    func debug(_ message: String) {
        osLogger.debug("\(message, privacy: .public)")
    }

    func info(_ message: String) {
        osLogger.info("\(message, privacy: .public)")
    }

    func warning(_ message: String) {
        osLogger.warning("\(message, privacy: .public)")
    }

    func error(_ message: String) {
        osLogger.error("\(message, privacy: .public)")
    }
}
