import AppKit
import Foundation
import os.log
import SwiftUI

/// Terminal launch configuration
struct TerminalLaunchConfig {
    let command: String
    let workingDirectory: String?
    let terminal: Terminal

    var fullCommand: String {
        guard let workingDirectory else {
            return command
        }
        let escapedDir = workingDirectory.replacingOccurrences(of: "\"", with: "\\\"")
        return "cd \"\(escapedDir)\" && \(command)"
    }

    var escapedCommand: String {
        command
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
    }

    var appleScriptEscapedCommand: String {
        fullCommand
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "'", with: "'\\''")
    }

    var keystrokeEscapedCommand: String {
        // For keystroke commands, we need to escape backslashes and quotes
        // AppleScript keystroke requires double-escaping for quotes
        fullCommand
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
    }
}

/// Terminal launch methods
enum TerminalLaunchMethod {
    case appleScript(script: String)
    case processWithArgs(args: [String])
    case processWithTyping(delaySeconds: Double = 0.5)
    case urlScheme(url: String)
}

/// Supported terminal applications.
///
/// Represents terminal emulators that VibeTunnel can launch
/// with commands, including detection of installed terminals.
///
/// Note: Tabby is not included as it shows a startup screen
/// which makes it difficult to support automated command execution.
enum Terminal: String, CaseIterable {
    case terminal = "Terminal"
    case iTerm2 = "iTerm2"
    case ghostty = "Ghostty"
    case warp = "Warp"
    case alacritty = "Alacritty"
    case hyper = "Hyper"
    case wezterm = "WezTerm"

    var bundleIdentifier: String {
        switch self {
        case .terminal:
            "com.apple.Terminal"
        case .iTerm2:
            "com.googlecode.iterm2"
        case .ghostty:
            "com.mitchellh.ghostty"
        case .warp:
            "dev.warp.Warp-Stable"
        case .alacritty:
            "org.alacritty"
        case .hyper:
            "co.zeit.hyper"
        case .wezterm:
            "com.github.wez.wezterm"
        }
    }

    /// Priority for auto-detection (higher is better, based on popularity)
    var detectionPriority: Int {
        switch self {
        case .terminal: 100 // Highest - macOS default, most popular
        case .iTerm2: 95 // Very popular among developers
        case .warp: 85 // Popular modern terminal
        case .ghostty: 80 // New but gaining popularity
        case .alacritty: 70 // Popular among power users
        case .wezterm: 60 // Less common but powerful
        case .hyper: 50 // Less popular Electron-based
        }
    }

    var displayName: String {
        rawValue
    }

    var isInstalled: Bool {
        if self == .terminal {
            return true // Terminal is always installed
        }
        return NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleIdentifier) != nil
    }

    var appIcon: NSImage? {
        guard let appURL = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleIdentifier) else {
            return nil
        }
        return NSWorkspace.shared.icon(forFile: appURL.path)
    }

    static var installed: [Self] {
        allCases.filter(\.isInstalled)
    }

    /// Generate unified AppleScript for all terminals
    func unifiedAppleScript(for config: TerminalLaunchConfig) -> String {
        // Terminal.app supports 'do script' which handles complex commands better
        if self == .terminal {
            return """
            tell application "Terminal"
                activate
                do script "\(config.appleScriptEscapedCommand)"
            end tell
            """
        }

        // For all other terminals, use clipboard approach for reliability
        // This avoids issues with special characters and long commands
        // Note: The command is already copied to clipboard before this script runs
        return """
        tell application "\(processName)"
            activate
            tell application "System Events"
                -- Create new window/tab
                keystroke "n" using {command down}
                delay 0.5
                -- Paste command from clipboard
                keystroke "v" using {command down}
                delay 0.1
                -- Execute the command
                key code 36
            end tell
        end tell
        """
    }

    /// Determine the launch method for this terminal
    /// The idea is that we optimize this later to use sth faster than AppleScript if available
    func launchMethod(for config: TerminalLaunchConfig) -> TerminalLaunchMethod {
        switch self {
        case .terminal:
            // Use unified AppleScript approach for consistency
            .appleScript(script: unifiedAppleScript(for: config))

        case .iTerm2:
            // Use unified AppleScript approach for consistency
            .appleScript(script: unifiedAppleScript(for: config))

        case .ghostty:
            // Use unified AppleScript approach
            .appleScript(script: unifiedAppleScript(for: config))

        case .alacritty:
            // Use unified AppleScript approach for consistency
            .appleScript(script: unifiedAppleScript(for: config))

        case .warp:
            // Use unified AppleScript approach
            .appleScript(script: unifiedAppleScript(for: config))

        case .hyper:
            // Use unified AppleScript approach
            .appleScript(script: unifiedAppleScript(for: config))

        case .wezterm:
            // Use unified AppleScript approach for consistency
            .appleScript(script: unifiedAppleScript(for: config))
        }
    }

    /// Process name for AppleScript typing
    var processName: String {
        switch self {
        case .terminal: "Terminal"
        case .iTerm2: "iTerm"
        case .ghostty: "Ghostty"
        case .warp: "Warp"
        case .alacritty: "Alacritty"
        case .hyper: "Hyper"
        case .wezterm: "WezTerm"
        }
    }

    /// Whether this terminal requires keystroke-based input (needs Accessibility permission)
    var requiresKeystrokeInput: Bool {
        // All terminals now use keystroke-based input
        true
    }
}

/// Errors that can occur when launching terminal commands.
///
/// Represents failures during terminal application launch,
/// including permission issues and missing applications.
enum TerminalLauncherError: LocalizedError {
    case terminalNotFound
    case appleScriptPermissionDenied
    case accessibilityPermissionDenied
    case appleScriptExecutionFailed(String, errorCode: Int?)
    case processLaunchFailed(String)

    var errorDescription: String? {
        switch self {
        case .terminalNotFound:
            "Selected terminal application not found"
        case .appleScriptPermissionDenied:
            "AppleScript permission denied. Please grant permission in System Settings."
        case .accessibilityPermissionDenied:
            "Accessibility permission required to send keystrokes. Please grant permission in System Settings."
        case .appleScriptExecutionFailed(let message, let errorCode):
            if let code = errorCode {
                "AppleScript error \(code): \(message)"
            } else {
                "AppleScript error: \(message)"
            }
        case .processLaunchFailed(let message):
            "Failed to launch process: \(message)"
        }
    }

    var failureReason: String? {
        switch self {
        case .appleScriptPermissionDenied:
            return "VibeTunnel needs Automation permission to control terminal applications."
        case .accessibilityPermissionDenied:
            return "VibeTunnel needs Accessibility permission to send keystrokes to terminal applications."
        case .appleScriptExecutionFailed(_, let errorCode):
            if let code = errorCode {
                switch code {
                case -1_743:
                    return "User permission is required to control other applications."
                case -1_728:
                    return "The application is not running or cannot be controlled."
                case -1_708:
                    return "The event was not handled by the target application."
                case -25_211:
                    return "Accessibility permission is required to send keystrokes."
                default:
                    return nil
                }
            }
            return nil
        default:
            return nil
        }
    }
}

/// Manages launching terminal commands in the user's preferred terminal.
///
/// Handles terminal application detection, preference management,
/// and command execution through AppleScript or direct process launching.
/// Supports Terminal, iTerm2, and Ghostty with automatic fallback.
@MainActor
final class TerminalLauncher {
    static let shared = TerminalLauncher()

    private let logger = Logger(subsystem: "sh.vibetunnel.VibeTunnel", category: "TerminalLauncher")

    @AppStorage("preferredTerminal")
    private var preferredTerminal = Terminal.terminal.rawValue

    private init() {
        logger.info("TerminalLauncher initializing...")
        performFirstRunAutoDetection()
        logger.info("TerminalLauncher initialized successfully")
    }

    func launchCommand(_ command: String) throws {
        let terminal = getValidTerminal()
        let config = TerminalLaunchConfig(command: command, workingDirectory: nil, terminal: terminal)
        try launchWithConfig(config)
    }

    func verifyPreferredTerminal() {
        let terminal = Terminal(rawValue: preferredTerminal) ?? .terminal
        if !terminal.isInstalled {
            preferredTerminal = Terminal.terminal.rawValue
        }
    }

    // MARK: - Private Methods

    private func performFirstRunAutoDetection() {
        // Check if terminal preference has already been set
        let hasSetPreference = UserDefaults.standard.object(forKey: "preferredTerminal") != nil

        if !hasSetPreference {
            logger.info("First run detected, auto-detecting preferred terminal from running processes")

            if let detectedTerminal = detectRunningTerminals() {
                preferredTerminal = detectedTerminal.rawValue
                logger.info("Auto-detected and set preferred terminal to: \(detectedTerminal.rawValue)")
            } else {
                // No terminals detected in running processes, check installed terminals
                let installedTerminals = Terminal.installed.filter { $0 != .terminal }
                if let bestTerminal = installedTerminals.max(by: { $0.detectionPriority < $1.detectionPriority }) {
                    preferredTerminal = bestTerminal.rawValue
                    logger
                        .info(
                            "No running terminals found, set preferred terminal to most popular installed: \(bestTerminal.rawValue)"
                        )
                }
            }
        }
    }

    private func detectRunningTerminals() -> Terminal? {
        // Get all running applications
        let runningApps = NSWorkspace.shared.runningApplications

        // Find all terminals that are currently running
        var runningTerminals: [Terminal] = []

        for terminal in Terminal.allCases
            where runningApps.contains(where: { $0.bundleIdentifier == terminal.bundleIdentifier })
        {
            runningTerminals.append(terminal)
            logger.debug("Detected running terminal: \(terminal.rawValue)")
        }

        // Return the terminal with highest priority
        return runningTerminals.max { $0.detectionPriority < $1.detectionPriority }
    }

    private func getValidTerminal() -> Terminal {
        let terminal = Terminal(rawValue: preferredTerminal) ?? .terminal
        let actualTerminal = terminal.isInstalled ? terminal : .terminal

        if actualTerminal != terminal {
            // Update preference to fallback
            preferredTerminal = actualTerminal.rawValue
            logger
                .warning(
                    "Preferred terminal \(terminal.rawValue) not installed, falling back to \(actualTerminal.rawValue)"
                )
        }

        return actualTerminal
    }

    private func launchWithConfig(_ config: TerminalLaunchConfig) throws {
        logger.debug("Launch config - command: \(config.command)")
        logger.debug("Launch config - fullCommand: \(config.fullCommand)")
        logger.debug("Launch config - keystrokeEscapedCommand: \(config.keystrokeEscapedCommand)")

        let method = config.terminal.launchMethod(for: config)

        switch method {
        case .appleScript(let script):
            logger.debug("Generated AppleScript:\n\(script)")
            // For non-Terminal.app terminals, copy command to clipboard first
            if config.terminal != .terminal {
                copyToClipboard(config.fullCommand)
            }
            try executeAppleScript(script)

        case .processWithArgs(let args):
            try launchProcess(bundleIdentifier: config.terminal.bundleIdentifier, args: args)

        case .processWithTyping(let delay):
            try launchProcess(bundleIdentifier: config.terminal.bundleIdentifier, args: [])

            // Give the terminal time to start
            Thread.sleep(forTimeInterval: delay)

            // Use the same keystroke pattern as other terminals
            try executeAppleScript(config.terminal.unifiedAppleScript(for: config))

        case .urlScheme(let url):
            // Open URL schemes using NSWorkspace
            guard let nsUrl = URL(string: url) else {
                throw TerminalLauncherError.processLaunchFailed("Invalid URL: \(url)")
            }

            if !NSWorkspace.shared.open(nsUrl) {
                // Fallback to using 'open' command if NSWorkspace fails
                let process = Process()
                process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
                process.arguments = [url]

                do {
                    try process.run()
                    process.waitUntilExit()

                    if process.terminationStatus != 0 {
                        throw TerminalLauncherError.processLaunchFailed("Failed to open URL scheme")
                    }
                } catch {
                    throw TerminalLauncherError.processLaunchFailed(error.localizedDescription)
                }
            }
        }
    }

    private func launchProcess(bundleIdentifier: String, args: [String]) throws {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        process.arguments = ["-b", bundleIdentifier] + args

        do {
            try process.run()
            process.waitUntilExit()

            if process.terminationStatus != 0 {
                throw TerminalLauncherError
                    .processLaunchFailed("Process exited with status \(process.terminationStatus)")
            }
        } catch {
            logger.error("Failed to launch terminal: \(error.localizedDescription)")
            throw TerminalLauncherError.processLaunchFailed(error.localizedDescription)
        }
    }

    private func copyToClipboard(_ text: String) {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(text, forType: .string)
    }

    private func executeAppleScript(_ script: String) throws {
        do {
            // Use a longer timeout (15 seconds) for terminal launch operations
            // as some terminals (like Ghostty) can take longer to start up
            try AppleScriptExecutor.shared.execute(script, timeout: 15.0)
        } catch let error as AppleScriptError {
            // Check if this is a permission error
            if case .executionFailed(_, let errorCode) = error,
               let code = errorCode
            {
                switch code {
                case -25_211, -1_719:
                    // These error codes indicate accessibility permission issues
                    throw TerminalLauncherError.accessibilityPermissionDenied
                case -2_741:
                    // This is a syntax error: "Expected end of line but found identifier"
                    // It usually means the AppleScript has unescaped quotes or other syntax issues
                    throw TerminalLauncherError.appleScriptExecutionFailed(
                        "AppleScript syntax error - likely unescaped quotes in command",
                        errorCode: code
                    )
                default:
                    break
                }
            }
            // Convert AppleScriptError to TerminalLauncherError
            throw error.toTerminalLauncherError()
        } catch {
            // Handle any unexpected errors
            throw TerminalLauncherError.appleScriptExecutionFailed(error.localizedDescription, errorCode: nil)
        }
    }

    // MARK: - Terminal Session Launching

    func launchTerminalSession(workingDirectory: String, command: String, sessionId: String) throws {
        // Find tty-fwd binary path
        let ttyFwdPath = findTTYFwdBinary()

        // Expand tilde in working directory path
        let expandedWorkingDir = (workingDirectory as NSString).expandingTildeInPath

        // Escape the working directory for shell
        let escapedWorkingDir = expandedWorkingDir.replacingOccurrences(of: "\"", with: "\\\"")

        // Construct the full command with cd && tty-fwd && exit pattern
        // tty-fwd will use TTY_SESSION_ID from environment or generate one
        let fullCommand =
            "cd \"\(escapedWorkingDir)\" && TTY_SESSION_ID=\"\(sessionId)\" \(ttyFwdPath) -- \(command) && exit"

        // Get the preferred terminal or fallback
        let terminal = getValidTerminal()

        // Launch with configuration - no working directory since we handle it in the command
        let config = TerminalLaunchConfig(
            command: fullCommand,
            workingDirectory: nil,
            terminal: terminal
        )
        try launchWithConfig(config)
    }

    /// Optimized terminal session launching that receives pre-formatted command from Rust
    func launchOptimizedTerminalSession(
        workingDirectory: String,
        command: String,
        sessionId: String,
        ttyFwdPath: String? = nil
    )
        throws
    {
        // Expand tilde in working directory path
        let expandedWorkingDir = (workingDirectory as NSString).expandingTildeInPath

        // Use provided tty-fwd path or find bundled one
        let ttyFwd = ttyFwdPath ?? findTTYFwdBinary()

        // Properly escape the directory path for shell
        let escapedDir = expandedWorkingDir.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")

        // When called from Swift server, we need to construct the full command with tty-fwd
        // When called from Rust via socket, command is already pre-formatted
        let fullCommand: String = if command.contains("TTY_SESSION_ID=") {
            // Command is pre-formatted from Rust, just add cd
            "cd \"\(escapedDir)\" && \(command)"
        } else {
            // Command is just the user command, need to add tty-fwd
            "cd \"\(escapedDir)\" && TTY_SESSION_ID=\"\(sessionId)\" \(ttyFwd) -- \(command) && exit"
        }

        // Get the preferred terminal or fallback
        let terminal = getValidTerminal()

        // Launch with configuration
        let config = TerminalLaunchConfig(
            command: fullCommand,
            workingDirectory: nil,
            terminal: terminal
        )
        try launchWithConfig(config)
    }

    private func findTTYFwdBinary() -> String {
        // Look for bundled tty-fwd binary (shipped with the app)
        if let bundledTTYFwd = Bundle.main.path(forResource: "tty-fwd", ofType: nil) {
            logger.info("Using bundled tty-fwd at: \(bundledTTYFwd)")
            return bundledTTYFwd
        }

        logger.error("No tty-fwd binary found in app bundle, command will fail")
        return "echo 'VibeTunnel: tty-fwd binary not found in app bundle'; false"
    }
}
