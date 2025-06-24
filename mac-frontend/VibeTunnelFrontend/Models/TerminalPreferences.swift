import Foundation
import SwiftUI

struct TerminalPreferences: Codable, Equatable {
    var fontSize: Double = 13.0
    var maxColumns: Int = 0 // 0 means unlimited
    var fitHorizontally: Bool = false
    var theme: TerminalTheme = .default
    
    // Column width presets from JS frontend
    static let columnPresets = [80, 100, 120, 132, 160]
    
    // Font size constraints
    static let minFontSize: Double = 8.0
    static let maxFontSize: Double = 32.0
    
    mutating func adjustFontSize(delta: Double) {
        fontSize = min(Self.maxFontSize, max(Self.minFontSize, fontSize + delta))
    }
}

// Terminal theme support
struct TerminalTheme: Codable, Equatable {
    let name: String
    let background: String
    let foreground: String
    let cursor: String
    let ansiColors: [String] // 16 ANSI colors
    
    static let `default` = TerminalTheme(
        name: "Default",
        background: "#0c0c0c",
        foreground: "#cccccc",
        cursor: "#cccccc",
        ansiColors: [
            "#000000", "#cd0000", "#00cd00", "#cdcd00",
            "#0000ee", "#cd00cd", "#00cdcd", "#e5e5e5",
            "#7f7f7f", "#ff0000", "#00ff00", "#ffff00",
            "#5c5cff", "#ff00ff", "#00ffff", "#ffffff"
        ]
    )
}

// Extension to save/load preferences per session
extension TerminalPreferences {
    private static let userDefaultsPrefix = "terminalPreferences_"
    
    static func load(for sessionId: String) -> TerminalPreferences {
        let key = "\(userDefaultsPrefix)\(sessionId)"
        guard let data = UserDefaults.standard.data(forKey: key),
              let preferences = try? JSONDecoder().decode(TerminalPreferences.self, from: data) else {
            return TerminalPreferences()
        }
        return preferences
    }
    
    func save(for sessionId: String) {
        let key = "\(Self.userDefaultsPrefix)\(sessionId)"
        if let data = try? JSONEncoder().encode(self) {
            UserDefaults.standard.set(data, forKey: key)
        }
    }
    
    static func remove(for sessionId: String) {
        let key = "\(userDefaultsPrefix)\(sessionId)"
        UserDefaults.standard.removeObject(forKey: key)
    }
}