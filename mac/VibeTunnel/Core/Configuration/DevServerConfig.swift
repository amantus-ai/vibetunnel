import Foundation

/// Development server configuration.
///
/// This struct manages the configuration for using a development server
/// instead of the embedded production server. This is particularly useful
/// for web development as it enables hot reload functionality.
struct DevServerConfig {
    /// Whether to use the development server instead of the embedded server.
    ///
    /// When `true`, the app will run `pnpm run dev` to start a development
    /// server with hot reload capabilities. When `false`, the app uses the
    /// pre-built embedded web server.
    let useDevServer: Bool

    /// The path to the development server directory.
    ///
    /// This should point to the directory containing the web application
    /// source code where `pnpm run dev` can be executed. Typically this
    /// is the `web/` directory in the VibeTunnel repository.
    let devServerPath: String

    /// Creates a development server configuration from current user defaults.
    ///
    /// This factory method reads the current settings from user defaults
    /// to create a configuration instance that reflects the user's preferences.
    ///
    /// - Returns: A `DevServerConfig` instance with current settings.
    static func current() -> Self {
        Self(
            useDevServer: AppConstants.boolValue(for: AppConstants.UserDefaultsKeys.useDevServer),
            devServerPath: AppConstants.stringValue(for: AppConstants.UserDefaultsKeys.devServerPath)
        )
    }
}
