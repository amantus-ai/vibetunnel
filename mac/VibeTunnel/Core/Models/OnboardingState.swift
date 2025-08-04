import Foundation
import Observation
import os.log
@preconcurrency import UserNotifications

/// Manages onboarding state and determines which pages should be shown
///
/// This model checks both stored user preferences and actual system state
/// to provide a smart onboarding experience that only shows relevant pages.
/// It does not store completion flags - instead it derives state from
/// real system conditions and user preferences.
@MainActor
@Observable
final class OnboardingState {
    static let shared = OnboardingState()

    private let logger = Logger(
        subsystem: BundleIdentifiers.loggerSubsystem,
        category: "OnboardingState"
    )

    /// Dynamic list of pages that should be visible
    var visiblePages: [OnboardingPage] = []

    private init() {}

    // MARK: - Page State Checking

    /// Starts dynamic page analysis - initializes with all pages then removes unneeded ones
    func startDynamicPageAnalysis() {
        // Start with all pages, then remove them as we determine they're not needed
        visiblePages = OnboardingPage.allCases
        logger.info("🔄 Starting dynamic page analysis with \(self.visiblePages.count) pages")

        // Start background checks immediately - no blocking
        Task {
            await performDynamicPageRemoval()
        }
    }

    /// Performs background checks and removes pages that aren't needed
    private func performDynamicPageRemoval() async {
        logger.info("🔄 Starting background permission checks...")

        // Force permission recheck
        await SystemPermissionManager.shared.checkAllPermissions()

        // Check permissions and remove page if not needed
        if await shouldSkipPermissionsPage() {
            removePageIfPresent(.permissions, reason: "permissions already granted")
        }

        // Check CLI status
        if await shouldSkipCLIPage() {
            removePageIfPresent(.cliInstallation, reason: "CLI up to date")
        }

        // Check terminal preference
        if shouldSkipTerminalPage() {
            removePageIfPresent(.terminalSelection, reason: "terminal already configured")
        }

        // Check project folder
        if shouldSkipProjectFolderPage() {
            removePageIfPresent(.projectFolder, reason: "working directory already set")
        }

        // Check dashboard protection
        if shouldSkipDashboardProtectionPage() {
            removePageIfPresent(.dashboardProtection, reason: "security mode already configured")
        }

        // Check notifications
        if await shouldSkipNotificationPage() {
            removePageIfPresent(.notifications, reason: "notification permissions already granted")
        }

        logger.info("📊 Final page count: \(self.visiblePages.count) (vs 9 in full flow)")
        logger.info("📄 Final pages: \(self.visiblePages.map(\.rawValue).joined(separator: ", "))")
    }

    /// Safely removes a page from the visible list
    private func removePageIfPresent(_ page: OnboardingPage, reason: String) {
        if let index = visiblePages.firstIndex(of: page) {
            visiblePages.remove(at: index)
            logger.info("🗑️ Removed \(page.rawValue) page: \(reason)")

            // Notify that page count has changed - UI will handle current page adjustment
            NotificationCenter.default.post(name: .onboardingPageRemoved, object: index)
        }
    }

    // MARK: - Individual Page Checks (Skip Logic)

    private func shouldSkipCLIPage() async -> Bool {
        let cliInstaller = CLIInstaller()
        cliInstaller.checkInstallationStatus()
        let isUpToDate = !cliInstaller.isOutdated

        logger.debug("CLI check: isUpToDate=\(isUpToDate)")
        return isUpToDate
    }

    private func shouldSkipPermissionsPage() async -> Bool {
        let hasAllPermissions = SystemPermissionManager.shared.hasAllPermissions
        logger.info("🔐 Permissions check: hasAllPermissions=\(hasAllPermissions)")
        return hasAllPermissions
    }

    private func shouldSkipTerminalPage() -> Bool {
        let hasTerminalPreference = AppConstants.getPreferredTerminal() != nil
        logger.debug("Terminal check: hasPreference=\(hasTerminalPreference)")
        return hasTerminalPreference
    }

    private func shouldSkipProjectFolderPage() -> Bool {
        let hasWorkingDirectory = UserDefaults.standard.string(
            forKey: AppConstants.UserDefaultsKeys.newSessionWorkingDirectory
        ) != nil

        logger.debug("Project folder check: hasWorkingDirectory=\(hasWorkingDirectory)")
        return hasWorkingDirectory
    }

    private func shouldSkipDashboardProtectionPage() -> Bool {
        // Check if user has explicitly set a dashboard access mode
        let hasAccessModeSet = UserDefaults.standard.object(
            forKey: AppConstants.UserDefaultsKeys.dashboardAccessMode
        ) != nil

        logger.debug("Dashboard protection check: hasAccessModeSet=\(hasAccessModeSet)")
        return hasAccessModeSet
    }

    private func shouldSkipNotificationPage() async -> Bool {
        // Check if notification permissions are granted
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        let isAuthorized = settings.authorizationStatus == .authorized

        logger.info("🔔 Notification check: authorized=\(isAuthorized), status=\(settings.authorizationStatus.rawValue)")
        return isAuthorized
    }
}

// MARK: - OnboardingPage Enum

/// Represents the different pages in the onboarding flow
enum OnboardingPage: String, CaseIterable {
    case welcome = "welcome"
    case cliInstallation = "cli-installation"
    case permissions = "permissions"
    case terminalSelection = "terminal-selection"
    case projectFolder = "project-folder"
    case dashboardProtection = "dashboard-protection"
    case notifications = "notifications"
    case agentArmy = "agent-army"
    case accessDashboard = "access-dashboard"

    var displayName: String {
        switch self {
        case .welcome:
            "Welcome"
        case .cliInstallation:
            "CLI Installation"
        case .permissions:
            "Permissions"
        case .terminalSelection:
            "Terminal Selection"
        case .projectFolder:
            "Project Folder"
        case .dashboardProtection:
            "Dashboard Protection"
        case .notifications:
            "Notifications"
        case .agentArmy:
            "Agent Army"
        case .accessDashboard:
            "Access Dashboard"
        }
    }
}
