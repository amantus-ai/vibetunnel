import SwiftUI

/// Terminal color theme definition.
/// Defines a complete color palette for terminal rendering including ANSI colors.
struct TerminalTheme: Identifiable, Equatable {
    let id: String
    let name: String
    let description: String

    // Basic colors
    let background: Color
    let foreground: Color
    let selection: Color
    let cursor: Color

    // ANSI colors (0-7)
    let black: Color
    let red: Color
    let green: Color
    let yellow: Color
    let blue: Color
    let magenta: Color
    let cyan: Color
    let white: Color

    // Bright ANSI colors (8-15)
    let brightBlack: Color
    let brightRed: Color
    let brightGreen: Color
    let brightYellow: Color
    let brightBlue: Color
    let brightMagenta: Color
    let brightCyan: Color
    let brightWhite: Color
}

// MARK: - Predefined Themes

extension TerminalTheme {
    /// VibeTunnel's default dark theme
    static let vibeTunnel = TerminalTheme(
        id: "vibetunnel",
        name: "VibeTunnel",
        description: "Default VibeTunnel theme with blue accents",
        background: Theme.Colors.terminalBackground,
        foreground: Theme.Colors.terminalForeground,
        selection: Theme.Colors.terminalSelection,
        cursor: Theme.Colors.primaryAccent,
        black: Theme.Colors.ansiBlack,
        red: Theme.Colors.ansiRed,
        green: Theme.Colors.ansiGreen,
        yellow: Theme.Colors.ansiYellow,
        blue: Theme.Colors.ansiBlue,
        magenta: Theme.Colors.ansiMagenta,
        cyan: Theme.Colors.ansiCyan,
        white: Theme.Colors.ansiWhite,
        brightBlack: Theme.Colors.ansiBrightBlack,
        brightRed: Theme.Colors.ansiBrightRed,
        brightGreen: Theme.Colors.ansiBrightGreen,
        brightYellow: Theme.Colors.ansiBrightYellow,
        brightBlue: Theme.Colors.ansiBrightBlue,
        brightMagenta: Theme.Colors.ansiBrightMagenta,
        brightCyan: Theme.Colors.ansiBrightCyan,
        brightWhite: Theme.Colors.ansiBrightWhite
    )

    /// VS Code Dark theme
    static let vsCodeDark = TerminalTheme(
        id: "vscode-dark",
        name: "VS Code Dark",
        description: "Popular dark theme from Visual Studio Code",
        background: Color(hex: "1E1E1E"),
        foreground: Color(hex: "D4D4D4"),
        selection: Color(hex: "264F78"),
        cursor: Color(hex: "AEAFAD"),
        black: Color(hex: "000000"),
        red: Color(hex: "CD3131"),
        green: Color(hex: "0DBC79"),
        yellow: Color(hex: "E5E510"),
        blue: Color(hex: "2472C8"),
        magenta: Color(hex: "BC3FBC"),
        cyan: Color(hex: "11A8CD"),
        white: Color(hex: "E5E5E5"),
        brightBlack: Color(hex: "666666"),
        brightRed: Color(hex: "F14C4C"),
        brightGreen: Color(hex: "23D18B"),
        brightYellow: Color(hex: "F5F543"),
        brightBlue: Color(hex: "3B8EEA"),
        brightMagenta: Color(hex: "D670D6"),
        brightCyan: Color(hex: "29B8DB"),
        brightWhite: Color(hex: "FFFFFF")
    )

    /// Solarized Dark theme
    static let solarizedDark = TerminalTheme(
        id: "solarized-dark",
        name: "Solarized Dark",
        description: "Precision colors for machines and people",
        background: Color(hex: "002B36"),
        foreground: Color(hex: "839496"),
        selection: Color(hex: "073642"),
        cursor: Color(hex: "839496"),
        black: Color(hex: "073642"),
        red: Color(hex: "DC322F"),
        green: Color(hex: "859900"),
        yellow: Color(hex: "B58900"),
        blue: Color(hex: "268BD2"),
        magenta: Color(hex: "D33682"),
        cyan: Color(hex: "2AA198"),
        white: Color(hex: "EEE8D5"),
        brightBlack: Color(hex: "002B36"),
        brightRed: Color(hex: "CB4B16"),
        brightGreen: Color(hex: "586E75"),
        brightYellow: Color(hex: "657B83"),
        brightBlue: Color(hex: "839496"),
        brightMagenta: Color(hex: "6C71C4"),
        brightCyan: Color(hex: "93A1A1"),
        brightWhite: Color(hex: "FDF6E3")
    )

    /// Dracula theme
    static let dracula = TerminalTheme(
        id: "dracula",
        name: "Dracula",
        description: "Dark theme for developers",
        background: Color(hex: "282A36"),
        foreground: Color(hex: "F8F8F2"),
        selection: Color(hex: "44475A"),
        cursor: Color(hex: "F8F8F2"),
        black: Color(hex: "21222C"),
        red: Color(hex: "FF5555"),
        green: Color(hex: "50FA7B"),
        yellow: Color(hex: "F1FA8C"),
        blue: Color(hex: "BD93F9"),
        magenta: Color(hex: "FF79C6"),
        cyan: Color(hex: "8BE9FD"),
        white: Color(hex: "F8F8F2"),
        brightBlack: Color(hex: "6272A4"),
        brightRed: Color(hex: "FF6E6E"),
        brightGreen: Color(hex: "69FF94"),
        brightYellow: Color(hex: "FFFFA5"),
        brightBlue: Color(hex: "D6ACFF"),
        brightMagenta: Color(hex: "FF92DF"),
        brightCyan: Color(hex: "A4FFFF"),
        brightWhite: Color(hex: "FFFFFF")
    )

    /// Nord theme
    static let nord = TerminalTheme(
        id: "nord",
        name: "Nord",
        description: "An arctic, north-bluish color palette",
        background: Color(hex: "2E3440"),
        foreground: Color(hex: "D8DEE9"),
        selection: Color(hex: "434C5E"),
        cursor: Color(hex: "D8DEE9"),
        black: Color(hex: "3B4252"),
        red: Color(hex: "BF616A"),
        green: Color(hex: "A3BE8C"),
        yellow: Color(hex: "EBCB8B"),
        blue: Color(hex: "81A1C1"),
        magenta: Color(hex: "B48EAD"),
        cyan: Color(hex: "88C0D0"),
        white: Color(hex: "E5E9F0"),
        brightBlack: Color(hex: "4C566A"),
        brightRed: Color(hex: "BF616A"),
        brightGreen: Color(hex: "A3BE8C"),
        brightYellow: Color(hex: "EBCB8B"),
        brightBlue: Color(hex: "81A1C1"),
        brightMagenta: Color(hex: "B48EAD"),
        brightCyan: Color(hex: "8FBCBB"),
        brightWhite: Color(hex: "ECEFF4")
    )

    /// All available themes
    static let allThemes: [TerminalTheme] = [
        .vibeTunnel,
        .vsCodeDark,
        .solarizedDark,
        .dracula,
        .nord
    ]
}

// MARK: - UserDefaults Storage

extension TerminalTheme {
    private static let selectedThemeKey = "selectedTerminalTheme"

    /// Get the currently selected theme from UserDefaults
    static var selected: TerminalTheme {
        get {
            guard let themeId = UserDefaults.standard.string(forKey: selectedThemeKey),
                  let theme = allThemes.first(where: { $0.id == themeId })
            else {
                return .vibeTunnel
            }
            return theme
        }
        set {
            UserDefaults.standard.set(newValue.id, forKey: selectedThemeKey)
        }
    }
}
