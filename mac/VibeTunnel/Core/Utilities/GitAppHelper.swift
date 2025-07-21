import Foundation

/// Helper utilities for Git app preferences
enum GitAppHelper {
    /// Get the display name of the preferred Git app or a default
    static func getPreferredGitAppName() -> String {
        if let preferredApp = AppConstants.getPreferredGitApp(),
           !preferredApp.isEmpty,
           let gitApp = GitApp(rawValue: preferredApp) {
            return gitApp.displayName
        }
        // Return first installed git app or default
        return GitApp.installed.first?.displayName ?? "Git App"
    }
    
    /// Check if a specific Git app is the preferred one
    static func isPreferredApp(_ app: GitApp) -> Bool {
        guard let preferredApp = AppConstants.getPreferredGitApp(),
              let gitApp = GitApp(rawValue: preferredApp) else {
            return false
        }
        return gitApp == app
    }
}