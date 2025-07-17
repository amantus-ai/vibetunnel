import AppKit
import CryptoKit
import Foundation
import Observation
import os.log
import SwiftUI

/// Service responsible for creating symlinks to command line tools with sudo authentication.
///
/// ## Overview
/// This service creates symlinks from the application bundle's resources to system locations like /usr/local/bin
/// to enable command line access to bundled tools. It handles sudo authentication through system dialogs.
///
/// ## Usage
/// ```swift
/// let installer = CLIInstaller()
/// installer.installCLITool()
/// ```
///
/// ## Safety Considerations
/// - Always prompts user before performing operations requiring sudo
/// - Provides clear error messages and graceful failure handling
/// - Checks for existing symlinks and handles conflicts appropriately
/// - Logs all operations for debugging purposes
@MainActor
@Observable
final class CLIInstaller {
    // MARK: - Properties

    private let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "CLIInstaller")
    private let binDirectory: String

    private var vtTargetPath: String {
        URL(fileURLWithPath: binDirectory).appendingPathComponent("vt").path
    }

    var isInstalled = false
    var isInstalling = false
    var lastError: String?
    var isOutdated = false

    // MARK: - Initialization

    /// Creates a CLI installer
    /// - Parameters:
    ///   - binDirectory: Directory for installation (defaults to /usr/local/bin)
    init(binDirectory: String = "/usr/local/bin") {
        self.binDirectory = binDirectory
    }

    // MARK: - Public Interface

    /// Checks if the CLI tool is installed
    func checkInstallationStatus() {
        Task { @MainActor in
            // Check if vt script exists and is configured correctly
            var isCorrectlyInstalled = false

            // Check both /usr/local/bin and Apple Silicon Homebrew path
            let pathsToCheck = [
                vtTargetPath,
                "/opt/homebrew/bin/vt"
            ]

            for path in pathsToCheck where FileManager.default.fileExists(atPath: path) {
                // Check if it contains the correct app path reference
                if let content = try? String(contentsOfFile: path, encoding: .utf8) {
                    // Verify it's our wrapper script with all expected components
                    // Check for the exec command with flexible quoting and optional arguments
                    // Allow for optional variables or arguments between $VIBETUNNEL_BIN and fwd
                    let hasValidExecCommand = content.range(of: #"exec\s+["']?\$VIBETUNNEL_BIN["']?\s+fwd"#, options: .regularExpression) != nil
                    
                    if content.contains("VibeTunnel CLI wrapper") &&
                        content.contains("$TRY_PATH/Contents/Resources/vibetunnel") &&
                        hasValidExecCommand
                    {
                        isCorrectlyInstalled = true
                        logger.info("CLIInstaller: Found valid vt script at \(path)")
                        break
                    }
                }
            }

            // Update state
            isInstalled = isCorrectlyInstalled

            logger.info("CLIInstaller: vt script installed: \(self.isInstalled)")

            // If installed, check if it's outdated
            if isInstalled {
                checkScriptVersion()
            } else {
                isOutdated = false
            }
        }
    }

    /// Installs the CLI tool (async version for WelcomeView)
    func install() async {
        await MainActor.run {
            installCLITool()
        }
    }

    /// Installs the vt CLI tool to /usr/local/bin
    func installCLITool() {
        logger.info("CLIInstaller: Starting CLI tool installation...")
        isInstalling = true
        lastError = nil

        // Verify that vt script exists in the app bundle
        guard Bundle.main.path(forResource: "vt", ofType: nil) != nil else {
            logger.error("CLIInstaller: Could not find vt script in app bundle")
            lastError = "The vt script could not be found in the application bundle."
            showError("The vt script could not be found in the application bundle.")
            isInstalling = false
            return
        }

        // Show confirmation dialog
        let confirmAlert = NSAlert()
        confirmAlert.messageText = "Install VT Command Line Tool"
        confirmAlert
            .informativeText =
            "This will install the 'vt' command that runs VibeTunnel from your Applications folder. Administrator privileges are required."
        confirmAlert.addButton(withTitle: "Install")
        confirmAlert.addButton(withTitle: "Cancel")
        confirmAlert.alertStyle = .informational
        confirmAlert.icon = NSApp.applicationIconImage

        let response = confirmAlert.runModal()
        if response != .alertFirstButtonReturn {
            logger.info("CLIInstaller: User cancelled installation")
            isInstalling = false
            return
        }

        // Perform the installation
        performInstallation()
    }

    // MARK: - Private Implementation

    /// Performs the actual installation with sudo privileges
    private func performInstallation() {
        logger.info("CLIInstaller: Installing vt script")

        guard let vtScriptPath = Bundle.main.path(forResource: "vt", ofType: nil) else {
            logger.error("CLIInstaller: Could not find vt script in app bundle")
            lastError = "The vt script could not be found in the application bundle."
            showError("The vt script could not be found in the application bundle.")
            isInstalling = false
            return
        }

        // Create the installation script
        let script = """
        #!/bin/bash
        set -e

        # Create /usr/local/bin if it doesn't exist
        if [ ! -d "\(binDirectory)" ]; then
            mkdir -p "\(binDirectory)"
            echo "Created directory \(binDirectory)"
        fi

        # Remove existing vt if it exists
        if [ -L "\(vtTargetPath)" ] || [ -f "\(vtTargetPath)" ]; then
            rm -f "\(vtTargetPath)"
            echo "Removed existing file at \(vtTargetPath)"
        fi

        # Copy vt script from app bundle
        cp "\(vtScriptPath)" "\(vtTargetPath)"
        chmod +x "\(vtTargetPath)"
        echo "Installed vt script at \(vtTargetPath)"

        # Clean up old vibetunnel binary if it exists
        if [ -f "/usr/local/bin/vibetunnel" ]; then
            rm -f "/usr/local/bin/vibetunnel"
            echo "Removed old vibetunnel binary"
        fi
        """

        // Write the script to a temporary file
        let tempDir = FileManager.default.temporaryDirectory
        let scriptURL = tempDir.appendingPathComponent("install_vt_cli.sh")

        do {
            try script.write(to: scriptURL, atomically: true, encoding: .utf8)

            // Make the script executable
            let attributes: [FileAttributeKey: Any] = [.posixPermissions: 0o755]
            try FileManager.default.setAttributes(attributes, ofItemAtPath: scriptURL.path)

            logger.info("CLIInstaller: Created installation script at \(scriptURL.path)")

            // Execute with osascript to get sudo dialog
            let appleScript = """
            do shell script "bash '\(scriptURL.path)'" with administrator privileges
            """

            let task = Process()
            task.launchPath = "/usr/bin/osascript"
            task.arguments = ["-e", appleScript]

            let pipe = Pipe()
            let errorPipe = Pipe()
            task.standardOutput = pipe
            task.standardError = errorPipe

            try task.run()
            task.waitUntilExit()

            // Clean up the temporary script
            try? FileManager.default.removeItem(at: scriptURL)

            if task.terminationStatus == 0 {
                logger.info("CLIInstaller: Installation completed successfully")
                isInstalled = true
                isInstalling = false
                showSuccess()
                // Refresh installation status
                checkInstallationStatus()
            } else {
                let errorString: String
                do {
                    if let errorData = try errorPipe.fileHandleForReading.readToEnd() {
                        errorString = String(data: errorData, encoding: .utf8) ?? "Unknown error"
                    } else {
                        errorString = "Unknown error"
                    }
                } catch {
                    logger.debug("Could not read error output: \(error.localizedDescription)")
                    errorString = "Unknown error (could not read stderr)"
                }
                logger.error("CLIInstaller: Installation failed with status \(task.terminationStatus): \(errorString)")
                lastError = "Installation failed: \(errorString)"
                isInstalling = false
                showError("Installation failed: \(errorString)")
            }
        } catch {
            logger.error("CLIInstaller: Installation failed with error: \(error)")
            lastError = "Installation failed: \(error.localizedDescription)"
            isInstalling = false
            showError("Installation failed: \(error.localizedDescription)")
        }
    }

    /// Shows success message after installation
    private func showSuccess() {
        let alert = NSAlert()
        alert.messageText = "CLI Tools Installed Successfully"
        alert
            .informativeText =
            "The 'vt' command has been installed. You can now use 'vt' from the terminal to run VibeTunnel."
        alert.addButton(withTitle: "OK")
        alert.alertStyle = .informational
        alert.icon = NSApp.applicationIconImage
        alert.runModal()
    }

    /// Shows error message for installation failures
    private func showError(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "CLI Tool Installation Failed"
        alert.informativeText = message
        alert.addButton(withTitle: "OK")
        alert.alertStyle = .critical
        alert.runModal()
    }

    // MARK: - Script Version Detection

    /// Calculates SHA256 hash of a file
    private func calculateHash(for filePath: String) -> String? {
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: filePath)) else {
            return nil
        }

        let hash = SHA256.hash(data: data)
        return hash.compactMap { String(format: "%02x", $0) }.joined()
    }

    /// Gets the hash of the bundled vt script
    private func getBundledScriptHash() -> String? {
        guard let scriptPath = Bundle.main.path(forResource: "vt", ofType: nil) else {
            logger.error("CLIInstaller: Bundled vt script not found")
            return nil
        }

        return calculateHash(for: scriptPath)
    }

    /// Checks if the installed script is outdated compared to bundled version
    func checkScriptVersion() {
        Task { @MainActor in
            guard let bundledHash = getBundledScriptHash() else {
                logger.error("CLIInstaller: Failed to get bundled script hash")
                return
            }

            // Check both possible installation paths
            let pathsToCheck = [
                vtTargetPath,
                "/opt/homebrew/bin/vt"
            ]

            var installedHash: String?
            for path in pathsToCheck where FileManager.default.fileExists(atPath: path) {
                if let hash = calculateHash(for: path) {
                    installedHash = hash
                    break
                }
            }

            // Update outdated status
            if let installedHash {
                self.isOutdated = (installedHash != bundledHash)
                logger.info("CLIInstaller: Script version check - outdated: \(self.isOutdated)")
                logger.debug("CLIInstaller: Bundled hash: \(bundledHash), Installed hash: \(installedHash)")
            } else {
                // Script not installed
                self.isOutdated = false
            }
        }
    }
}
