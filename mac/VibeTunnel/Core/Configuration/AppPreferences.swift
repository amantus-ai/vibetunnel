import Foundation

/// Application preferences.
///
/// This struct manages user preferences for VibeTunnel, including
/// preferred applications for Git and terminal operations, UI preferences,
/// and update settings.
struct AppPreferences {
    /// The preferred Git GUI application.
    ///
    /// When set, VibeTunnel will use this application to open Git repositories.
    /// Common values include:
    /// - `"GitHubDesktop"`: GitHub Desktop
    /// - `"SourceTree"`: Atlassian SourceTree
    /// - `"Tower"`: Git Tower
    /// - `"Fork"`: Fork Git client
    /// - `nil`: Use system default or no preference
    let preferredGitApp: String?

    /// The preferred terminal application.
    ///
    /// When set, VibeTunnel will use this terminal for opening new sessions.
    /// Common values include:
    /// - `"Terminal"`: macOS Terminal.app
    /// - `"iTerm2"`: iTerm2
    /// - `"Alacritty"`: Alacritty
    /// - `"Hyper"`: Hyper terminal
    /// - `nil`: Use system default Terminal.app
    let preferredTerminal: String?

    /// Whether to show VibeTunnel in the macOS Dock.
    ///
    /// When `false`, the app runs as a menu bar only application.
    /// When `true`, the app icon appears in the Dock for easier access.
    let showInDock: Bool

    /// The update channel for automatic updates.
    ///
    /// Controls which releases the app checks for updates:
    /// - `"stable"`: Only stable releases
    /// - `"beta"`: Beta and stable releases
    /// - `"alpha"`: All releases including alpha builds
    /// - `"none"`: Disable automatic update checks
    let updateChannel: String

    /// Creates application preferences from current user defaults.
    ///
    /// This factory method reads the current preferences from user defaults
    /// to create a configuration instance that reflects the user's choices.
    ///
    /// - Returns: An `AppPreferences` instance with current user preferences.
    static func current() -> Self {
        Self(
            preferredGitApp: UserDefaults.standard.string(forKey: AppConstants.UserDefaultsKeys.preferredGitApp),
            preferredTerminal: UserDefaults.standard.string(forKey: AppConstants.UserDefaultsKeys.preferredTerminal),
            showInDock: AppConstants.boolValue(for: AppConstants.UserDefaultsKeys.showInDock),
            updateChannel: AppConstants.stringValue(for: AppConstants.UserDefaultsKeys.updateChannel)
        )
    }
}
