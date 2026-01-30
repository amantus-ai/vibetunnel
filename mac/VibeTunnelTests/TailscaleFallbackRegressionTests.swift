import Foundation
import os.log
import Testing
@testable import VibeTunnel

/// Regression tests for Tailscale fallback functionality
/// These tests verify the fixes for issues introduced in Release 15
@Suite("Tailscale Fallback Regression Tests", .serialized, .tags(.regression))
@MainActor
final class TailscaleFallbackRegressionTests {
    private let logger = Logger(subsystem: "test.vibetunnel", category: "TailscaleRegressionTests")
    private var serverManager: ServerManager!
    private var tailscaleService: TailscaleServeStatusService!

    init() async {
        self.serverManager = ServerManager.shared
        self.tailscaleService = TailscaleServeStatusService.shared

        // Ensure clean state
        await self.serverManager.stop()
        self.tailscaleService.stopMonitoring()

        // Reset UserDefaults for testing
        UserDefaults.standard.removeObject(forKey: AppConstants.UserDefaultsKeys.tailscaleServeEnabled)
    }

    deinit {
        // Cleanup handled in init of next test
    }

    // MARK: - Regression Test 1: Toggle Auto-Disable Bug

    @Test(
        "Tailscale toggle does not auto-disable after 10 seconds",
        .tags(.critical),
        .timeLimit(.minutes(1)))
    func tailscaleToggleDoesNotAutoDisable() async throws {
        self.logger.info("Testing that Tailscale toggle remains enabled in fallback mode")

        // Enable Tailscale Serve in settings
        UserDefaults.standard.set(true, forKey: AppConstants.UserDefaultsKeys.tailscaleServeEnabled)

        // Verify the setting is enabled
        let initialValue = AppConstants.boolValue(for: AppConstants.UserDefaultsKeys.tailscaleServeEnabled)
        #expect(initialValue == true, "Tailscale should be enabled initially")

        // Start the server (which starts monitoring)
        await self.serverManager.start()

        // Wait for monitoring to potentially trigger the old bug (it checked every 10 seconds)
        self.logger.info("Waiting 15 seconds to ensure toggle doesn't auto-disable...")
        try await Task.sleep(for: .seconds(15))

        // Check that the toggle is still enabled
        let afterWaitValue = AppConstants.boolValue(for: AppConstants.UserDefaultsKeys.tailscaleServeEnabled)
        #expect(afterWaitValue == true, "Tailscale toggle should remain enabled after 15 seconds")

        // Also verify that if isPermanentlyDisabled is set, toggle still stays enabled
        if self.tailscaleService.isPermanentlyDisabled {
            self.logger.info("Service is in fallback mode (isPermanentlyDisabled = true)")
            let fallbackValue = AppConstants.boolValue(for: AppConstants.UserDefaultsKeys.tailscaleServeEnabled)
            #expect(fallbackValue == true, "Toggle should remain enabled even in fallback mode")
        }

        // Cleanup
        await self.serverManager.stop()
    }

    // MARK: - Regression Test 2: Forced Localhost Binding Bug

    @Test(
        "Server binds to network interface with Tailscale fallback",
        .tags(.critical))
    func serverBindsToNetworkWithTailscaleFallback() async throws {
        self.logger.info("Testing that server doesn't force localhost binding")

        // Set dashboard access to network mode
        UserDefaults.standard.set(
            AppConstants.DashboardAccessModeRawValues.network,
            forKey: AppConstants.UserDefaultsKeys.dashboardAccessMode)

        // Enable Tailscale (this used to force localhost in Release 15)
        UserDefaults.standard.set(true, forKey: AppConstants.UserDefaultsKeys.tailscaleServeEnabled)

        // Verify bind address is 0.0.0.0 (network accessible)
        #expect(self.serverManager.bindAddress == "0.0.0.0", "Server should bind to 0.0.0.0 for network access")

        // Start the server
        await self.serverManager.start()

        // Wait a moment for server to initialize
        try await Task.sleep(for: .seconds(2))

        // Check that bind address wasn't changed to localhost
        if let bunServer = serverManager.bunServer {
            #expect(
                bunServer.bindAddress == "0.0.0.0",
                "BunServer should maintain 0.0.0.0 binding, not forced to 127.0.0.1")

            // Verify original bind address is preserved for fallback
            #expect(
                bunServer.bindAddress != "127.0.0.1",
                "Server should not be forced to localhost when Tailscale Serve unavailable")
        }

        // Cleanup
        await self.serverManager.stop()
    }

    // MARK: - Regression Test 3: Fallback Mode Activation

    @Test(
        "Tailscale fallback mode activates without errors",
        .tags(.critical))
    func tailscaleFallbackModeActivation() async throws {
        self.logger.info("Testing fallback mode activation when Tailscale Serve unavailable")

        // Enable Tailscale
        UserDefaults.standard.set(true, forKey: AppConstants.UserDefaultsKeys.tailscaleServeEnabled)

        // Start monitoring
        self.tailscaleService.startMonitoring()

        // Wait for status check to potentially detect Serve unavailable
        try await Task.sleep(for: .seconds(5))

        // In fallback mode, these conditions should be true:
        // 1. If Serve is not available, isPermanentlyDisabled should be set
        // 2. Server should still be able to start
        // 3. No critical errors should prevent operation

        if self.tailscaleService.isPermanentlyDisabled {
            self.logger.info("Fallback mode activated (isPermanentlyDisabled = true)")

            // Verify the error message is user-friendly
            if let error = tailscaleService.lastError {
                #expect(
                    !error.contains("exit") && !error.contains("code 0"),
                    "Error message should not contain internal details like 'exit code 0'")
            }

            // Toggle should still be enabled
            let toggleEnabled = AppConstants.boolValue(for: AppConstants.UserDefaultsKeys.tailscaleServeEnabled)
            #expect(toggleEnabled == true, "Toggle should remain enabled in fallback mode")
        }

        // Server should be able to start regardless
        await self.serverManager.start()
        try await Task.sleep(for: .seconds(2))

        // In fallback, server might not be "running" but shouldn't have critical errors
        if let error = serverManager.lastError as? BunServerError {
            if error == .binaryNotFound {
                self.logger.warning("Skipping fallback test: bundled server binary not available")
                return
            }
        }

        // Cleanup
        await self.serverManager.stop()
        self.tailscaleService.stopMonitoring()
    }

    // MARK: - Regression Test 4: UI Error Display

    @Test(
        "UI shows correct status in fallback mode",
        .tags(.integration))
    func uIShowsCorrectStatusInFallback() async throws {
        self.logger.info("Testing UI status display in fallback mode")

        // Enable Tailscale
        UserDefaults.standard.set(true, forKey: AppConstants.UserDefaultsKeys.tailscaleServeEnabled)

        // Start monitoring to trigger status checks
        self.tailscaleService.startMonitoring()

        // Wait for initial status
        try await Task.sleep(for: .seconds(3))

        // Check the status that UI would display
        if self.tailscaleService.isPermanentlyDisabled {
            // In fallback mode, UI should show helpful status
            self.logger.info("UI should show 'Fallback' status, not error")

            // The error should be clear about what's happening
            if let error = tailscaleService.lastError {
                #expect(
                    error.contains("admin") || error.contains("tailnet") || error.contains("Serve"),
                    "Error should explain why Serve isn't available")

                // Should not show confusing technical errors
                #expect(
                    !error.contains("Process exited with code 0"),
                    "Should not show 'Process exited with code 0' error")
            }
        }

        // Cleanup
        self.tailscaleService.stopMonitoring()
    }

    // MARK: - Helper to simulate Tailscale Serve unavailable

    @Test(
        "Helper: Simulate Tailscale Serve permanently disabled",
        .tags(.integration),
        .disabled(
            if: !ProcessInfo.processInfo.environment.keys.contains("TEST_TAILSCALE_HELPERS"),
            "Helper test only runs with TEST_TAILSCALE_HELPERS=1"))
    func simulateTailscaleServeUnavailable() async throws {
        // This helper test can be used to manually trigger the fallback scenario
        self.logger.info("Simulating Tailscale Serve unavailable scenario")

        // Manually set the permanently disabled flag (normally set by status service)
        self.tailscaleService.isPermanentlyDisabled = true
        self.tailscaleService.lastError = "Serve is not enabled on your tailnet"

        // Verify fallback behavior
        #expect(self.tailscaleService.isPermanentlyDisabled == true)
        #expect(self.tailscaleService.lastError == "Serve is not enabled on your tailnet")

        // Enable Tailscale toggle
        UserDefaults.standard.set(true, forKey: AppConstants.UserDefaultsKeys.tailscaleServeEnabled)

        // Toggle should remain enabled
        let toggleValue = AppConstants.boolValue(for: AppConstants.UserDefaultsKeys.tailscaleServeEnabled)
        #expect(toggleValue == true, "Toggle should stay enabled in simulated fallback")

        // Reset
        self.tailscaleService.isPermanentlyDisabled = false
        self.tailscaleService.lastError = nil
    }
}
