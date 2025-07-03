import AppKit
import Foundation
import Observation
import os.log
import SwiftUI

/// Supported Git GUI applications.
enum GitApp: String, CaseIterable {
    case fork = "Fork"
    case githubDesktop = "GitHub Desktop"
    case gitup = "GitUp"
    case sourcetree = "SourceTree"
    case sublimeMerge = "Sublime Merge"
    case tower = "Tower"

    var bundleIdentifier: String {
        switch self {
        case .fork:
            "com.DanPristupov.Fork"
        case .githubDesktop:
            "com.github.GitHubClient"
        case .gitup:
            "co.gitup.mac"
        case .sourcetree:
            "com.torusknot.SourceTreeNotMAS"
        case .sublimeMerge:
            "com.sublimemerge"
        case .tower:
            "com.fournova.Tower3"
        }
    }

    /// Priority for auto-detection (higher is better, based on popularity)
    var detectionPriority: Int {
        switch self {
        case .fork: 75
        case .githubDesktop: 90
        case .gitup: 60
        case .sourcetree: 80
        case .sublimeMerge: 85
        case .tower: 100
        }
    }

    var displayName: String {
        rawValue
    }

    var isInstalled: Bool {
        NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleIdentifier) != nil ||
            // Check for Tower 2 as well
            (self == .tower && NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.fournova.Tower2") != nil)
    }

    var appIcon: NSImage? {
        // Try Tower 3 first, then Tower 2
        if self == .tower {
            if let appURL = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleIdentifier) {
                return NSWorkspace.shared.icon(forFile: appURL.path)
            } else if let appURL = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.fournova.Tower2") {
                return NSWorkspace.shared.icon(forFile: appURL.path)
            }
            return nil
        }

        guard let appURL = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleIdentifier) else {
            return nil
        }
        return NSWorkspace.shared.icon(forFile: appURL.path)
    }

    static var installed: [Self] {
        allCases.filter(\.isInstalled)
    }

    /// Get the actual bundle identifier to use (handles Tower 2/3)
    var actualBundleIdentifier: String? {
        if self == .tower {
            // Try Tower 3 first, then Tower 2
            if NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleIdentifier) != nil {
                return bundleIdentifier
            } else if NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.fournova.Tower2") != nil {
                return "com.fournova.Tower2"
            }
            return nil
        }
        return isInstalled ? bundleIdentifier : nil
    }
}

/// Manages launching Git applications with repository paths.
@MainActor
@Observable
final class GitAppLauncher {
    static let shared = GitAppLauncher()
    private let logger = Logger(subsystem: "sh.vibetunnel.VibeTunnel", category: "GitAppLauncher")

    private init() {
        performFirstRunAutoDetection()
    }

    func openRepository(at path: String) {
        let gitApp = getValidGitApp()
        let url = URL(fileURLWithPath: path)

        if let bundleId = gitApp.actualBundleIdentifier,
           let appURL = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleId)
        {
            NSWorkspace.shared.open(
                [url],
                withApplicationAt: appURL,
                configuration: NSWorkspace.OpenConfiguration()
            )
        } else {
            // Fallback to Finder
            NSWorkspace.shared.selectFile(nil, inFileViewerRootedAtPath: path)
        }
    }

    func verifyPreferredGitApp() {
        let currentPreference = UserDefaults.standard.string(forKey: "preferredGitApp")
        if let preference = currentPreference,
           let gitApp = GitApp(rawValue: preference),
           !gitApp.isInstalled
        {
            // If the preferred app is no longer installed, clear the preference
            UserDefaults.standard.removeObject(forKey: "preferredGitApp")
        }
    }

    // MARK: - Private Methods

    private func performFirstRunAutoDetection() {
        // Check if git app preference has already been set
        let hasSetPreference = UserDefaults.standard.object(forKey: "preferredGitApp") != nil

        if !hasSetPreference {
            logger.info("First run detected, auto-detecting preferred Git app")

            // Check installed git apps
            let installedGitApps = GitApp.installed
            if let bestGitApp = installedGitApps.max(by: { $0.detectionPriority < $1.detectionPriority }) {
                UserDefaults.standard.set(bestGitApp.rawValue, forKey: "preferredGitApp")
                logger.info("Auto-detected and set preferred Git app to: \(bestGitApp.rawValue)")
            }
        }
    }

    private func getValidGitApp() -> GitApp {
        // Read the current preference
        if let currentPreference = UserDefaults.standard.string(forKey: "preferredGitApp"),
           !currentPreference.isEmpty,
           let gitApp = GitApp(rawValue: currentPreference),
           gitApp.isInstalled
        {
            return gitApp
        }

        // No valid preference, try to find any installed Git app
        let installedGitApps = GitApp.installed
        if let bestGitApp = installedGitApps.max(by: { $0.detectionPriority < $1.detectionPriority }) {
            return bestGitApp
        }

        // Default to Tower (even if not installed, we'll fall back to Finder)
        return .tower
    }
}
