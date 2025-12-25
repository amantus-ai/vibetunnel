import Foundation
import OSLog

/// Log level enumeration for filtering log output
enum LogLevel: Int, Comparable {
    case verbose = 0
    case debug = 1
    case info = 2
    case warning = 3
    case error = 4

    /// Emoji prefix for each log level
    var prefix: String {
        switch self {
        case .verbose: "🔍"
        case .debug: "🐛"
        case .info: "ℹ️"
        case .warning: "⚠️"
        case .error: "❌"
        }
    }

    static func < (lhs: Self, rhs: Self) -> Bool {
        lhs.rawValue < rhs.rawValue
    }
}

/// Simple logging utility for debugging and diagnostics using the unified logging system.
/// Provides category-based logging that integrates with Console.app and log stream.
struct Logger {
    private let osLogger: os.Logger
    private let category: String

    /// Global log level threshold - only messages at this level or higher will be logged
    nonisolated(unsafe) static var globalLevel: LogLevel = {
        #if DEBUG
        return .info
        #else
        return .warning
        #endif
    }()

    init(category: String) {
        self.category = category
        // Use iOS-specific subsystem for proper log filtering
        self.osLogger = os.Logger(subsystem: "sh.vibetunnel.ios", category: category)
    }

    func verbose(_ message: String) {
        guard LogLevel.verbose >= Self.globalLevel else { return }
        self.osLogger.trace("\(message, privacy: .public)")
    }

    func debug(_ message: String) {
        guard LogLevel.debug >= Self.globalLevel else { return }
        self.osLogger.debug("\(message, privacy: .public)")
    }

    func info(_ message: String) {
        guard LogLevel.info >= Self.globalLevel else { return }
        self.osLogger.info("\(message, privacy: .public)")
    }

    func warning(_ message: String) {
        guard LogLevel.warning >= Self.globalLevel else { return }
        self.osLogger.warning("\(message, privacy: .public)")
    }

    func error(_ message: String) {
        guard LogLevel.error >= Self.globalLevel else { return }
        self.osLogger.error("\(message, privacy: .public)")
    }
}
