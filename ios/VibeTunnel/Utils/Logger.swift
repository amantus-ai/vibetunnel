import Foundation

/// Simple logger for VibeTunnel iOS app
enum LogLevel: Int {
    case verbose = 0
    case debug = 1
    case info = 2
    case warning = 3
    case error = 4

    var prefix: String {
        switch self {
        case .verbose: "🔍"
        case .debug: "🐛"
        case .info: "ℹ️"
        case .warning: "⚠️"
        case .error: "❌"
        }
    }
}

struct Logger {
    private let category: String

    // Global log level - only messages at this level or higher will be printed
    #if DEBUG
        nonisolated(unsafe) static var globalLevel: LogLevel = .info // Default to info level in debug builds
    #else
        nonisolated(unsafe) static var globalLevel: LogLevel = .warning // Only warnings and errors in release
    #endif

    init(category: String) {
        self.category = category
    }

    func verbose(_ message: String) {
        log(message, level: .verbose)
    }

    func debug(_ message: String) {
        log(message, level: .debug)
    }

    func info(_ message: String) {
        log(message, level: .info)
    }

    func warning(_ message: String) {
        log(message, level: .warning)
    }

    func error(_ message: String) {
        log(message, level: .error)
    }

    private func log(_ message: String, level: LogLevel) {
        guard level.rawValue >= Self.globalLevel.rawValue else { return }
        print("\(level.prefix) [\(category)] \(message)")
    }
}
