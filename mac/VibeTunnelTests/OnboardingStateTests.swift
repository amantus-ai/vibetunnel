import Foundation
import Testing
@testable import VibeTunnel

// MARK: - OnboardingState Tests Suite

@Suite("OnboardingState Tests", .tags(.onboarding, .models))
struct OnboardingStateTests {
    
    // MARK: - OnboardingPage Tests
    
    @Suite("OnboardingPage Tests")
    struct OnboardingPageTests {
        
        @Test("OnboardingPage allCases contains all expected pages")
        func allCasesComplete() throws {
            let allPages = OnboardingPage.allCases
            
            #expect(allPages.count == 9)
            #expect(allPages.contains(.welcome))
            #expect(allPages.contains(.cliInstallation))
            #expect(allPages.contains(.permissions))
            #expect(allPages.contains(.terminalSelection))
            #expect(allPages.contains(.projectFolder))
            #expect(allPages.contains(.dashboardProtection))
            #expect(allPages.contains(.notifications))
            #expect(allPages.contains(.agentArmy))
            #expect(allPages.contains(.accessDashboard))
        }
        
        @Test("OnboardingPage displayName provides human-readable names")
        func displayNames() throws {
            #expect(OnboardingPage.welcome.displayName == "Welcome")
            #expect(OnboardingPage.cliInstallation.displayName == "CLI Installation")
            #expect(OnboardingPage.permissions.displayName == "Permissions")
            #expect(OnboardingPage.terminalSelection.displayName == "Terminal Selection")
            #expect(OnboardingPage.projectFolder.displayName == "Project Folder")
            #expect(OnboardingPage.dashboardProtection.displayName == "Dashboard Protection")
            #expect(OnboardingPage.notifications.displayName == "Notifications")
            #expect(OnboardingPage.agentArmy.displayName == "Agent Army")
            #expect(OnboardingPage.accessDashboard.displayName == "Access Dashboard")
        }
        
        @Test("OnboardingPage canSkipWhenConfigured defaults correctly", .tags(.critical))
        func skipBehaviorDefaults() throws {
            // Pages that can be skipped when configured
            #expect(OnboardingPage.cliInstallation.canSkipWhenConfigured == true)
            #expect(OnboardingPage.permissions.canSkipWhenConfigured == true)
            #expect(OnboardingPage.projectFolder.canSkipWhenConfigured == true)
            #expect(OnboardingPage.dashboardProtection.canSkipWhenConfigured == true)
            #expect(OnboardingPage.notifications.canSkipWhenConfigured == true)
            
            // Pages that are always shown
            #expect(OnboardingPage.welcome.canSkipWhenConfigured == false)
            #expect(OnboardingPage.terminalSelection.canSkipWhenConfigured == false)
            #expect(OnboardingPage.agentArmy.canSkipWhenConfigured == false)
            #expect(OnboardingPage.accessDashboard.canSkipWhenConfigured == false)
        }
    }
    
    
    // MARK: - OnboardingState Integration Tests
    
    @Suite("OnboardingState Integration Tests")
    struct OnboardingStateIntegrationTests {
        
        @Test("OnboardingState shared instance is accessible", .tags(.integration))
        @MainActor
        func sharedInstanceAccess() throws {
            let state = OnboardingState.shared
            
            #if DEBUG
            state.resetForTesting()
            #endif
            
            // Should start with empty visible pages (analysis not run)
            #expect(state.visiblePages.isEmpty)
        }
        
        @Test("OnboardingState startDynamicPageAnalysis initializes pages", .tags(.integration))
        @MainActor
        func dynamicAnalysisInitialization() throws {
            let state = OnboardingState.shared
            
            #if DEBUG
            state.resetForTesting()
            #endif
            
            // Start analysis
            state.startDynamicPageAnalysis()
            
            // Should immediately have all pages (before background analysis completes)
            #expect(state.visiblePages.count == OnboardingPage.allCases.count)
            #expect(state.visiblePages == OnboardingPage.allCases)
        }
        
        @Test("OnboardingState background analysis runs without crashing", .tags(.concurrency))
        func backgroundAnalysisStability() async throws {
            await MainActor.run {
                let state = OnboardingState.shared
                
                #if DEBUG
                state.resetForTesting()
                #endif
                
                state.startDynamicPageAnalysis()
                
                // Immediately after starting, all pages should be present
                #expect(state.visiblePages.count == OnboardingPage.allCases.count)
            }
            
            // Wait for background analysis to potentially complete
            try await Task.sleep(for: .milliseconds(500))
            
            // Check final state on main actor
            await MainActor.run {
                let state = OnboardingState.shared
                // After analysis, we may have removed pages based on system state
                // In a fully configured system, only non-skippable pages remain (4 pages)
                // In an unconfigured system, all pages remain (9 pages)
                #expect(state.visiblePages.count >= 4) // At minimum: welcome, terminalSelection, agentArmy, accessDashboard
                #expect(state.visiblePages.count <= OnboardingPage.allCases.count)
            }
        }
    }
    
    // MARK: - Edge Cases and Error Handling
    
    @Suite("OnboardingState Edge Cases")
    struct OnboardingStateEdgeCases {
        
        @MainActor @Test("Empty mock state handles gracefully")
        func emptyMockState() throws {
            let mockState = MockOnboardingState(pages: [])
            
            #expect(mockState.visiblePages.isEmpty)
            
            // Should not crash
            mockState.startDynamicPageAnalysis()
        }
        
        @MainActor @Test("All pages mock state handles gracefully")
        func allPagesMockState() throws {
            let mockState = MockOnboardingState(pages: OnboardingPage.allCases)
            
            #expect(mockState.visiblePages.count == 9)
            #expect(mockState.visiblePages == OnboardingPage.allCases)
        }
        
        @MainActor @Test("Duplicate pages in mock state", .tags(.regression))
        func duplicatePagesMockState() throws {
            // This shouldn't happen in practice but test robustness
            let duplicatePages: [OnboardingPage] = [.welcome, .welcome, .permissions]
            let mockState = MockOnboardingState(pages: duplicatePages)
            
            #expect(mockState.visiblePages.count == 3)
        }
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
