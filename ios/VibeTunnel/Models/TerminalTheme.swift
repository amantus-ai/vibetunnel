import SwiftUI

/// Simple terminal theme - light or dark mode only.
struct TerminalTheme: Identifiable, Equatable {
    let id: String
    let name: String

    // Basic colors
    let background: Color
    let foreground: Color
    let selection: Color
    let cursor: Color

    // Standard ANSI colors
    let black: Color
    let red: Color
    let green: Color
    let yellow: Color
    let blue: Color
    let magenta: Color
    let cyan: Color
    let white: Color

    // Bright ANSI colors
    let brightBlack: Color
    let brightRed: Color
    let brightGreen: Color
    let brightYellow: Color
    let brightBlue: Color
    let brightMagenta: Color
    let brightCyan: Color
    let brightWhite: Color
}

// MARK: - Light & Dark Only

extension TerminalTheme {
    /// Pure dark terminal - black background, white text
    static let dark = TerminalTheme(
        id: "dark",
        name: "Dark",
        background: .black,
        foreground: .white,
        selection: Color(white: 0.3),
        cursor: .white,
        // Standard ANSI colors
        black: Color(hex: "000000"),
        red: Color(hex: "FF5555"),
        green: Color(hex: "50FA7B"),
        yellow: Color(hex: "F1FA8C"),
        blue: Color(hex: "6272FF"),
        magenta: Color(hex: "FF79C6"),
        cyan: Color(hex: "8BE9FD"),
        white: Color(hex: "F8F8F2"),
        // Bright colors
        brightBlack: Color(hex: "555555"),
        brightRed: Color(hex: "FF6E6E"),
        brightGreen: Color(hex: "69FF94"),
        brightYellow: Color(hex: "FFFFA5"),
        brightBlue: Color(hex: "8A9FFF"),
        brightMagenta: Color(hex: "FF92DF"),
        brightCyan: Color(hex: "A4FFFF"),
        brightWhite: Color(hex: "FFFFFF"))

    /// Pure light terminal - white background, black text
    static let light = TerminalTheme(
        id: "light",
        name: "Light",
        background: .white,
        foreground: .black,
        selection: Color(white: 0.8),
        cursor: .black,
        // Standard ANSI colors (darker for light bg)
        black: Color(hex: "000000"),
        red: Color(hex: "C41A16"),
        green: Color(hex: "007400"),
        yellow: Color(hex: "826B00"),
        blue: Color(hex: "0000FF"),
        magenta: Color(hex: "A90D91"),
        cyan: Color(hex: "008080"),
        white: Color(hex: "C0C0C0"),
        // Bright colors
        brightBlack: Color(hex: "666666"),
        brightRed: Color(hex: "FF0000"),
        brightGreen: Color(hex: "00CC00"),
        brightYellow: Color(hex: "999900"),
        brightBlue: Color(hex: "0066FF"),
        brightMagenta: Color(hex: "CC00CC"),
        brightCyan: Color(hex: "00CCCC"),
        brightWhite: Color(hex: "FFFFFF"))

    /// Returns the theme matching system appearance
    static func forColorScheme(_ colorScheme: ColorScheme) -> TerminalTheme {
        colorScheme == .dark ? .dark : .light
    }

    // Keep these for backward compatibility
    static let shellOps = dark
    static let dracula = dark
    static var selected: TerminalTheme {
        get { .dark }
        set { }
    }
    static let allThemes: [TerminalTheme] = [.dark, .light]
}
