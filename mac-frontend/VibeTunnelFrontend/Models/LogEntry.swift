import Foundation
import SwiftUI

struct LogEntry: Identifiable {
    let id = UUID()
    let timestamp: Date
    let level: LogLevel
    let module: String
    let message: String
    let isClient: Bool
    
    enum LogLevel: String, CaseIterable {
        case error
        case warn
        case log
        case debug
        
        var color: Color {
            switch self {
            case .error: return Theme.Colors.error
            case .warn: return Theme.Colors.warning
            case .log: return Theme.Colors.text
            case .debug: return Theme.Colors.secondaryText
            }
        }
        
        var label: String {
            switch self {
            case .error: return "ERR"
            case .warn: return "WRN"
            case .log: return "LOG"
            case .debug: return "DBG"
            }
        }
    }
}

// Log parsing
extension LogEntry {
    static func parse(from line: String, isClient: Bool = false) -> LogEntry? {
        // Expected format: "2024-01-01T12:00:00.000Z LEVEL [module] message"
        let pattern = #"^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+(.*)$"#
        
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: line, range: NSRange(location: 0, length: line.count)) else {
            return nil
        }
        
        let nsString = line as NSString
        
        let timestampStr = nsString.substring(with: match.range(at: 1))
        let levelStr = nsString.substring(with: match.range(at: 2))
        let module = nsString.substring(with: match.range(at: 3))
        let message = nsString.substring(with: match.range(at: 4))
        
        // Parse timestamp
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let timestamp = formatter.date(from: timestampStr) else {
            return nil
        }
        
        // Parse level
        let level = LogLevel(rawValue: levelStr.lowercased()) ?? .log
        
        // Remove "CLIENT:" prefix from module if present
        let cleanModule = module.hasPrefix("CLIENT:") ? String(module.dropFirst(7)) : module
        
        return LogEntry(
            timestamp: timestamp,
            level: level,
            module: cleanModule,
            message: message,
            isClient: isClient || module.hasPrefix("CLIENT:")
        )
    }
}