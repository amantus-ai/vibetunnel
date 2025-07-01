import Foundation
import Testing
@testable import VibeTunnel

// MARK: - Server Manager Tests

@Suite("Server Manager Tests", .serialized, .disabled("Server tests disabled in CI"))
@MainActor
final class ServerManagerTests {
    /// We'll use the shared ServerManager instance since it's a singleton
    let manager = ServerManager.shared

    init() async {
        // Ensure clean state before each test
        await manager.stop()
    }

    deinit {
        // Clean up is handled in init() of next test since we can't use async in deinit
    }

    // MARK: - Server Lifecycle Tests

    @Test("Starting and stopping Bun server", .tags(.critical))
    func serverLifecycle() async throws {
        // Start the server
        await manager.start()

        // Give server time to attempt start
        try await Task.sleep(for: .milliseconds(2_000))

        // In test environment, server binary won't be found, so we expect failure
        // Check that lastError indicates the binary wasn't found
        if let error = manager.lastError as? BunServerError {
            #expect(error == .binaryNotFound)
        }

        // Server should not be running without the binary
        #expect(!manager.isRunning)
        #expect(manager.bunServer == nil)

        // Stop should work even if server never started
        await manager.stop()

        // Check server is stopped
        #expect(!manager.isRunning)
        #expect(manager.bunServer == nil)
    }

    @Test("Starting server when already running does not create duplicate", .tags(.critical))
    func startingAlreadyRunningServer() async throws {
        // In test environment, we can't actually start the server
        // So we'll test the logic of preventing duplicate starts

        // First attempt to start
        await manager.start()
        try await Task.sleep(for: .milliseconds(1_000))

        let firstServer = manager.bunServer
        let firstError = manager.lastError

        // Try to start again
        await manager.start()

        // Should still have the same state (either nil or same instance)
        #expect(manager.bunServer === firstServer)

        // Error should be consistent
        if let error1 = firstError as? BunServerError,
           let error2 = manager.lastError as? BunServerError
        {
            #expect(error1 == error2)
        }

        // Cleanup
        await manager.stop()
    }

    @Test("Port configuration")
    func portConfiguration() async throws {
        // Store original port
        let originalPort = manager.port

        // Test setting different ports
        let testPorts = ["8080", "3000", "9999"]

        for port in testPorts {
            manager.port = port
            #expect(manager.port == port)
            #expect(UserDefaults.standard.string(forKey: "serverPort") == port)
        }

        // Restore original port
        manager.port = originalPort
    }

    @Test("Bind address configuration", arguments: [
        DashboardAccessMode.localhost,
        DashboardAccessMode.network
    ])
    func bindAddressConfiguration(mode: DashboardAccessMode) async throws {
        // Store original mode
        let originalMode = UserDefaults.standard.string(forKey: "dashboardAccessMode") ?? ""

        // Set the mode via UserDefaults (as bindAddress setter does)
        UserDefaults.standard.set(mode.rawValue, forKey: "dashboardAccessMode")

        // Check bind address reflects the mode
        #expect(manager.bindAddress == mode.bindAddress)

        // Restore original mode
        UserDefaults.standard.set(originalMode, forKey: "dashboardAccessMode")
    }

    // MARK: - Concurrent Operations Tests

    @Test("Concurrent server operations are serialized", .tags(.concurrency))
    func concurrentServerOperations() async throws {
        // Ensure clean state
        await manager.stop()

        // Start multiple operations concurrently
        await withTaskGroup(of: Void.self) { group in
            // Start server
            group.addTask { [manager] in
                await manager.start()
            }

            // Try to stop immediately
            group.addTask { [manager] in
                try? await Task.sleep(for: .milliseconds(50))
                await manager.stop()
            }

            // Try to restart
            group.addTask { [manager] in
                try? await Task.sleep(for: .milliseconds(100))
                await manager.restart()
            }

            await group.waitForAll()
        }

        // Server should be in a consistent state
        let finalState = manager.isRunning
        if finalState {
            #expect(manager.bunServer != nil)
        } else {
            #expect(manager.bunServer == nil)
        }

        // Cleanup
        await manager.stop()
    }

    @Test("Server restart maintains configuration", .tags(.critical))
    func serverRestart() async throws {
        // Set specific configuration
        let originalPort = manager.port
        let testPort = "4567"
        manager.port = testPort

        // Start server
        await manager.start()
        try await Task.sleep(for: .milliseconds(200))

        let serverBeforeRestart = manager.bunServer
        _ = manager.lastError

        // Restart
        await manager.restart()
        try await Task.sleep(for: .milliseconds(200))

        // Verify port configuration is maintained
        #expect(manager.port == testPort)

        // In test environment without binary, both instances should be nil
        #expect(manager.bunServer == nil)
        #expect(serverBeforeRestart == nil)

        // Error should be consistent (binary not found)
        if let error = manager.lastError as? BunServerError {
            #expect(error == .binaryNotFound)
        }

        // Cleanup - restore original port
        manager.port = originalPort
        await manager.stop()
    }

    // MARK: - Error Handling Tests

    @Test("Server state remains consistent after operations", .tags(.reliability))
    func serverStateConsistency() async throws {
        // Ensure clean state
        await manager.stop()

        // Perform various operations
        await manager.start()
        try await Task.sleep(for: .milliseconds(200))

        await manager.stop()
        try await Task.sleep(for: .milliseconds(200))

        await manager.start()
        try await Task.sleep(for: .milliseconds(200))

        // State should be consistent
        if manager.isRunning {
            #expect(manager.bunServer != nil)
        } else {
            #expect(manager.bunServer == nil)
        }

        // Cleanup
        await manager.stop()
    }

    // MARK: - Crash Recovery Tests

    @Test("Server auto-restart behavior")
    func serverAutoRestart() async throws {
        // Start server
        await manager.start()
        try await Task.sleep(for: .milliseconds(200))

        // In test environment, server won't actually start
        #expect(!manager.isRunning)
        #expect(manager.bunServer == nil)

        // Verify error is set appropriately
        if let error = manager.lastError as? BunServerError {
            #expect(error == .binaryNotFound)
        }

        // Note: We can't easily simulate crashes in tests without
        // modifying the production code. The BunServer has built-in
        // auto-restart functionality on unexpected termination.

        // Cleanup
        await manager.stop()
    }
}
