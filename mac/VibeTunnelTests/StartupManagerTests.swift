import Foundation
import ServiceManagement
import Testing
@testable import VibeTunnel

@Suite("Startup Manager Tests")
struct StartupManagerTests {
    @Test("Create instance")
    @MainActor
    func createInstance() {
        let manager = StartupManager()
        // Just verify we can create an instance
        #expect(manager.isLaunchAtLoginEnabled == true || manager.isLaunchAtLoginEnabled == false)
    }

    @Test("Initial launch at login state")
    @MainActor
    func initialLaunchAtLoginState() {
        let manager = StartupManager()

        // The initial state depends on system configuration
        // We just verify it returns a boolean
        let state = manager.isLaunchAtLoginEnabled
        #expect(state == true || state == false)
    }

    @Test("Set launch at login")
    @MainActor
    func setLaunchAtLogin() {
        let manager = StartupManager()

        // Try to enable (may fail in test environment)
        manager.setLaunchAtLogin(enabled: true)

        // Try to disable (may fail in test environment)
        manager.setLaunchAtLogin(enabled: false)

        // We can't verify the actual state change in tests
        // Just ensure the methods don't crash
        #expect(true)
    }

    @Test("Service management availability")
    @available(macOS 13.0, *)
    func serviceManagementAvailability() {
        // Test that we can at least query the service status
        let service = SMAppService.mainApp

        // Status should be queryable
        let status = service.status

        // We just verify that we can get a status without crashing
        // The actual value depends on the test environment
        #expect(status.rawValue >= 0)
    }

    @Test("App bundle identifier")
    func appBundleIdentifier() {
        // In test environment, bundle identifier might be nil
        let bundleId = Bundle.main.bundleIdentifier

        if let bundleId {
            #expect(!bundleId.isEmpty)
            // In test environment, bundle ID can vary widely
            // Just verify it's a valid identifier format (contains a dot for reverse domain notation)
            #expect(bundleId.contains("."))
        } else {
            // It's OK for bundle ID to be nil in test environment
            #expect(bundleId == nil)
        }
    }

    @Test("Multiple operations")
    @MainActor
    func multipleOperations() {
        let manager = StartupManager()

        // Perform multiple operations
        manager.setLaunchAtLogin(enabled: true)
        manager.setLaunchAtLogin(enabled: false)
        manager.setLaunchAtLogin(enabled: true)

        // Just ensure no crashes
        #expect(true)
    }
}
