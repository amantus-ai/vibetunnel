import SwiftUI

/// Welcome onboarding view for first-time users.
///
/// Presents a multi-page onboarding experience that introduces VibeTunnel's features,
/// guides through CLI installation, requests AppleScript permissions, and explains
/// dashboard security best practices. The view tracks completion state to ensure
/// it's only shown once.
///
/// ## Topics
///
/// ### Overview
/// The welcome flow consists of nine pages:
/// - ``WelcomePageView`` - Introduction and app overview
/// - ``VTCommandPageView`` - CLI tool installation
/// - ``RequestPermissionsPageView`` - System permissions setup
/// - ``SelectTerminalPageView`` - Terminal selection and testing
/// - ``ProjectFolderPageView`` - Project folder configuration
/// - ``ProtectDashboardPageView`` - Dashboard security configuration
/// - ``NotificationPermissionPageView`` - Notification permissions setup
/// - ``ControlAgentArmyPageView`` - Managing multiple AI agent sessions
/// - ``AccessDashboardPageView`` - Remote access instructions
struct WelcomeView: View {
    @State private var currentPage = 0
    @Environment(\.dismiss)
    private var dismiss
    @AppStorage(AppConstants.UserDefaultsKeys.welcomeVersion)
    private var welcomeVersion = 0
    @State private var cliInstaller = CLIInstaller()
    @Environment(SystemPermissionManager.self)
    private var permissionManager
    private let onboardingState = OnboardingState.shared

    private let pageWidth: CGFloat = 640
    private let contentHeight: CGFloat = 468 // Total height minus navigation area

    var body: some View {
        VStack(spacing: 0) {
            // Fixed header with animated app icon
            GlowingAppIcon(
                size: 156,
                enableFloating: true,
                enableInteraction: false,
                glowIntensity: 0.3
            )
            .padding(.top, 40)
            .padding(.bottom, 20) // Add padding below icon
            .frame(height: 240)

            // Scrollable content area
            GeometryReader { _ in
                HStack(spacing: 0) {
                    ForEach(onboardingState.visiblePages, id: \.self) { page in
                        pageContent(for: page)
                            .frame(width: pageWidth)
                    }
                }
                .offset(x: CGFloat(-currentPage) * pageWidth)
                .animation(
                    .interactiveSpring(response: 0.5, dampingFraction: 0.86, blendDuration: 0.25),
                    value: currentPage
                )
            }
            .frame(height: 260) // Total height (560) - header (240) - navigation (60)
            .clipped()

            // Navigation bar with dots and buttons in same row
            HStack(spacing: 20) {
                // Back button - only visible when not on first page
                // Back button with consistent space reservation
                ZStack(alignment: .leading) {
                    // Invisible placeholder that's always there
                    Button(action: {}, label: {
                        Label("Back", systemImage: "chevron.left")
                            .labelStyle(.iconOnly)
                    })
                    .buttonStyle(.plain)
                    .opacity(0)
                    .disabled(true)

                    // Actual back button when needed
                    if currentPage > 0 {
                        Button(action: handleBackAction) {
                            Label("Back", systemImage: "chevron.left")
                                .labelStyle(.iconOnly)
                        }
                        .buttonStyle(.plain)
                        .foregroundColor(.secondary)
                        .opacity(0.7)
                        .pointingHandCursor()
                        .help("Go back to previous page")
                        .transition(.opacity.combined(with: .scale(scale: 0.8)))
                    }
                }
                .frame(minWidth: 80, alignment: .leading) // Same width as Next button, left-aligned

                Spacer()

                // Page indicators centered
                HStack(spacing: 8) {
                    ForEach(0..<onboardingState.visiblePages.count, id: \.self) { index in
                        Button {
                            withAnimation {
                                currentPage = index
                            }
                        } label: {
                            Circle()
                                .fill(index == currentPage ? Color.accentColor : Color.gray.opacity(0.3))
                                .frame(width: 8, height: 8)
                        }
                        .buttonStyle(.plain)
                        .pointingHandCursor()
                    }
                }

                Spacer()

                Button(action: handleNextAction) {
                    Text(buttonTitle)
                        .frame(minWidth: 80)
                }
                .keyboardShortcut(.return)
                .buttonStyle(.borderedProminent)
            }
            .padding(.horizontal, 20)
            .frame(height: 60)
        }
        .frame(width: 640, height: 560)
        .background(Color(NSColor.windowBackgroundColor))
        .onAppear {
            // Always start at the first page when the view appears
            currentPage = 0
            // Start smart onboarding analysis
            onboardingState.startDynamicPageAnalysis()
        }
        .onReceive(NotificationCenter.default.publisher(for: .onboardingPageRemoved)) { notification in
            // Adjust current page if a page before the current one was removed
            if let removedIndex = notification.object as? Int, removedIndex <= currentPage {
                withAnimation {
                    currentPage = max(0, currentPage - 1)
                }
            }
        }
        .onDisappear {
            // Ensure permission monitoring stops when welcome window closes
            // This is a safety net in case the page-specific cleanup doesn't happen
            SystemPermissionManager.shared.unregisterFromMonitoring()
        }
    }

    private var buttonTitle: String {
        currentPage == onboardingState.visiblePages.count - 1 ? "Finish" : "Next"
    }

    @ViewBuilder
    private func pageContent(for page: OnboardingPage) -> some View {
        switch page {
        case .welcome:
            WelcomeContentView()
        case .cliInstallation:
            VTCommandPageView(cliInstaller: cliInstaller)
        case .permissions:
            RequestPermissionsPageView(isCurrentPage: isCurrentPage(for: page))
        case .terminalSelection:
            SelectTerminalPageView()
        case .projectFolder:
            ProjectFolderPageView(currentPage: $currentPage)
        case .dashboardProtection:
            ProtectDashboardPageView()
        case .notifications:
            NotificationPermissionPageView()
        case .agentArmy:
            ControlAgentArmyPageView()
        case .accessDashboard:
            AccessDashboardPageView()
        }
    }

    private func isCurrentPage(for page: OnboardingPage) -> Bool {
        guard currentPage < onboardingState.visiblePages.count else { return false }
        return onboardingState.visiblePages[currentPage] == page
    }

    private func handleBackAction() {
        withAnimation {
            currentPage -= 1
        }
    }

    private func handleNextAction() {
        if currentPage < onboardingState.visiblePages.count - 1 {
            withAnimation {
                currentPage += 1
            }
        } else {
            // Finish action - save welcome version and close window
            welcomeVersion = AppConstants.currentWelcomeVersion

            // Close the window using the SwiftUI dismiss environment
            dismiss()

            // Open settings after a delay to ensure the window is fully closed
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(200))
                SettingsOpener.openSettings()
            }
        }
    }
}

// MARK: - Preview

#Preview("Welcome View") {
    WelcomeView()
        .environment(SystemPermissionManager.shared)
}
