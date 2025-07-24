import Foundation

/// Application preferences
struct AppPreferences {
    let preferredGitApp: String?
    let preferredTerminal: String?
    let showInDock: Bool
    let updateChannel: String

    static func current() -> Self {
        Self(
            preferredGitApp: UserDefaults.standard.string(forKey: AppConstants.UserDefaultsKeys.preferredGitApp),
            preferredTerminal: UserDefaults.standard.string(forKey: AppConstants.UserDefaultsKeys.preferredTerminal),
            showInDock: AppConstants.boolValue(for: AppConstants.UserDefaultsKeys.showInDock),
            updateChannel: AppConstants.stringValue(for: AppConstants.UserDefaultsKeys.updateChannel)
        )
    }
}
