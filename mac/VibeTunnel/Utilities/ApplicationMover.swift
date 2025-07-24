import AppKit
import Darwin.sys.mount
import Foundation
import os.log

/// Service responsible for detecting if the app is running from a DMG and offering to move it to Applications.
///
/// ## Overview
/// This service automatically detects when the app is running from a temporary location (such as a DMG,
/// Downloads folder, or Desktop) and offers to move it to the Applications folder for better user experience.
/// This is a common pattern for macOS apps to ensure they're installed in the proper location.
///
/// ## How It Works
/// The detection uses multiple strategies in order of preference:
/// 1. **DMG Detection**: Uses `hdiutil` to check if the app is running from a mounted disk image
/// 2. **Path-based Detection**: Checks if the app is running from Downloads, Desktop, or Documents folders
/// 3. **Applications Check**: Verifies the app isn't already in /Applications or ~/Applications
///
/// ## Usage
/// Call `checkAndOfferToMoveToApplications()` early in your app lifecycle:
/// ```swift
/// let applicationMover = ApplicationMover()
/// applicationMover.checkAndOfferToMoveToApplications()
/// ```
///
/// ## Safety Considerations
/// - Always prompts user before performing any operations
/// - Handles existing apps in Applications folder with replace confirmation
/// - Provides clear error messages and graceful failure handling
/// - Logs all operations for debugging purposes
/// - Only operates when not running from Applications folder already
///
/// ## Implementation Notes
/// Based on proven techniques from PFMoveApplication/LetsMove libraries, using:
/// - `statfs()` for mount point detection
/// - `hdiutil info` for disk image verification
/// - Standard FileManager operations for copying
/// - NSWorkspace for relaunching from new location
@MainActor
final class ApplicationMover {
    // MARK: - Properties

    private let logger = Logger(subsystem: BundleIdentifiers.loggerSubsystem, category: "ApplicationMover")

    // MARK: - Public Interface

    /// Checks if the app should be moved to Applications and offers to do so if needed.
    /// This should be called early in the app lifecycle, typically in applicationDidFinishLaunching.
    func checkAndOfferToMoveToApplications() {
        logger.info("ApplicationMover: Starting check...")
        logger.info("ApplicationMover: Bundle path: \(Bundle.main.bundlePath)")

        guard shouldOfferToMove() else {
            logger.info("ApplicationMover: App is already in Applications or move not needed")
            return
        }

        logger.info("ApplicationMover: App needs to be moved, offering to move to Applications")
        offerToMoveToApplications()
    }

    // MARK: - Private Implementation

    /// Determines if we should offer to move the app to Applications
    private func shouldOfferToMove() -> Bool {
        let bundlePath = Bundle.main.bundlePath
        logger.info("ApplicationMover: Checking bundle path: \(bundlePath)")

        // Check if already in Applications
        let inApps = isInApplicationsFolder(bundlePath)
        logger.info("ApplicationMover: Is in Applications folder: \(inApps)")
        if inApps {
            return false
        }

        // Check if running from DMG or other mounted volume
        let fromDMG = isRunningFromDMG(bundlePath)
        logger.info("ApplicationMover: Is running from DMG: \(fromDMG)")
        if fromDMG {
            return true
        }

        // Check if running from Downloads or Desktop (common when downloaded)
        let fromTemp = isRunningFromTemporaryLocation(bundlePath)
        logger.info("ApplicationMover: Is running from temporary location: \(fromTemp)")
        if fromTemp {
            return true
        }

        logger.info("ApplicationMover: No move needed for path: \(bundlePath)")
        return false
    }

    /// Checks if the app is already in the Applications folder
    private func isInApplicationsFolder(_ path: String) -> Bool {
        let applicationsPath = "/Applications/"
        let userApplicationsPath = NSHomeDirectory() + "/Applications/"

        return path.hasPrefix(applicationsPath) || path.hasPrefix(userApplicationsPath)
    }

    /// Checks if the app is running from a DMG (mounted disk image)
    /// Uses the proven approach from PFMoveApplication/LetsMove
    private func isRunningFromDMG(_ path: String) -> Bool {
        logger.info("ApplicationMover: Checking if running from DMG for path: \(path)")

        guard let diskImageDevice = containingDiskImageDevice(for: path) else {
            logger.info("ApplicationMover: No disk image device found")
            return false
        }

        logger.info("ApplicationMover: App is running from disk image device: \(diskImageDevice)")
        return true
    }

    /// Determines the disk image device containing the given path
    /// Based on the proven PFMoveApplication implementation
    private func containingDiskImageDevice(for path: String) -> String? {
        logger.info("ApplicationMover: Checking disk image device for path: \(path)")

        var fs = statfs()
        let result = statfs(path, &fs)

        // If statfs fails or this is the root filesystem, not a disk image
        guard result == 0 else {
            logger.info("ApplicationMover: statfs failed with result: \(result)")
            return nil
        }

        guard (fs.f_flags & UInt32(MNT_ROOTFS)) == 0 else {
            logger.info("ApplicationMover: Path is on root filesystem")
            return nil
        }

        // Get the device name from the mount point
        let deviceNameTuple = fs.f_mntfromname
        let deviceName = withUnsafePointer(to: deviceNameTuple) {
            $0.withMemoryRebound(to: CChar.self, capacity: MemoryLayout.size(ofValue: deviceNameTuple)) {
                String(cString: $0)
            }
        }

        logger.info("ApplicationMover: Device name: \(deviceName)")

        // Use hdiutil to check if this device is a disk image
        return checkDeviceIsDiskImage(deviceName)
    }

    /// Checks if the given device is a mounted disk image using hdiutil
    private func checkDeviceIsDiskImage(_ deviceName: String) -> String? {
        logger.info("ApplicationMover: Checking if device is disk image: \(deviceName)")

        let task = Process()
        task.launchPath = "/usr/bin/hdiutil"
        task.arguments = ["info", "-plist"]

        let pipe = Pipe()
        task.standardOutput = pipe
        task.standardError = Pipe() // Suppress stderr

        do {
            logger.debug("ApplicationMover: Running hdiutil info -plist")
            try task.run()
            task.waitUntilExit()

            guard task.terminationStatus == 0 else {
                logger.debug("ApplicationMover: hdiutil command failed with status: \(task.terminationStatus)")
                return nil
            }

            let data: Data
            do {
                data = try pipe.fileHandleForReading.readToEnd() ?? Data()
            } catch {
                logger.debug("ApplicationMover: Could not read hdiutil output: \(error.localizedDescription)")
                return nil
            }
            logger.debug("ApplicationMover: hdiutil returned \(data.count) bytes")

            guard let plist = try PropertyListSerialization
                .propertyList(from: data, options: [], format: nil) as? [String: Any],
                let images = plist["images"] as? [[String: Any]]
            else {
                logger.debug("ApplicationMover: No disk images found in hdiutil output")
                return nil
            }

            // Check each mounted disk image
            for image in images {
                if let entities = image["system-entities"] as? [[String: Any]] {
                    for entity in entities {
                        if let entityDevName = entity["dev-entry"] as? String,
                           entityDevName == deviceName
                        {
                            logger.debug("Found matching disk image for device: \(deviceName)")
                            return deviceName
                        }
                    }
                }
            }

            logger.debug("Device \(deviceName) is not a disk image")
            return nil
        } catch {
            logger.debug("ApplicationMover: Unable to run hdiutil (expected in some environments): \(error)")
            return nil
        }
    }

    /// Checks if app is running from Downloads, Desktop, or other temporary locations
    private func isRunningFromTemporaryLocation(_ path: String) -> Bool {
        let homeDirectory = NSHomeDirectory()
        let downloadsPath = homeDirectory + "/Downloads/"
        let desktopPath = homeDirectory + "/Desktop/"
        let documentsPath = homeDirectory + "/Documents/"

        return path.hasPrefix(downloadsPath) ||
            path.hasPrefix(desktopPath) ||
            path.hasPrefix(documentsPath)
    }

    /// Presents an alert offering to move the app to Applications
    private func offerToMoveToApplications() {
        let alert = NSAlert()
        alert.messageText = "Move VibeTunnel to Applications?"
        let informativeText = "VibeTunnel is currently running from a disk image or temporary location. " +
            "Would you like to move it to your Applications folder for better performance and convenience?"
        alert.informativeText = informativeText

        alert.addButton(withTitle: "Move to Applications")
        alert.addButton(withTitle: "Don't Move")

        alert.alertStyle = .informational
        alert.icon = NSApp.applicationIconImage

        // For menu bar apps, always show as modal dialog since there's typically no main window
        NSApp.activate(ignoringOtherApps: true)
        let response = alert.runModal()
        handleMoveResponse(response)
    }

    /// Handles the user's response to the move offer
    private func handleMoveResponse(_ response: NSApplication.ModalResponse) {
        switch response {
        case .alertFirstButtonReturn:
            // User chose "Move to Applications"
            logger.info("User chose to move app to Applications")
            performMoveToApplications()
        case .alertSecondButtonReturn:
            // User chose "Don't Move"
            logger.info("User chose not to move app to Applications")
        default:
            logger.debug("Unknown alert response: \(response.rawValue)")
        }
    }

    /// Performs the actual move operation to Applications
    private func performMoveToApplications() {
        let currentPath = Bundle.main.bundlePath
        let appName = Bundle.main.infoDictionary?["CFBundleName"] as? String ?? "VibeTunnel"
        let applicationsPath = "/Applications/\(appName).app"

        do {
            let fileManager = FileManager.default

            // Check if destination already exists
            if fileManager.fileExists(atPath: applicationsPath) {
                // Ask user if they want to replace
                let replaceAlert = NSAlert()
                replaceAlert.messageText = "Replace Existing App?"
                replaceAlert
                    .informativeText =
                    "An app with the same name already exists in Applications. Do you want to replace it?"
                replaceAlert.addButton(withTitle: "Replace")
                replaceAlert.addButton(withTitle: "Cancel")
                replaceAlert.alertStyle = .warning

                let response = replaceAlert.runModal()
                if response != .alertFirstButtonReturn {
                    logger.info("User cancelled replacement of existing app")
                    return
                }

                // Remove existing app
                try fileManager.removeItem(atPath: applicationsPath)
                logger.info("Removed existing app at \(applicationsPath)")
            }

            // Copy the app to Applications
            try fileManager.copyItem(atPath: currentPath, toPath: applicationsPath)
            logger.info("Successfully copied app to \(applicationsPath)")

            // Show success message and offer to relaunch
            showMoveSuccessAndRelaunch(newPath: applicationsPath)
        } catch {
            logger.error("Failed to move app to Applications: \(error)")
            showMoveError(error)
        }
    }

    /// Shows success message and offers to relaunch from Applications
    private func showMoveSuccessAndRelaunch(newPath: String) {
        let alert = NSAlert()
        alert.messageText = "App Moved Successfully"
        let informativeText = "VibeTunnel has been moved to Applications. " +
            "Would you like to quit this version and launch the one in Applications?"
        alert.informativeText = informativeText

        alert.addButton(withTitle: "Relaunch from Applications")
        alert.addButton(withTitle: "Continue Running")

        alert.alertStyle = .informational
        alert.icon = NSApp.applicationIconImage

        let response = alert.runModal()
        if response == .alertFirstButtonReturn {
            // Launch the new version and quit this one
            launchFromApplicationsAndQuit(newPath: newPath)
        }
    }

    /// Launches the app from Applications and quits the current instance
    private func launchFromApplicationsAndQuit(newPath: String) {
        let workspace = NSWorkspace.shared
        let appURL = URL(fileURLWithPath: newPath)

        Task { @MainActor in
            let configuration = NSWorkspace.OpenConfiguration()
            // Use openURL instead of openApplication to avoid non-Sendable return type
            configuration.activates = true
            configuration.promptsUserIfNeeded = true

            workspace.open(appURL, configuration: configuration) { _, error in
                Task { @MainActor in
                    if let error {
                        self.logger.error("Failed to launch app from Applications: \(error)")
                        self.showLaunchError(error)
                    } else {
                        self.logger.info("Launched app from Applications, quitting current instance")

                        // Quit current instance after a short delay to ensure the new one starts
                        Task {
                            try? await Task.sleep(for: .milliseconds(500))
                            await MainActor.run {
                                NSApp.terminate(nil)
                            }
                        }
                    }
                }
            }
        }
    }

    /// Shows error message for move failures
    private func showMoveError(_ error: Error) {
        let alert = NSAlert()
        alert.messageText = "Failed to Move App"
        alert.informativeText = "Could not move VibeTunnel to Applications: \(error.localizedDescription)"
        alert.addButton(withTitle: "OK")
        alert.alertStyle = .critical
        alert.runModal()
    }

    /// Shows error message for launch failures
    private func showLaunchError(_ error: Error) {
        let alert = NSAlert()
        alert.messageText = "Failed to Launch from Applications"
        let informativeText = "Could not launch VibeTunnel from Applications: \(error.localizedDescription)\n\n" +
            "You can manually launch it from Applications later."
        alert.informativeText = informativeText
        alert.addButton(withTitle: "OK")
        alert.alertStyle = .warning
        alert.runModal()
    }
}
