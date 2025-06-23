import Foundation
import Testing
@testable import VibeTunnel

@Suite("TerminalTheme Tests", .tags(.models))
struct TerminalThemeTests {

    @Test("All themes have unique IDs")
    func uniqueThemeIds() {
        let themes = TerminalTheme.allThemes
        let ids = themes.map { $0.id }
        let uniqueIds = Set(ids)

        #expect(ids.count == uniqueIds.count)
    }

    @Test("All themes have valid color values")
    func validColorValues() {
        for theme in TerminalTheme.allThemes {
            // Check background color
            #expect(theme.background.hasPrefix("#"))
            #expect(theme.background.count == 7)

            // Check foreground color
            #expect(theme.foreground.hasPrefix("#"))
            #expect(theme.foreground.count == 7)

            // Check cursor color
            #expect(theme.cursor.hasPrefix("#"))
            #expect(theme.cursor.count == 7)

            // Check all 16 colors
            #expect(theme.colors.count == 16)
            for color in theme.colors {
                #expect(color.hasPrefix("#"))
                #expect(color.count == 7)
            }
        }
    }

    @Test("Default theme is Dracula")
    func defaultTheme() {
        let defaultTheme = TerminalTheme.allThemes.first
        #expect(defaultTheme?.name == "Dracula")
    }

    @Test("Theme names are not empty")
    func themeNamesNotEmpty() {
        for theme in TerminalTheme.allThemes {
            #expect(!theme.name.isEmpty)
        }
    }

    @Test("All standard themes are included")
    func standardThemesIncluded() {
        let themeNames = Set(TerminalTheme.allThemes.map { $0.name })
        let expectedThemes = [
            "Dracula",
            "Monokai",
            "Solarized Dark",
            "Solarized Light",
            "Tomorrow Night",
            "Gruvbox Dark",
            "One Dark",
            "Nord",
            "Material",
            "Ayu Dark"
        ]

        for expectedTheme in expectedThemes {
            #expect(themeNames.contains(expectedTheme))
        }
    }

    @Test("Light themes have appropriate brightness")
    func lightThemeBrightness() {
        let lightThemes = ["Solarized Light"]

        for themeName in lightThemes {
            guard let theme = TerminalTheme.allThemes.first(where: { $0.name == themeName }) else {
                Issue.record("Theme \(themeName) not found")
                continue
            }

            // Light themes should have bright backgrounds
            let bgColor = theme.background.dropFirst() // Remove #
            if let bgValue = Int(bgColor, radix: 16) {
                let r = (bgValue >> 16) & 0xFF
                let g = (bgValue >> 8) & 0xFF
                let b = bgValue & 0xFF
                let brightness = (r + g + b) / 3

                #expect(brightness > 200) // Light themes should be bright
            }
        }
    }

    @Test("Dark themes have appropriate brightness")
    func darkThemeBrightness() {
        let darkThemes = ["Dracula", "Monokai", "Solarized Dark", "Tomorrow Night"]

        for themeName in darkThemes {
            guard let theme = TerminalTheme.allThemes.first(where: { $0.name == themeName }) else {
                Issue.record("Theme \(themeName) not found")
                continue
            }

            // Dark themes should have dark backgrounds
            let bgColor = theme.background.dropFirst() // Remove #
            if let bgValue = Int(bgColor, radix: 16) {
                let r = (bgValue >> 16) & 0xFF
                let g = (bgValue >> 8) & 0xFF
                let b = bgValue & 0xFF
                let brightness = (r + g + b) / 3

                #expect(brightness < 100) // Dark themes should be dark
            }
        }
    }

    @Test("Theme JSON representation")
    func themeJSON() {
        let theme = TerminalTheme(
            id: "test-theme",
            name: "Test Theme",
            background: "#000000",
            foreground: "#FFFFFF",
            cursor: "#FF0000",
            colors: [
                "#000000", "#FF0000", "#00FF00", "#FFFF00",
                "#0000FF", "#FF00FF", "#00FFFF", "#FFFFFF",
                "#808080", "#FF8080", "#80FF80", "#FFFF80",
                "#8080FF", "#FF80FF", "#80FFFF", "#C0C0C0"
            ]
        )

        let json = theme.toJSON()

        #expect(json["theme"] as? String == "test-theme")

        if let colors = json["colors"] as? [String: String] {
            #expect(colors["background"] == "#000000")
            #expect(colors["foreground"] == "#FFFFFF")
            #expect(colors["cursor"] == "#FF0000")
        } else {
            Issue.record("Colors dictionary not found in JSON")
        }
    }
}
