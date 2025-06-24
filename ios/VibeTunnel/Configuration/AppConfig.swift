import Foundation

/// App configuration for VibeTunnel
enum AppConfig {
    /// Set the logging level for the app
    /// Change this to control verbosity of logs
    static func configureLogging() {
        #if DEBUG
        // In debug builds, default to info level to reduce noise
        // Change to .verbose only when debugging binary protocol issues
        Logger.globalLevel = .info
        #else
        // In release builds, only show warnings and errors
        Logger.globalLevel = .warning
        #endif
    }
}
