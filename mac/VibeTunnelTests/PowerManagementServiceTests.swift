import Testing
import Foundation
@testable import VibeTunnel

/// Tests for PowerManagementService that work reliably in CI environments
@Suite("Power Management Service")
@MainActor
struct PowerManagementServiceTests {
    
    // Since PowerManagementService has a private init, we can only test through the shared instance
    // We need to ensure proper cleanup between tests
    
    @Test("Sleep prevention defaults to true when key doesn't exist")
    func sleepPreventionDefaultValue() async {
        // Save current value
        let currentValue = UserDefaults.standard.object(forKey: AppConstants.UserDefaultsKeys.preventSleepWhenRunning)
        defer {
            // Restore original value
            if let currentValue = currentValue {
                UserDefaults.standard.set(currentValue, forKey: AppConstants.UserDefaultsKeys.preventSleepWhenRunning)
            } else {
                UserDefaults.standard.removeObject(forKey: AppConstants.UserDefaultsKeys.preventSleepWhenRunning)
            }
        }
        
        // Remove the key to simulate first launch
        UserDefaults.standard.removeObject(forKey: AppConstants.UserDefaultsKeys.preventSleepWhenRunning)
        
        // Test our helper method returns true for non-existent key
        let defaultValue = AppConstants.boolValue(for: AppConstants.UserDefaultsKeys.preventSleepWhenRunning)
        #expect(defaultValue == true, "Sleep prevention should default to true when key doesn't exist")
        
        // Verify UserDefaults.standard.bool returns false (the bug we're fixing)
        let standardDefault = UserDefaults.standard.bool(forKey: AppConstants.UserDefaultsKeys.preventSleepWhenRunning)
        #expect(standardDefault == false, "UserDefaults.standard.bool returns false for non-existent keys")
    }
    
    @Test("Update sleep prevention logic with all combinations")
    func updateSleepPreventionLogic() async {
        let service = PowerManagementService.shared
        
        // Ensure clean state
        service.allowSleep()
        
        // Test Case 1: Both enabled and server running should prevent sleep
        service.updateSleepPrevention(enabled: true, serverRunning: true)
        #expect(service.isSleepPrevented)
        
        // Test Case 2: Disabled setting should allow sleep
        service.updateSleepPrevention(enabled: false, serverRunning: true)
        #expect(!service.isSleepPrevented)
        
        // Test Case 3: Server not running should allow sleep
        service.updateSleepPrevention(enabled: true, serverRunning: false)
        #expect(!service.isSleepPrevented)
        
        // Test Case 4: Both false should allow sleep
        service.updateSleepPrevention(enabled: false, serverRunning: false)
        #expect(!service.isSleepPrevented)
        
        // Cleanup
        service.allowSleep()
    }
    
    @Test("Multiple prevent sleep calls are idempotent")
    func preventSleepIdempotency() async {
        let service = PowerManagementService.shared
        
        // Ensure clean state
        service.allowSleep()
        
        // Call preventSleep multiple times
        service.preventSleep()
        let firstState = service.isSleepPrevented
        
        service.preventSleep()
        service.preventSleep()
        
        // State should remain the same
        #expect(service.isSleepPrevented == firstState)
        
        // Cleanup
        service.allowSleep()
    }
    
    @Test("Multiple allow sleep calls are idempotent")
    func allowSleepIdempotency() async {
        let service = PowerManagementService.shared
        
        // Set up initial state
        service.preventSleep()
        
        // Call allowSleep multiple times
        service.allowSleep()
        #expect(!service.isSleepPrevented)
        
        service.allowSleep()
        service.allowSleep()
        
        // State should remain false
        #expect(!service.isSleepPrevented)
    }
    
    @Test("State transitions work correctly")
    func stateTransitions() async {
        let service = PowerManagementService.shared
        
        // Ensure clean state
        service.allowSleep()
        #expect(!service.isSleepPrevented)
        
        // Prevent sleep
        service.preventSleep()
        #expect(service.isSleepPrevented)
        
        // Allow sleep again
        service.allowSleep()
        #expect(!service.isSleepPrevented)
        
        // Use updateSleepPrevention
        service.updateSleepPrevention(enabled: true, serverRunning: true)
        #expect(service.isSleepPrevented)
        
        service.updateSleepPrevention(enabled: false, serverRunning: false)
        #expect(!service.isSleepPrevented)
        
        // Cleanup
        service.allowSleep()
    }
}

// MARK: - Edge Cases

@Suite("Power Management Edge Cases")
@MainActor
struct PowerManagementEdgeCaseTests {
    
    @Test("Rapid state changes handle correctly")
    func rapidStateChanges() async {
        let service = PowerManagementService.shared
        
        // Ensure clean state
        service.allowSleep()
        
        // Rapidly toggle state
        for _ in 0..<10 {
            service.preventSleep()
            service.allowSleep()
        }
        
        // Final state should be sleep allowed
        #expect(!service.isSleepPrevented)
        
        // Now rapidly toggle with updateSleepPrevention
        for i in 0..<10 {
            let enabled = i % 2 == 0
            service.updateSleepPrevention(enabled: enabled, serverRunning: true)
        }
        
        // Final state should match last call (i=9, odd, so enabled=false)
        #expect(!service.isSleepPrevented)
        
        // Cleanup
        service.allowSleep()
    }
}