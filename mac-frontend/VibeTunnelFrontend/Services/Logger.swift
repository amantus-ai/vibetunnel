import Foundation
import os.log

/// Centralized logging system for VibeTunnel Frontend
enum Logger {
    private static let subsystem = Bundle.main.bundleIdentifier ?? "sh.vibetunnel.frontend"
    
    /// General app logging
    static let app = os.Logger(subsystem: subsystem, category: "app")
    
    /// Network and API logging
    static let network = os.Logger(subsystem: subsystem, category: "network")
    
    /// Session management logging
    static let session = os.Logger(subsystem: subsystem, category: "session")
    
    /// Terminal operations logging
    static let terminal = os.Logger(subsystem: subsystem, category: "terminal")
    
    /// File system operations logging
    static let fileSystem = os.Logger(subsystem: subsystem, category: "fileSystem")
    
    /// WebSocket logging
    static let webSocket = os.Logger(subsystem: subsystem, category: "webSocket")
}

// MARK: - Convenience Extensions

extension Logger {
    /// Log an error with additional context
    static func logError(_ logger: os.Logger, _ message: String, error: Error? = nil, file: String = #file, function: String = #function, line: Int = #line) {
        let fileName = URL(fileURLWithPath: file).lastPathComponent
        if let error = error {
            logger.error("[\(fileName):\(line)] \(function) - \(message): \(error.localizedDescription)")
        } else {
            logger.error("[\(fileName):\(line)] \(function) - \(message)")
        }
    }
    
    /// Log a warning with additional context
    static func logWarning(_ logger: os.Logger, _ message: String, file: String = #file, function: String = #function, line: Int = #line) {
        let fileName = URL(fileURLWithPath: file).lastPathComponent
        logger.warning("[\(fileName):\(line)] \(function) - \(message)")
    }
    
    /// Log debug information
    static func logDebug(_ logger: os.Logger, _ message: String, file: String = #file, function: String = #function, line: Int = #line) {
        let fileName = URL(fileURLWithPath: file).lastPathComponent
        logger.debug("[\(fileName):\(line)] \(function) - \(message)")
    }
}

// MARK: - Error Logging Extensions

extension Error {
    /// Log this error with context
    func log(to logger: os.Logger, message: String? = nil, file: String = #file, function: String = #function, line: Int = #line) {
        Logger.logError(logger, message ?? "Error occurred", error: self, file: file, function: function, line: line)
    }
}