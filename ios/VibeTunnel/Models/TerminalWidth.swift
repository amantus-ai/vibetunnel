import Foundation

/// Common terminal width presets.
/// Provides standard terminal column widths with descriptive labels.
enum TerminalWidth: CaseIterable, Equatable {
    case unlimited
    case classic80
    case modern100
    case wide120
    case mainframe132
    case ultraWide160
    case custom(Int)

    var value: Int {
        switch self {
        case .unlimited: 0
        case .classic80: 80
        case .modern100: 100
        case .wide120: 120
        case .mainframe132: 132
        case .ultraWide160: 160
        case .custom(let width): width
        }
    }

    var label: String {
        switch self {
        case .unlimited: "∞"
        case .classic80: "80"
        case .modern100: "100"
        case .wide120: "120"
        case .mainframe132: "132"
        case .ultraWide160: "160"
        case .custom(let width): "\(width)"
        }
    }

    var description: String {
        switch self {
        case .unlimited: "Unlimited"
        case .classic80: "Classic terminal"
        case .modern100: "Modern standard"
        case .wide120: "Wide terminal"
        case .mainframe132: "Mainframe width"
        case .ultraWide160: "Ultra-wide"
        case .custom: "Custom width"
        }
    }

    static var allCases: [Self] {
        [.unlimited, .classic80, .modern100, .wide120, .mainframe132, .ultraWide160]
    }

    static func from(value: Int) -> Self {
        switch value {
        case 0: .unlimited
        case 80: .classic80
        case 100: .modern100
        case 120: .wide120
        case 132: .mainframe132
        case 160: .ultraWide160
        default: .custom(value)
        }
    }

    /// Check if this is a standard preset width
    var isPreset: Bool {
        switch self {
        case .custom: false
        default: true
        }
    }
}

/// Manager for terminal width preferences.
/// Handles persistent storage of default and custom terminal widths.
@MainActor
class TerminalWidthManager {
    static let shared = TerminalWidthManager()

    private let defaultWidthKey = "defaultTerminalWidth"
    private let customWidthsKey = "customTerminalWidths"

    private init() {}

    /// Get the default terminal width
    var defaultWidth: Int {
        get {
            UserDefaults.standard.integer(forKey: defaultWidthKey)
        }
        set {
            UserDefaults.standard.set(newValue, forKey: defaultWidthKey)
        }
    }

    /// Get saved custom widths
    var customWidths: [Int] {
        get {
            UserDefaults.standard.array(forKey: customWidthsKey) as? [Int] ?? []
        }
        set {
            UserDefaults.standard.set(newValue, forKey: customWidthsKey)
        }
    }

    /// Add a custom width to saved list
    func addCustomWidth(_ width: Int) {
        var widths = customWidths
        if !widths.contains(width) && width >= 20 && width <= 500 {
            widths.append(width)
            // Keep only last 5 custom widths
            if widths.count > 5 {
                widths.removeFirst()
            }
            customWidths = widths
        }
    }

    /// Get all available widths including custom ones
    func allWidths() -> [TerminalWidth] {
        var widths = TerminalWidth.allCases
        for customWidth in customWidths where !TerminalWidth.allCases.contains(where: { $0.value == customWidth }) {
            widths.append(.custom(customWidth))
        }
        return widths
    }
}
