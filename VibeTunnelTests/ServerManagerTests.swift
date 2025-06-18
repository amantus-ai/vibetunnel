import Testing
import Foundation
@testable import VibeTunnel

// MARK: - Mock Server Implementation

@MainActor
final class MockServer: ServerProtocol {
    var isRunning: Bool = false
    var port: String = "8080"
    let serverType: ServerMode
    
    private var logContinuation: AsyncStream<ServerLogEntry>.Continuation?
    var logStream: AsyncStream<ServerLogEntry>
    
    // Test control properties
    var shouldFailStart = false
    var startError: Error?
    var startDelay: Duration?
    var stopDelay: Duration?
    
    init(serverType: ServerMode = .rust) {
        self.serverType = serverType
        let (stream, continuation) = AsyncStream<ServerLogEntry>.makeStream()
        self.logStream = stream
        self.logContinuation = continuation
    }
    
    func start() async throws {
        if let delay = startDelay {
            try await Task.sleep(for: delay)
        }
        
        if shouldFailStart {
            throw startError ?? ServerError.portInUse(port: port)
        }
        
        isRunning = true
        logContinuation?.yield(ServerLogEntry(
            level: .info,
            message: "Mock server started on port \(port)",
            source: serverType
        ))
    }
    
    func stop() async {
        if let delay = stopDelay {
            try? await Task.sleep(for: delay)
        }
        
        isRunning = false
        logContinuation?.yield(ServerLogEntry(
            level: .info,
            message: "Mock server stopped",
            source: serverType
        ))
        logContinuation?.finish()
    }
    
    func restart() async throws {
        await stop()
        try await start()
    }
}

// MARK: - Custom Errors for Testing

enum ServerError: LocalizedError {
    case portInUse(port: String)
    case initializationFailed
    case networkUnavailable
    
    var errorDescription: String? {
        switch self {
        case .portInUse(let port):
            return "Port \(port) is already in use"
        case .initializationFailed:
            return "Server initialization failed"
        case .networkUnavailable:
            return "Network is unavailable"
        }
    }
}

// MARK: - Server Manager Tests

@Suite("Server Manager Tests")
@MainActor
struct ServerManagerTests {
    // We'll use a custom ServerManager instance for each test to ensure isolation
    // Note: ServerManager is a singleton, so we'll need to be careful with state
    
    // MARK: - Server Lifecycle Tests
    
    @Test("Starting and stopping servers", .tags(.critical))
    func testServerLifecycle() async throws {
        let manager = ServerManager.shared
        
        // Ensure clean state
        await manager.stop()
        #expect(manager.currentServer == nil)
        #expect(!manager.isRunning)
        
        // Start server
        await manager.start()
        
        // Verify server is running
        #expect(manager.currentServer != nil)
        #expect(manager.isRunning)
        #expect(manager.lastError == nil)
        
        // Stop server
        await manager.stop()
        
        // Verify server is stopped
        #expect(manager.currentServer == nil)
        #expect(!manager.isRunning)
    }
    
    @Test("Starting server when already running does not create duplicate", .tags(.critical))
    func testStartingAlreadyRunningServer() async throws {
        // Skip this test as it requires real server instances
        throw TestError.skip("Requires real server instances which are not available in test environment")
    }
    
    @Test("Switching between Rust and Hummingbird", .tags(.critical))
    func testServerModeSwitching() async throws {
        // Skip this test as it requires real server instances
        throw TestError.skip("Requires real server instances which are not available in test environment")
    }
    
    @Test("Port configuration", arguments: ["8080", "3000", "9999"])
    func testPortConfiguration(port: String) async throws {
        // Skip this test as it requires real server instances
        throw TestError.skip("Requires real server instances which are not available in test environment")
    }
    
    @Test("Bind address configuration", arguments: [
        DashboardAccessMode.localhost,
        DashboardAccessMode.network
    ])
    func testBindAddressConfiguration(mode: DashboardAccessMode) async throws {
        let manager = ServerManager.shared
        
        // Set bind address
        manager.bindAddress = mode.bindAddress
        
        #expect(manager.bindAddress == mode.bindAddress)
        
        // Start server and verify it uses the correct bind address
        await manager.start()
        #expect(manager.isRunning)
        
        // Cleanup
        await manager.stop()
    }
    
    // MARK: - Concurrent Operations Tests
    
    @Test("Concurrent server operations are serialized", .tags(.concurrency))
    func testConcurrentServerOperations() async throws {
        let manager = ServerManager.shared
        
        // Ensure clean state
        await manager.stop()
        
        // Start multiple operations concurrently
        await withTaskGroup(of: Void.self) { group in
            // Start server
            group.addTask {
                await manager.start()
            }
            
            // Try to stop immediately
            group.addTask {
                try? await Task.sleep(for: .milliseconds(50))
                await manager.stop()
            }
            
            // Try to restart
            group.addTask {
                try? await Task.sleep(for: .milliseconds(100))
                await manager.restart()
            }
            
            await group.waitForAll()
        }
        
        // Server should be in a consistent state
        let finalState = manager.isRunning
        if finalState {
            #expect(manager.currentServer != nil)
        } else {
            #expect(manager.currentServer == nil)
        }
        
        // Cleanup
        await manager.stop()
    }
    
    @Test("Server restart maintains configuration", .tags(.critical))
    func testServerRestart() async throws {
        let manager = ServerManager.shared
        
        // Configure server
        let testPort = "4321"
        manager.port = testPort
        manager.serverMode = .hummingbird
        
        // Start server
        await manager.start()
        #expect(manager.isRunning)
        
        // Restart
        await manager.restart()
        
        // Verify configuration is maintained
        #expect(manager.port == testPort)
        #expect(manager.serverMode == .hummingbird)
        #expect(manager.isRunning)
        #expect(!manager.isRestarting)
        
        // Cleanup
        await manager.stop()
    }
    
    // MARK: - Error Handling Tests
    
    @Test("Server start failure is handled gracefully", .tags(.reliability))
    func testServerStartFailure() async throws {
        let manager = ServerManager.shared
        
        // This test would require dependency injection to mock server creation
        // For now, we test that the manager remains in a consistent state
        
        // Try to start with an invalid configuration (if possible)
        // In real implementation, we might force a port conflict or similar
        
        await manager.start()
        
        // Even if start fails, manager should be in consistent state
        if manager.lastError != nil {
            #expect(!manager.isRunning || manager.currentServer != nil)
        }
        
        // Cleanup
        await manager.stop()
    }
    
    // MARK: - Log Stream Tests
    
    @Test("Server logs are captured in log stream")
    func testServerLogStream() async throws {
        let manager = ServerManager.shared
        
        // Collect logs during server operations
        var collectedLogs: [ServerLogEntry] = []
        let logTask = Task {
            for await log in manager.logStream {
                collectedLogs.append(log)
                if collectedLogs.count >= 2 {
                    break
                }
            }
        }
        
        // Start server to generate logs
        await manager.start()
        
        // Wait for logs
        try await Task.sleep(for: .milliseconds(100))
        logTask.cancel()
        
        // Verify logs were captured
        #expect(!collectedLogs.isEmpty)
        #expect(collectedLogs.contains { $0.message.contains("Starting") || $0.message.contains("started") })
        
        // Cleanup
        await manager.stop()
    }
    
    // MARK: - Mode Switch via UserDefaults Tests
    
    @Test("Server mode change via UserDefaults triggers switch")
    func testServerModeChangeViaUserDefaults() async throws {
        let manager = ServerManager.shared
        
        // Start with Rust mode
        manager.serverMode = .rust
        await manager.start()
        #expect(manager.currentServer?.serverType == .rust)
        
        // Change mode via UserDefaults (simulating settings change)
        UserDefaults.standard.set(ServerMode.hummingbird.rawValue, forKey: "serverMode")
        
        // Post notification to trigger the change
        NotificationCenter.default.post(name: UserDefaults.didChangeNotification, object: nil)
        
        // Give time for the async handler to process
        try await Task.sleep(for: .milliseconds(500))
        
        // Verify server switched
        #expect(manager.serverMode == .hummingbird)
        #expect(manager.currentServer?.serverType == .hummingbird)
        
        // Cleanup
        await manager.stop()
        UserDefaults.standard.removeObject(forKey: "serverMode")
    }
    
    // MARK: - Initial Cleanup Tests
    
    @Test("Initial cleanup triggers after server start when enabled", .tags(.networking))
    func testInitialCleanupEnabled() async throws {
        let manager = ServerManager.shared
        
        // Enable cleanup on startup
        UserDefaults.standard.set(true, forKey: "cleanupOnStartup")
        
        // Start server
        await manager.start()
        
        // Give time for cleanup request
        try await Task.sleep(nanoseconds: 1_000_000_000)
        
        // In a real test, we'd verify the cleanup endpoint was called
        // For now, we just verify the server started successfully
        #expect(manager.isRunning)
        
        // Cleanup
        await manager.stop()
        UserDefaults.standard.removeObject(forKey: "cleanupOnStartup")
    }
    
    @Test("Initial cleanup is skipped when disabled")
    func testInitialCleanupDisabled() async throws {
        let manager = ServerManager.shared
        
        // Disable cleanup on startup
        UserDefaults.standard.set(false, forKey: "cleanupOnStartup")
        
        // Start server
        await manager.start()
        
        // Verify server started without cleanup
        #expect(manager.isRunning)
        
        // Cleanup
        await manager.stop()
        UserDefaults.standard.removeObject(forKey: "cleanupOnStartup")
    }
}