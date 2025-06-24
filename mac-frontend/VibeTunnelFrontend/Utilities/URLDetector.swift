import AppKit
import Foundation

struct URLDetector {
    // Regular expression patterns for detecting URLs
    private static let httpURLPattern = #"https?://[^\s<>"{}|\\\^\[\]`]+"#
    private static let wwwPattern = #"www\.[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s<>"{}|\\\^\[\]`]+"#
    private static let emailPattern = #"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}"#
    private static let filePathPattern = #"(?:~|\.{1,2})?(?:/[^\s<>"{}|\\\^\[\]`]+)+"#
    
    // Detect URLs in a string and return their ranges
    static func detectURLs(in text: String) -> [(url: String, range: NSRange)] {
        var results: [(url: String, range: NSRange)] = []
        let patterns = [
            ("http", httpURLPattern),
            ("www", wwwPattern),
            ("email", emailPattern),
            ("file", filePathPattern)
        ]
        
        for (type, pattern) in patterns {
            do {
                let regex = try NSRegularExpression(pattern: pattern, options: [])
                let matches = regex.matches(in: text, options: [], range: NSRange(location: 0, length: text.utf16.count))
                
                for match in matches {
                    if let range = Range(match.range, in: text) {
                        var url = String(text[range])
                        
                        // Process URLs based on type
                        switch type {
                        case "www":
                            url = "https://\(url)"
                        case "email":
                            url = "mailto:\(url)"
                        case "file":
                            // Expand ~ to home directory
                            if url.hasPrefix("~") {
                                url = url.replacingOccurrences(of: "~", with: NSHomeDirectory(), range: url.startIndex..<url.index(after: url.startIndex))
                            }
                            url = "file://\(url)"
                        default:
                            break
                        }
                        
                        results.append((url: url, range: match.range))
                    }
                }
            } catch {
                // Continue with next pattern
            }
        }
        
        // Remove duplicates and overlapping ranges
        results.sort { $0.range.location < $1.range.location }
        var filtered: [(url: String, range: NSRange)] = []
        var lastEndLocation = -1
        
        for result in results {
            if result.range.location >= lastEndLocation {
                filtered.append(result)
                lastEndLocation = result.range.location + result.range.length
            }
        }
        
        return filtered
    }
    
    // Apply URL highlighting to an attributed string
    static func highlightURLs(in attributedString: NSMutableAttributedString) {
        let text = attributedString.string
        let urls = detectURLs(in: text)
        
        for (url, range) in urls {
            // Add link attribute
            attributedString.addAttribute(.link, value: url, range: range)
            
            // Style the link
            attributedString.addAttribute(.foregroundColor, value: NSColor.systemBlue, range: range)
            attributedString.addAttribute(.underlineStyle, value: NSUnderlineStyle.single.rawValue, range: range)
            attributedString.addAttribute(.cursor, value: NSCursor.pointingHand, range: range)
        }
    }
    
    // Open URL in default browser or application
    static func openURL(_ urlString: String) {
        guard let url = URL(string: urlString) else { return }
        
        // Special handling for file URLs
        if url.scheme == "file" {
            // Convert back to path and check if it exists
            let path = url.path
            if FileManager.default.fileExists(atPath: path) {
                NSWorkspace.shared.open(url)
            }
        } else {
            // Open all other URLs normally
            NSWorkspace.shared.open(url)
        }
    }
}