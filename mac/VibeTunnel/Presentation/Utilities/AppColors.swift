import SwiftUI

/// Centralized color definitions for VibeTunnel that adapt to light/dark mode
enum AppColors {
    /// Git branch color - orange tone
    static var gitBranch: Color {
        Color("GitBranch", bundle: nil)
            .opacity(1.0)
    }

    /// Git changes color - yellow/amber tone
    static var gitChanges: Color {
        Color("GitChanges", bundle: nil)
            .opacity(1.0)
    }

    /// Git clean/success color - green tone
    static var gitClean: Color {
        Color("GitClean", bundle: nil)
            .opacity(1.0)
    }

    /// Server running status - green
    static var serverRunning: Color {
        Color("ServerRunning", bundle: nil)
            .opacity(1.0)
    }

    /// Activity indicator - orange
    static var activityIndicator: Color {
        Color("ActivityIndicator", bundle: nil)
            .opacity(1.0)
    }

    /// Fallback colors if asset catalog colors are not defined
    enum Fallback {
        static func gitBranch(for colorScheme: ColorScheme) -> Color {
            colorScheme == .dark
                ? Color(red: 0.7, green: 0.5, blue: 0.8) // Subtle purple in dark mode
                : Color(red: 0.5, green: 0.3, blue: 0.6) // Darker purple in light mode
        }

        static func gitChanges(for colorScheme: ColorScheme) -> Color {
            colorScheme == .dark
                ? Color(red: 0.8, green: 0.7, blue: 0.4) // Muted gold in dark mode
                : Color(red: 0.6, green: 0.5, blue: 0.2) // Darker gold in light mode
        }

        static func gitClean(for colorScheme: ColorScheme) -> Color {
            colorScheme == .dark
                ? Color(red: 0.3, green: 0.8, blue: 0.3) // Lighter in dark mode
                : Color(red: 0.0, green: 0.6, blue: 0.0) // Darker in light mode
        }

        static func serverRunning(for colorScheme: ColorScheme) -> Color {
            colorScheme == .dark
                ? Color(red: 0.3, green: 0.8, blue: 0.3) // Lighter in dark mode
                : Color(red: 0.0, green: 0.6, blue: 0.0) // Darker in light mode
        }

        static func activityIndicator(for colorScheme: ColorScheme) -> Color {
            colorScheme == .dark
                ? Color(red: 0.9, green: 0.5, blue: 0.2) // Lighter in dark mode
                : Color(red: 0.7, green: 0.35, blue: 0.0) // Darker in light mode
        }

        static func hoverBackground(for colorScheme: ColorScheme) -> Color {
            colorScheme == .dark
                ? Color.gray.opacity(0.15)
                : Color.gray.opacity(0.1)
        }

        static func accentHover(for colorScheme: ColorScheme) -> Color {
            colorScheme == .dark
                ? Color.accentColor.opacity(0.08)
                : Color.accentColor.opacity(0.15)
        }

        static func destructive(for colorScheme: ColorScheme) -> Color {
            colorScheme == .dark
                ? Color.red.opacity(0.9)
                : Color.red
        }

        static func controlBackground(for colorScheme: ColorScheme) -> Color {
            Color(NSColor.controlBackgroundColor)
        }

        static func secondaryText(for colorScheme: ColorScheme) -> Color {
            Color.secondary
        }

        /// Git-specific colors
        static func gitFolder(for colorScheme: ColorScheme) -> Color {
            colorScheme == .dark
                ? Color(red: 0.4, green: 0.6, blue: 0.8) // Light blue in dark mode
                : Color(red: 0.2, green: 0.4, blue: 0.6) // Darker blue in light mode
        }

        static func gitFolderHover(for colorScheme: ColorScheme) -> Color {
            colorScheme == .dark
                ? Color(red: 0.5, green: 0.7, blue: 0.9) // Lighter blue in dark mode
                : Color(red: 0.1, green: 0.3, blue: 0.5) // Even darker blue in light mode
        }

        static func gitModified(for colorScheme: ColorScheme) -> Color {
            colorScheme == .dark
                ? Color(red: 0.9, green: 0.7, blue: 0.3) // Yellow in dark mode
                : Color(red: 0.7, green: 0.5, blue: 0.1) // Darker yellow in light mode
        }

        static func gitAdded(for colorScheme: ColorScheme) -> Color {
            colorScheme == .dark
                ? Color(red: 0.3, green: 0.8, blue: 0.3) // Green in dark mode
                : Color(red: 0.1, green: 0.6, blue: 0.1) // Darker green in light mode
        }

        static func gitDeleted(for colorScheme: ColorScheme) -> Color {
            colorScheme == .dark
                ? Color(red: 0.9, green: 0.3, blue: 0.3) // Red in dark mode
                : Color(red: 0.7, green: 0.1, blue: 0.1) // Darker red in light mode
        }

        static func gitUntracked(for colorScheme: ColorScheme) -> Color {
            colorScheme == .dark
                ? Color(red: 0.6, green: 0.6, blue: 0.6) // Gray in dark mode
                : Color(red: 0.4, green: 0.4, blue: 0.4) // Darker gray in light mode
        }

        static func gitBackground(for colorScheme: ColorScheme) -> Color {
            colorScheme == .dark
                ? Color.gray.opacity(0.2)
                : Color.gray.opacity(0.1)
        }

        static func gitBorder(for colorScheme: ColorScheme) -> Color {
            colorScheme == .dark
                ? Color.gray.opacity(0.3)
                : Color.gray.opacity(0.2)
        }
    }
}

/// Extension to use fallback colors when needed
extension View {
    func gitBranchColor(_ colorScheme: ColorScheme) -> Color {
        AppColors.Fallback.gitBranch(for: colorScheme)
    }

    func gitChangesColor(_ colorScheme: ColorScheme) -> Color {
        AppColors.Fallback.gitChanges(for: colorScheme)
    }

    func gitCleanColor(_ colorScheme: ColorScheme) -> Color {
        AppColors.Fallback.gitClean(for: colorScheme)
    }

    func serverRunningColor(_ colorScheme: ColorScheme) -> Color {
        AppColors.Fallback.serverRunning(for: colorScheme)
    }

    func activityIndicatorColor(_ colorScheme: ColorScheme) -> Color {
        AppColors.Fallback.activityIndicator(for: colorScheme)
    }
}
