import Foundation
import CoreGraphics

/// Security utilities for AppleScript execution
enum AppleScriptSecurity {
    
    /// Escapes a string for safe use in AppleScript
    /// 
    /// This function properly escapes all special characters that could be used
    /// for AppleScript injection attacks, including:
    /// - Double quotes (")
    /// - Backslashes (\)
    /// - Newlines and carriage returns
    /// - Tabs
    /// - Other control characters
    ///
    /// - Parameter string: The string to escape
    /// - Returns: The escaped string safe for use in AppleScript
    static func escapeString(_ string: String) -> String {
        var escaped = string
        
        // Order matters: escape backslashes first
        escaped = escaped.replacingOccurrences(of: "\\", with: "\\\\")
        escaped = escaped.replacingOccurrences(of: "\"", with: "\\\"")
        escaped = escaped.replacingOccurrences(of: "\n", with: "\\n")
        escaped = escaped.replacingOccurrences(of: "\r", with: "\\r")
        escaped = escaped.replacingOccurrences(of: "\t", with: "\\t")
        
        // Remove any other control characters that could cause issues
        let controlCharacterSet = CharacterSet.controlCharacters
        escaped = escaped.components(separatedBy: controlCharacterSet)
            .joined(separator: " ")
        
        return escaped
    }
    
    /// Validates an identifier (like an application name) for safe use in AppleScript
    ///
    /// This function ensures the identifier only contains safe characters and
    /// isn't trying to inject AppleScript commands.
    ///
    /// - Parameter identifier: The identifier to validate
    /// - Returns: The validated identifier, or nil if invalid
    static func validateIdentifier(_ identifier: String) -> String? {
        // Allow alphanumeric, spaces, dots, hyphens, and underscores
        let allowedCharacterSet = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .-_")
        let identifierCharacterSet = CharacterSet(charactersIn: identifier)
        
        guard allowedCharacterSet.isSuperset(of: identifierCharacterSet) else {
            return nil
        }
        
        // Additional check: ensure it doesn't contain AppleScript keywords that could be dangerous
        let dangerousKeywords = ["tell", "end", "do", "script", "run", "activate", "quit", "delete", "set", "get"]
        let lowercased = identifier.lowercased()
        for keyword in dangerousKeywords {
            if lowercased.contains(keyword) {
                return nil
            }
        }
        
        return identifier
    }
    
    /// Escapes a numeric value for safe use in AppleScript
    ///
    /// - Parameter value: The numeric value
    /// - Returns: The string representation of the number
    static func escapeNumber(_ value: Int) -> String {
        return String(value)
    }
    
    /// Escapes a numeric value for safe use in AppleScript
    ///
    /// - Parameter value: The numeric value (UInt32/CGWindowID)
    /// - Returns: The string representation of the number
    static func escapeNumber(_ value: UInt32) -> String {
        return String(value)
    }
    
    /// Creates a safe AppleScript string literal
    ///
    /// - Parameter string: The string to make into a literal
    /// - Returns: A properly quoted and escaped AppleScript string literal
    static func createStringLiteral(_ string: String) -> String {
        return "\"\(escapeString(string))\""
    }
}