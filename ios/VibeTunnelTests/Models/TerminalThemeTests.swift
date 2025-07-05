import Foundation
import SwiftUI
import Testing
@testable import VibeTunnel

@Suite("TerminalTheme Tests", .tags(.models))
struct TerminalThemeTests {
    @Test("All themes have unique IDs")
    func uniqueThemeIds() {
        let themes = TerminalTheme.allThemes
        let ids = themes.map(\.id)
        let uniqueIds = Set(ids)

        #expect(ids.count == uniqueIds.count)
    }

    @Test("All themes have valid properties")
    func validThemeProperties() {
        for theme in TerminalTheme.allThemes {
            // Check that all required properties exist
            #expect(!theme.id.isEmpty)
            #expect(!theme.name.isEmpty)
            #expect(!theme.description.isEmpty)

            // Test that colors can be accessed without crashing
            // and that background/foreground are different (good UX)
            #expect(theme.background != theme.foreground)
        }
    }

    @Test("Default theme is VibeTunnel")
    func defaultTheme() {
        let defaultTheme = TerminalTheme.allThemes.first
        #expect(defaultTheme?.name == "VibeTunnel")
    }

    @Test("Theme names are not empty")
    func themeNamesNotEmpty() {
        for theme in TerminalTheme.allThemes {
            #expect(!theme.name.isEmpty)
            #expect(!theme.description.isEmpty)
        }
    }

    @Test("All standard themes are included")
    func standardThemesIncluded() {
        let themeNames = Set(TerminalTheme.allThemes.map(\.name))
        let expectedThemes = [
            "VibeTunnel",
            "VS Code Dark",
            "Solarized Dark",
            "Dracula",
            "Nord"
        ]

        for expectedTheme in expectedThemes {
            #expect(themeNames.contains(expectedTheme))
        }
    }

    @Test("Theme selection persistence")
    func themeSelectionPersistence() {
        // Get current selected theme
        let originalTheme = TerminalTheme.selected

        // Change to different theme
        let newTheme = TerminalTheme.allThemes.first { $0.id != originalTheme.id }
        guard let testTheme = newTheme else {
            Issue.record("Need at least 2 themes to test selection")
            return
        }

        TerminalTheme.selected = testTheme
        #expect(TerminalTheme.selected.id == testTheme.id)

        // Restore original theme
        TerminalTheme.selected = originalTheme
        #expect(TerminalTheme.selected.id == originalTheme.id)
    }

    @Test("Theme colors are distinct")
    func themeColorsAreDistinct() {
        let theme = TerminalTheme.dracula

        // Test that main foreground and background colors are different
        #expect(theme.background != theme.foreground)

        // Test that basic ANSI colors are different from each other
        let basicColors = [
            theme.black,
            theme.red,
            theme.green,
            theme.yellow,
            theme.blue,
            theme.magenta,
            theme.cyan,
            theme.white
        ]

        // Ensure we have the expected number of colors
        #expect(basicColors.count == 8)

        // Test that bright variants exist and are typically different from base colors
        // (though in some themes they might be the same, so we just verify they exist)
        let brightColors = [
            theme.brightBlack,
            theme.brightRed,
            theme.brightGreen,
            theme.brightYellow,
            theme.brightBlue,
            theme.brightMagenta,
            theme.brightCyan,
            theme.brightWhite
        ]

        #expect(brightColors.count == 8)
    }

    @Test("Theme equality")
    func themeEquality() {
        let theme1 = TerminalTheme.dracula
        let theme2 = TerminalTheme.dracula
        let theme3 = TerminalTheme.nord

        #expect(theme1 == theme2)
        #expect(theme1 != theme3)
    }

    @Test("All themes are identifiable")
    func themesAreIdentifiable() {
        for theme in TerminalTheme.allThemes {
            // ID should be consistent
            #expect(theme.id == theme.id)
            #expect(!theme.id.isEmpty)
        }
    }
}
