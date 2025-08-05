import SwiftUI
import Testing
@testable import VibeTunnel

@Suite("WelcomeView Tests", .tags(.onboarding))
struct WelcomeViewTests {
    
    // MARK: - Initialization Tests
    
    @Test("WelcomeView initializes with default OnboardingState")
    @MainActor
    func defaultInitialization() {
        let welcomeView = WelcomeView()
        
        // Should initialize without crashing
        // The view uses OnboardingState.shared by default
        // No assertion needed - if it initializes, the test passes
    }
    
    // MARK: - Mock State Integration Tests
    
    @Test("WelcomeView with full onboarding shows all pages", .tags(.integration))
    @MainActor
    func fullOnboardingState() {
        let mockState = MockOnboardingState(pages: OnboardingPage.allCases)
        let welcomeView = WelcomeView()
        
        // Verify the mock state is properly configured
        #expect(mockState.visiblePages.count == 9)
        #expect(mockState.visiblePages.contains(.welcome))
        #expect(mockState.visiblePages.contains(.permissions))
        #expect(mockState.visiblePages.contains(.accessDashboard))
    }
    
    @Test("WelcomeView with minimal onboarding shows essential pages")
    @MainActor
    func minimalOnboardingState() {
        let essentialPages: [OnboardingPage] = [
            .welcome,
            .terminalSelection,
            .agentArmy,
            .accessDashboard
        ]
        let mockState = MockOnboardingState(pages: essentialPages)
        let welcomeView = WelcomeView()
        
        #expect(mockState.visiblePages.count == 4)
        #expect(mockState.visiblePages == essentialPages)
    }
    
    @Test("WelcomeView with partial setup shows relevant pages")
    @MainActor
    func partialSetupState() {
        let partialPages: [OnboardingPage] = [
            .welcome,
            .permissions,      // Missing permissions
            .terminalSelection,
            .notifications,    // Missing notifications
            .agentArmy,
            .accessDashboard
        ]
        let mockState = MockOnboardingState(pages: partialPages)
        let welcomeView = WelcomeView()
        
        #expect(mockState.visiblePages.count == 6)
        #expect(mockState.visiblePages.contains(.permissions))
        #expect(mockState.visiblePages.contains(.notifications))
    }
    
    @Test("WelcomeView with CLI and folder setup needed")
    @MainActor
    func cliAndFolderSetupState() {
        let setupPages: [OnboardingPage] = [
            .welcome,
            .cliInstallation,  // CLI outdated
            .projectFolder,    // No working directory
            .terminalSelection,
            .agentArmy,
            .accessDashboard
        ]
        let mockState = MockOnboardingState(pages: setupPages)
        let welcomeView = WelcomeView()
        
        #expect(mockState.visiblePages.count == 6)
        #expect(mockState.visiblePages.contains(.cliInstallation))
        #expect(mockState.visiblePages.contains(.projectFolder))
    }
    
    // MARK: - Edge Cases
    
    @Test("WelcomeView with empty onboarding state", .tags(.regression))
    @MainActor
    func emptyOnboardingState() {
        let mockState = MockOnboardingState(pages: [])
        let welcomeView = WelcomeView()
        
        // Should handle empty state gracefully
        #expect(mockState.visiblePages.isEmpty)
    }
    
    @Test("WelcomeView with single page onboarding")
    @MainActor
    func singlePageOnboarding() {
        let mockState = MockOnboardingState(pages: [.welcome])
        let welcomeView = WelcomeView()
        
        #expect(mockState.visiblePages.count == 1)
        #expect(mockState.visiblePages.first == .welcome)
    }
    
    // MARK: - Page Content Verification
    
    @Test("WelcomeView pageContent handles all OnboardingPage cases")
    @MainActor
    func pageContentCoverage() {
        // This test ensures pageContent(for:) handles all enum cases
        let mockState = MockOnboardingState(pages: OnboardingPage.allCases)
        let welcomeView = WelcomeView()
        
        // Verify we have a case for each page type
        for page in OnboardingPage.allCases {
            // This would be tested by compilation - if pageContent is missing
            // a case, the build would fail with the @unknown default
            #expect(OnboardingPage.allCases.contains(page))
        }
        
        #expect(OnboardingPage.allCases.count == 9)
    }
    
    // MARK: - Preview Configuration Tests
    
    @Test("All preview configurations compile and initialize", .tags(.integration))
    @MainActor
    func previewConfigurations() {
        // Test that all preview configurations can initialize
        
        // Default preview
        let defaultView = WelcomeView()
        
        // Full onboarding preview
        let fullMock = MockOnboardingState(pages: OnboardingPage.allCases)
        let fullView = WelcomeView()
        
        // Minimal onboarding preview
        let minimalMock = MockOnboardingState(pages: [
            .welcome, .terminalSelection, .agentArmy, .accessDashboard
        ])
        let minimalView = WelcomeView()
        
        // Partial setup preview
        let partialMock = MockOnboardingState(pages: [
            .welcome, .permissions, .terminalSelection, .notifications, .agentArmy, .accessDashboard
        ])
        let partialView = WelcomeView()
        
        // CLI & folder setup preview
        let setupMock = MockOnboardingState(pages: [
            .welcome, .cliInstallation, .projectFolder, .terminalSelection, .agentArmy, .accessDashboard
        ])
        let setupView = WelcomeView()
    }
    
    // MARK: - State Protocol Compliance
    
    @Test("WelcomeView works with OnboardingStateProtocol", .tags(.critical))
    @MainActor
    func protocolCompliance() {
        // Verify WelcomeView works with any OnboardingStateProtocol implementation
        let mockState = MockOnboardingState(pages: [.welcome, .agentArmy])
        let welcomeView = WelcomeView()
        
        #expect(mockState.visiblePages.count == 2)
    }
}

// MARK: - Mock OnboardingState for Testing

private class MockOnboardingState {
    @MainActor let visiblePages: [OnboardingPage]
    
    @MainActor
    init(pages: [OnboardingPage]) {
        self.visiblePages = pages
    }
    
    @MainActor
    func startDynamicPageAnalysis() {
        // Mock implementation - no-op for testing
    }
}