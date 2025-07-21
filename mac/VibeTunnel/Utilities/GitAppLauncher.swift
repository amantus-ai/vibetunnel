import AppKit
import Foundation
import Observation
import os.log
import SwiftUI

/// Supported Git GUI applications.
enum GitApp: String, CaseIterable {
    case cursor = "Cursor"
    case fork = "Fork"
    case githubDesktop = "GitHub Desktop"
    case gitup = "GitUp"
    case juxtaCode = "JuxtaCode"
    case sourcetree = "SourceTree"
    case sublimeMerge = "Sublime Merge"
    case tower = "Tower"
    case vscode = "Visual Studio Code"
    case windsurf = "Windsurf"

    var bundleIdentifier: String {
        switch self {
        case .cursor:
            BundleIdentifiers.cursor
        case .fork:
            BundleIdentifiers.fork
        case .githubDesktop:
            BundleIdentifiers.githubDesktop
        case .gitup:
            BundleIdentifiers.gitup
        case .juxtaCode:
            BundleIdentifiers.juxtaCode
        case .sourcetree:
            BundleIdentifiers.sourcetree
        case .sublimeMerge:
            BundleIdentifiers.sublimeMerge
        case .tower:
            BundleIdentifiers.tower
        case .vscode:
            BundleIdentifiers.vscode
        case .windsurf:
            BundleIdentifiers.windsurf
        }
    }

    /// Priority for auto-detection (higher is better, based on popularity)
    var detectionPriority: Int {
        switch self {
        case .cursor: 70
        case .fork: 75
        case .githubDesktop: 90
        case .gitup: 60
        case .juxtaCode: 82
        case .sourcetree: 80
        case .sublimeMerge: 85
        case .tower: 100
        case .vscode: 95
        case .windsurf: 65
        }
    }

    var displayName: String {
        rawValue
    }

    var isInstalled: Bool {
        NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleIdentifier) != nil
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

    /// Get the actual bundle identifier to use
    var actualBundleIdentifier: String? {
        isInstalled ? bundleIdentifier : nil
    }
}

/// Manages launching Git applications with repository paths.
@MainActor
@Observable
final class GitAppLauncher {
    static let shared = GitAppLauncher()
    private let logger = Logger(subsystem: BundleIdentifiers.main, category: "GitAppLauncher")

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
        let currentPreference = AppConstants.getPreferredGitApp()
        if let preference = currentPreference,
           let gitApp = GitApp(rawValue: preference),
           !gitApp.isInstalled
        {
            // If the preferred app is no longer installed, clear the preference
            AppConstants.setPreferredGitApp(nil)
        }
    }

    // MARK: - Private Methods

    private func performFirstRunAutoDetection() {
        // Check if git app preference has already been set
        let hasSetPreference = AppConstants.getPreferredGitApp() != nil

        if !hasSetPreference {
            logger.info("First run detected, auto-detecting preferred Git app")

            // Check installed git apps
            let installedGitApps = GitApp.installed
            if let bestGitApp = installedGitApps.max(by: { $0.detectionPriority < $1.detectionPriority }) {
                AppConstants.setPreferredGitApp(bestGitApp.rawValue)
                logger.info("Auto-detected and set preferred Git app to: \(bestGitApp.rawValue)")
            }
        }
    }

    private func getValidGitApp() -> GitApp {
        // Read the current preference
        if let currentPreference = AppConstants.getPreferredGitApp(),
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
