import Foundation

/// Centralized error messages and user-facing strings
enum ErrorMessages {
    // MARK: - Notification Errors

    static func notificationPermissionError(_ error: Error) -> String {
        "Failed to request notification permissions: \(error.localizedDescription)"
    }

    // MARK: - Session Errors

    static let sessionNotFound = "Session not found"
    static let operationTimeout = "Operation timed out"
    static let invalidRequest = "Invalid request"
    static let sessionNameEmpty = "Session name cannot be empty"
    static let terminalWindowNotFound =
        "Could not find a terminal window for this session. The window may have been closed or the session was started outside VibeTunnel."
    static func windowNotFoundForSession(_ sessionID: String) -> String {
        "Could not find window for session \(sessionID)"
    }

    static func windowCloseFailedForSession(_ sessionID: String) -> String {
        "Failed to close window for session \(sessionID)"
    }

    // MARK: - Launch/Login Errors

    static func launchAtLoginError(_ enabled: Bool, _ error: Error) -> String {
        "Failed to \(enabled ? "register" : "unregister") for launch at login: \(error.localizedDescription)"
    }

    // MARK: - Process Errors

    static func errorOutputReadError(_ error: Error) -> String {
        "Could not read error output: \(error.localizedDescription)"
    }

    static func modificationDateError(_ path: String) -> String {
        "Could not get modification date for \(path)"
    }

    static func processTerminationError(_ pid: Int) -> String {
        "Failed to terminate process with PID \(pid)"
    }

    static func processLaunchError(_ error: Error) -> String {
        "Failed to launch process: \(error.localizedDescription)"
    }

    // MARK: - Keychain Errors

    static let keychainSaveError =
        "Failed to save the auth token to the keychain. Please check your keychain permissions and try again."
    static let keychainRetrieveError = "Failed to retrieve token from keychain"
    static let keychainAccessError = "Failed to access auth token. Please try again."
    static let keychainSaveTokenError = "Failed to save token to keychain"

    // MARK: - Server Errors

    static let serverRestartError = "Failed to Restart Server"
    static let socketCreationError = "Failed to create socket for port check"
    static let serverNotRunning = "Server is not running"
    static let invalidServerURL = "Invalid server URL"
    static let invalidServerResponse = "Invalid server response"

    // MARK: - URL Scheme Errors

    static let urlSchemeOpenError = "Failed to open URL scheme"
    static func terminalLaunchError(_ terminalName: String) -> String {
        "Failed to launch terminal: \(terminalName)"
    }

    // MARK: - Tunnel Errors

    static func tunnelCreationError(_ error: Error) -> String {
        "Failed to create tunnel: \(error.localizedDescription)"
    }

    static let ngrokPublicURLNotFound = "Could not find public URL in ngrok output"
    static func ngrokStartError(_ error: Error) -> String {
        "Failed to start ngrok: \(error.localizedDescription)"
    }

    static let ngrokNotInstalled =
        "ngrok is not installed. Please install it using 'brew install ngrok' or download from ngrok.com"
    static let ngrokAuthTokenMissing = "ngrok auth token is missing. Please add it in Settings"
    static let invalidNgrokConfiguration = "Invalid ngrok configuration"

    // MARK: - Permission Errors

    static let permissionDenied = "Permission Denied"
    static let accessibilityPermissionRequired = "Accessibility Permission Required"

    // MARK: - Terminal Errors

    static let terminalNotFound = "Terminal Not Found"
    static let terminalNotAvailable = "Terminal Not Available"
    static let terminalCommunicationError = "Terminal Communication Error"
    static let terminalLaunchFailed = "Terminal Launch Failed"

    // MARK: - CLI Tool Errors

    static let cliToolInstallationFailed = "CLI Tool Installation Failed"
}
