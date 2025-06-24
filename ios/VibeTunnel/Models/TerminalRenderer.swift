import Foundation

/// Available terminal renderer implementations
enum TerminalRenderer: String, CaseIterable, Codable {
    case swiftTerm = "SwiftTerm"
    case xterm = "xterm.js"

    var displayName: String {
        switch self {
        case .swiftTerm:
            "SwiftTerm (Native)"
        case .xterm:
            "xterm.js (WebView)"
        }
    }

    var description: String {
        switch self {
        case .swiftTerm:
            "Native Swift terminal emulator with best performance"
        case .xterm:
            "JavaScript-based terminal, identical to web version"
        }
    }

    /// The currently selected renderer (persisted in UserDefaults)
    static var selected: Self {
        get {
            if let rawValue = UserDefaults.standard.string(forKey: "selectedTerminalRenderer"),
               let renderer = Self(rawValue: rawValue)
            {
                return renderer
            }
            return .swiftTerm // Default
        }
        set {
            UserDefaults.standard.set(newValue.rawValue, forKey: "selectedTerminalRenderer")
        }
    }
}
