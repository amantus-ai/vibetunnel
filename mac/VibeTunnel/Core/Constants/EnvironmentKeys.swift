import Foundation

/// Centralized environment variable names
enum EnvironmentKeys {
    // MARK: - System Environment

    static let path = "PATH"
    static let lang = "LANG"

    // MARK: - Test Environment

    static let xcTestConfigurationFilePath = "XCTestConfigurationFilePath"
    static let ci = "CI"

    // MARK: - VibeTunnel Environment

    static let parentPID = "PARENT_PID"
    static let useDevelopmentServer = "USE_DEVELOPMENT_SERVER"
    static let authenticationMode = "AUTHENTICATION_MODE"
    static let authToken = "AUTH_TOKEN"
}
