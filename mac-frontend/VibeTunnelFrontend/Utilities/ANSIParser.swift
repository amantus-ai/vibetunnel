import Foundation
import AppKit
import SwiftUI

struct ANSIParser {
    static let ansiEscapePattern = #"\x1B\[[0-9;]*m"#
    
    // ANSI color codes to NSColor mapping
    static let colorMap: [Int: NSColor] = [
        30: NSColor(Theme.Colors.ansiBlack),        // Black
        31: NSColor(Theme.Colors.ansiRed),          // Red
        32: NSColor(Theme.Colors.ansiGreen),        // Green
        33: NSColor(Theme.Colors.ansiYellow),       // Yellow
        34: NSColor(Theme.Colors.ansiBlue),         // Blue
        35: NSColor(Theme.Colors.ansiMagenta),      // Magenta
        36: NSColor(Theme.Colors.ansiCyan),         // Cyan
        37: NSColor(Theme.Colors.ansiWhite),        // White
        90: NSColor(Theme.Colors.ansiBrightBlack),  // Bright Black
        91: NSColor(Theme.Colors.ansiBrightRed),    // Bright Red
        92: NSColor(Theme.Colors.ansiBrightGreen),  // Bright Green
        93: NSColor(Theme.Colors.ansiBrightYellow), // Bright Yellow
        94: NSColor(Theme.Colors.ansiBrightBlue),   // Bright Blue
        95: NSColor(Theme.Colors.ansiBrightMagenta),// Bright Magenta
        96: NSColor(Theme.Colors.ansiBrightCyan),   // Bright Cyan
        97: NSColor(Theme.Colors.ansiBrightWhite)   // Bright White
    ]
    
    // Background color codes (add 10 to foreground codes)
    static let backgroundColorMap: [Int: NSColor] = {
        var map: [Int: NSColor] = [:]
        for (code, color) in colorMap {
            map[code + 10] = color
        }
        return map
    }()
    
    struct ANSIState {
        var foregroundColor: NSColor = NSColor(Theme.Colors.terminalText)
        var backgroundColor: NSColor = NSColor(Theme.Colors.terminalBackground)
        var isBold = false
        var isItalic = false
        var isUnderline = false
        var isStrikethrough = false
        
        mutating func reset() {
            foregroundColor = NSColor(Theme.Colors.terminalText)
            backgroundColor = NSColor(Theme.Colors.terminalBackground)
            isBold = false
            isItalic = false
            isUnderline = false
            isStrikethrough = false
        }
        
        mutating func apply(codes: [Int]) {
            for code in codes {
                switch code {
                case 0: // Reset
                    reset()
                case 1: // Bold
                    isBold = true
                case 3: // Italic
                    isItalic = true
                case 4: // Underline
                    isUnderline = true
                case 9: // Strikethrough
                    isStrikethrough = true
                case 22: // Normal intensity
                    isBold = false
                case 23: // Not italic
                    isItalic = false
                case 24: // Not underlined
                    isUnderline = false
                case 29: // Not strikethrough
                    isStrikethrough = false
                case 30...37, 90...97: // Foreground colors
                    if let color = colorMap[code] {
                        foregroundColor = color
                    }
                case 39: // Default foreground
                    foregroundColor = NSColor(Theme.Colors.terminalText)
                case 40...47, 100...107: // Background colors
                    if let color = backgroundColorMap[code] {
                        backgroundColor = color
                    }
                case 49: // Default background
                    backgroundColor = NSColor(Theme.Colors.terminalBackground)
                default:
                    break
                }
            }
        }
        
        func attributes(baseFont: NSFont) -> [NSAttributedString.Key: Any] {
            var attributes: [NSAttributedString.Key: Any] = [
                .foregroundColor: foregroundColor,
                .backgroundColor: backgroundColor
            ]
            
            var font = baseFont
            var traits: NSFontTraitMask = []
            
            if isBold {
                traits.insert(.boldFontMask)
            }
            if isItalic {
                traits.insert(.italicFontMask)
            }
            
            if !traits.isEmpty {
                if let modifiedFont = NSFontManager.shared.font(withFamily: font.familyName ?? "SF Mono",
                                                                traits: traits,
                                                                weight: 0,
                                                                size: font.pointSize) {
                    font = modifiedFont
                }
            }
            
            attributes[.font] = font
            
            if isUnderline {
                attributes[.underlineStyle] = NSUnderlineStyle.single.rawValue
            }
            
            if isStrikethrough {
                attributes[.strikethroughStyle] = NSUnderlineStyle.single.rawValue
            }
            
            return attributes
        }
    }
    
    static func parse(_ text: String, baseFont: NSFont) -> NSAttributedString {
        let attributedString = NSMutableAttributedString()
        var currentState = ANSIState()
        
        let regex = try! NSRegularExpression(pattern: ansiEscapePattern, options: [])
        let nsString = text as NSString
        let range = NSRange(location: 0, length: nsString.length)
        
        var lastEnd = 0
        
        regex.enumerateMatches(in: text, options: [], range: range) { match, _, _ in
            guard let match = match else { return }
            
            // Add text before this ANSI code
            if match.range.location > lastEnd {
                let textRange = NSRange(location: lastEnd, length: match.range.location - lastEnd)
                let substring = nsString.substring(with: textRange)
                let attributedSubstring = NSAttributedString(
                    string: substring,
                    attributes: currentState.attributes(baseFont: baseFont)
                )
                attributedString.append(attributedSubstring)
            }
            
            // Parse ANSI codes
            let ansiCode = nsString.substring(with: match.range)
            let codeString = ansiCode
                .dropFirst(2)  // Remove \x1B[
                .dropLast()    // Remove m
            
            let codes = codeString
                .split(separator: ";")
                .compactMap { Int($0) }
            
            currentState.apply(codes: codes)
            lastEnd = match.range.location + match.range.length
        }
        
        // Add remaining text
        if lastEnd < nsString.length {
            let textRange = NSRange(location: lastEnd, length: nsString.length - lastEnd)
            let substring = nsString.substring(with: textRange)
            let attributedSubstring = NSAttributedString(
                string: substring,
                attributes: currentState.attributes(baseFont: baseFont)
            )
            attributedString.append(attributedSubstring)
        }
        
        // Apply URL highlighting
        URLDetector.highlightURLs(in: attributedString)
        
        return attributedString
    }
    
    static func stripANSICodes(_ text: String) -> String {
        let regex = try! NSRegularExpression(pattern: ansiEscapePattern, options: [])
        let range = NSRange(location: 0, length: text.utf16.count)
        return regex.stringByReplacingMatches(in: text, options: [], range: range, withTemplate: "")
    }
}