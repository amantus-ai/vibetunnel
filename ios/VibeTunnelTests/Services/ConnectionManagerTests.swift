import Foundation
import Testing
@testable import VibeTunnel

@Suite("ConnectionManager Tests", .tags(.critical, .persistence))
@MainActor
struct ConnectionManagerTests {
    @Test("Saves and loads server configuration")
    func serverConfigPersistence() throws {
        // Arrange
        let manager = ConnectionManager()
        let config = TestFixtures.validServerConfig

        // Clear any existing config
        UserDefaults.standard.removeObject(forKey: "savedServerConfig")

        // Act
        manager.saveConnection(config)

        // Create a new manager to test loading
        let newManager = ConnectionManager()

        // Assert
        #expect(newManager.serverConfig != nil)
        #expect(newManager.serverConfig?.host == config.host)
        #expect(newManager.serverConfig?.port == config.port)
    }

    @Test("Handles missing server configuration")
    func missingServerConfig() {
        // Arrange
        UserDefaults.standard.removeObject(forKey: "savedServerConfig")

        // Act
        let manager = ConnectionManager()

        // Assert
        #expect(manager.serverConfig == nil)
        #expect(manager.isConnected == false)
    }

    @Test("Tracks connection state in UserDefaults")
    func connectionStateTracking() {
        // Arrange
        let manager = ConnectionManager()
        UserDefaults.standard.removeObject(forKey: "connectionState")

        // Act & Assert - Initial state
        #expect(manager.isConnected == false)

        // Set connected
        manager.isConnected = true
        #expect(UserDefaults.standard.bool(forKey: "connectionState") == true)

        // Set disconnected
        manager.isConnected = false
        #expect(UserDefaults.standard.bool(forKey: "connectionState") == false)
    }

    @Test("Saves connection timestamp")
    func connectionTimestamp() throws {
        // Arrange
        let manager = ConnectionManager()
        let config = TestFixtures.validServerConfig

        // Act
        let beforeSave = Date()
        manager.saveConnection(config)
        let afterSave = Date()

        // Assert
        #expect(manager.lastConnectionTime != nil)
        let savedTime = manager.lastConnectionTime!
        #expect(savedTime >= beforeSave)
        #expect(savedTime <= afterSave)

        // Verify it's persisted
        let persistedTime = UserDefaults.standard.object(forKey: "lastConnectionTime") as? Date
        #expect(persistedTime != nil)
        #expect(persistedTime == savedTime)
    }

    @Test("Restores connection within time window")
    func connectionRestorationWithinWindow() throws {
        // Arrange - Set up a recent connection
        let config = TestFixtures.validServerConfig
        if let data = try? JSONEncoder().encode(config) {
            UserDefaults.standard.set(data, forKey: "savedServerConfig")
        }
        UserDefaults.standard.set(true, forKey: "connectionState")
        UserDefaults.standard.set(Date(), forKey: "lastConnectionTime") // Now

        // Act
        let manager = ConnectionManager()

        // Assert - Should restore connection
        #expect(manager.isConnected == true)
        #expect(manager.serverConfig != nil)
    }

    @Test("Does not restore stale connection")
    func staleConnectionNotRestored() throws {
        // Arrange - Set up an old connection (2 hours ago)
        let config = TestFixtures.validServerConfig
        if let data = try? JSONEncoder().encode(config) {
            UserDefaults.standard.set(data, forKey: "savedServerConfig")
        }
        UserDefaults.standard.set(true, forKey: "connectionState")
        let twoHoursAgo = Date().addingTimeInterval(-7_200)
        UserDefaults.standard.set(twoHoursAgo, forKey: "lastConnectionTime")

        // Act
        let manager = ConnectionManager()

        // Assert - Should not restore connection
        #expect(manager.isConnected == false)
        #expect(manager.serverConfig != nil) // Config is still loaded
    }

    @Test("Disconnect clears connection state")
    func disconnectClearsState() throws {
        // Arrange
        let manager = ConnectionManager()
        let config = TestFixtures.validServerConfig

        // Set up connected state
        manager.saveConnection(config)
        manager.isConnected = true

        // Act
        manager.disconnect()

        // Assert
        #expect(manager.isConnected == false)
        #expect(UserDefaults.standard.object(forKey: "connectionState") == nil)
        #expect(UserDefaults.standard.object(forKey: "lastConnectionTime") == nil)
        #expect(manager.serverConfig != nil) // Config is preserved
    }

    @Test("Does not restore without server config")
    func noRestorationWithoutConfig() {
        // Arrange - Connection state but no config
        UserDefaults.standard.removeObject(forKey: "savedServerConfig")
        UserDefaults.standard.set(true, forKey: "connectionState")
        UserDefaults.standard.set(Date(), forKey: "lastConnectionTime")

        // Act
        let manager = ConnectionManager()

        // Assert
        #expect(manager.isConnected == false)
        #expect(manager.serverConfig == nil)
    }

    @Test("CurrentServerConfig returns saved config")
    func testCurrentServerConfig() throws {
        // Clean up UserDefaults first
        UserDefaults.standard.removeObject(forKey: "savedServerConfig")
        UserDefaults.standard.removeObject(forKey: "connectionState")
        UserDefaults.standard.removeObject(forKey: "lastConnectionTime")
        
        // Arrange
        let manager = ConnectionManager()
        let config = TestFixtures.validServerConfig

        // Act & Assert - Initially nil
        #expect(manager.currentServerConfig == nil)

        // Save config
        manager.saveConnection(config)

        // Should return the saved config
        #expect(manager.currentServerConfig != nil)
        #expect(manager.currentServerConfig?.host == config.host)
    }

    @Test("Handles corrupted saved data gracefully")
    func corruptedDataHandling() {
        // Arrange - Save corrupted data
        UserDefaults.standard.set("not valid json data".data(using: .utf8), forKey: "savedServerConfig")

        // Act
        let manager = ConnectionManager()

        // Assert - Should handle gracefully
        #expect(manager.serverConfig == nil)
        #expect(manager.isConnected == false)
    }

    @Test("Connection state changes are observable")
    func connectionStateObservation() async throws {
        // Arrange
        let manager = ConnectionManager()
        var stateChanged = false

        // Observe connection state changes
        Task {
            let initialState = manager.isConnected
            while manager.isConnected == initialState {
                try? await Task.sleep(nanoseconds: 10_000_000) // 10ms
            }
            stateChanged = true
        }

        // Act
        try await Task.sleep(nanoseconds: 50_000_000) // 50ms
        manager.isConnected = true

        // Assert
        // Wait for state change
        let timeout = Date().addingTimeInterval(1.0)
        while !stateChanged && Date() < timeout {
            try await Task.sleep(nanoseconds: 10_000_000) // 10ms
        }
        #expect(stateChanged)
    }

    @Test("Thread safety of shared instance")
    func sharedInstanceThreadSafety() async throws {
        // Test that the shared instance is properly MainActor-isolated
        let shared = ConnectionManager.shared

        // This should be the same instance when accessed from main actor
        await MainActor.run {
            let mainActorShared = ConnectionManager.shared
            #expect(shared === mainActorShared)
        }
    }
}

// MARK: - Integration Tests

@Suite("ConnectionManager Integration Tests", .tags(.integration, .persistence))
@MainActor
struct ConnectionManagerIntegrationTests {
    @Test("Full connection lifecycle", .timeLimit(.minutes(1)))
    func fullConnectionLifecycle() async throws {
        // Clear state BEFORE creating manager
        UserDefaults.standard.removeObject(forKey: "savedServerConfig")
        UserDefaults.standard.removeObject(forKey: "connectionState")
        UserDefaults.standard.removeObject(forKey: "lastConnectionTime")
        
        // Arrange
        let manager = ConnectionManager()
        let config = TestFixtures.sslServerConfig

        // Act & Assert through lifecycle

        // 1. Initial state
        #expect(manager.serverConfig == nil)
        #expect(manager.isConnected == false)

        // 2. Save connection
        manager.saveConnection(config)
        #expect(manager.serverConfig != nil)
        #expect(manager.lastConnectionTime != nil)

        // 3. Connect
        manager.isConnected = true
        #expect(UserDefaults.standard.bool(forKey: "connectionState") == true)

        // 4. Simulate app restart by creating new manager
        let newManager = ConnectionManager()
        #expect(newManager.serverConfig?.host == config.host)
        #expect(newManager.isConnected == true) // Restored

        // 5. Disconnect
        newManager.disconnect()
        #expect(newManager.isConnected == false)
        #expect(newManager.serverConfig != nil) // Config preserved

        // 6. Another restart should not restore connection
        let finalManager = ConnectionManager()
        #expect(finalManager.serverConfig != nil)
        #expect(finalManager.isConnected == false)
    }
}
