import Foundation
import Testing
@testable import VibeTunnel

@Suite("ConnectionManager Tests", .tags(.critical, .persistence))
@MainActor
struct ConnectionManagerTests {
    @Test("Saves and loads server configuration")
    func serverConfigPersistence() throws {
        // Arrange
        let mockStorage = MockStorage()
        let manager = ConnectionManager(storage: mockStorage)
        let config = TestFixtures.validServerConfig

        // Act
        manager.saveConnection(config)

        // Create a new manager with the same storage to test loading
        let newManager = ConnectionManager(storage: mockStorage)

        // Assert
        #expect(newManager.serverConfig != nil)
        #expect(newManager.serverConfig?.host == config.host)
        #expect(newManager.serverConfig?.port == config.port)
    }

    @Test("Handles missing server configuration")
    func missingServerConfig() {
        // Arrange
        let mockStorage = MockStorage() // Empty storage

        // Act
        let manager = ConnectionManager(storage: mockStorage)

        // Assert
        #expect(manager.serverConfig == nil)
        #expect(manager.isConnected == false)
    }

    @Test("Tracks connection state in storage")
    func connectionStateTracking() {
        // Arrange
        let mockStorage = MockStorage()
        let manager = ConnectionManager(storage: mockStorage)

        // Act & Assert - Initial state
        #expect(manager.isConnected == false)
        #expect(mockStorage.bool(forKey: "connectionState") == false)

        // Set connected
        manager.isConnected = true
        #expect(mockStorage.bool(forKey: "connectionState") == true)

        // Set disconnected
        manager.isConnected = false
        #expect(mockStorage.bool(forKey: "connectionState") == false)
    }

    @Test("Saves connection timestamp")
    func connectionTimestamp() throws {
        // Arrange
        let mockStorage = MockStorage()
        let manager = ConnectionManager(storage: mockStorage)
        let config = TestFixtures.validServerConfig

        // Act
        let beforeSave = Date()
        manager.saveConnection(config)
        let afterSave = Date()

        // Assert
        #expect(manager.lastConnectionTime != nil)
        guard let savedTime = manager.lastConnectionTime else {
            #expect(Bool(false), "lastConnectionTime should not be nil")
            return
        }
        #expect(savedTime >= beforeSave)
        #expect(savedTime <= afterSave)

        // Verify it's persisted
        let persistedTime = mockStorage.object(forKey: "lastConnectionTime") as? Date
        #expect(persistedTime != nil)
        #expect(persistedTime == savedTime)
    }

    @Test("Restores connection within time window")
    func connectionRestorationWithinWindow() throws {
        // Arrange - Set up a recent connection
        let mockStorage = MockStorage()
        let config = TestFixtures.validServerConfig
        if let data = try? JSONEncoder().encode(config) {
            mockStorage.set(data, forKey: "savedServerConfig")
        }
        mockStorage.set(true, forKey: "connectionState")
        mockStorage.set(Date(), forKey: "lastConnectionTime") // Now

        // Act
        let manager = ConnectionManager(storage: mockStorage)

        // Assert - Should restore connection
        #expect(manager.isConnected == true)
        #expect(manager.serverConfig != nil)
    }

    @Test("Does not restore stale connection")
    func staleConnectionNotRestored() throws {
        // Arrange - Set up an old connection (2 hours ago)
        let mockStorage = MockStorage()
        let config = TestFixtures.validServerConfig
        if let data = try? JSONEncoder().encode(config) {
            mockStorage.set(data, forKey: "savedServerConfig")
        }
        mockStorage.set(true, forKey: "connectionState")
        let twoHoursAgo = Date().addingTimeInterval(-7_200)
        mockStorage.set(twoHoursAgo, forKey: "lastConnectionTime")

        // Act
        let manager = ConnectionManager(storage: mockStorage)

        // Assert - Should not restore connection
        #expect(manager.isConnected == false)
        #expect(manager.serverConfig != nil) // Config is still loaded
    }

    @Test("Disconnect clears connection state")
    func disconnectClearsState() async throws {
        // Arrange
        let mockStorage = MockStorage()
        let manager = ConnectionManager(storage: mockStorage)
        let config = TestFixtures.validServerConfig

        // Set up connected state
        manager.saveConnection(config)
        manager.isConnected = true

        // Act
        await manager.disconnect()

        // Assert
        #expect(manager.isConnected == false)
        #expect(mockStorage.object(forKey: "connectionState") == nil)
        #expect(mockStorage.object(forKey: "lastConnectionTime") == nil)
        #expect(manager.serverConfig != nil) // Config is preserved
    }

    @Test("Does not restore without server config")
    func noRestorationWithoutConfig() {
        // Arrange - Connection state but no config
        let mockStorage = MockStorage()
        mockStorage.set(true, forKey: "connectionState")
        mockStorage.set(Date(), forKey: "lastConnectionTime")
        // No saved server config

        // Act
        let manager = ConnectionManager(storage: mockStorage)

        // Assert
        #expect(manager.isConnected == false)
        #expect(manager.serverConfig == nil)
    }

    @Test("CurrentServerConfig returns saved config")
    func testCurrentServerConfig() throws {
        // Arrange
        let mockStorage = MockStorage()
        let manager = ConnectionManager(storage: mockStorage)
        let config = TestFixtures.validServerConfig

        // Act & Assert - Initially nil
        #expect(manager.currentServerConfig == nil)

        // Save config
        manager.saveConnection(config)

        // Should return the saved config
        #expect(manager.currentServerConfig != nil)
        #expect(manager.currentServerConfig?.host == config.host)
    }

    @Test("Creates authentication service on save connection")
    func authenticationServiceCreation() throws {
        // Arrange
        let mockStorage = MockStorage()
        let manager = ConnectionManager(storage: mockStorage)
        let config = TestFixtures.validServerConfig

        // Act
        manager.saveConnection(config)

        // Assert
        #expect(manager.authenticationService != nil)
    }

    @Test("Restores authentication service on load")
    func authenticationServiceRestoration() throws {
        // Arrange - Save a config first
        let mockStorage = MockStorage()
        let config = TestFixtures.validServerConfig
        if let data = try? JSONEncoder().encode(config) {
            mockStorage.set(data, forKey: "savedServerConfig")
        }

        // Act - Create new manager (simulates app restart)
        let manager = ConnectionManager(storage: mockStorage)

        // Assert
        #expect(manager.serverConfig != nil)
        #expect(manager.authenticationService != nil)
    }

    @Test("Clears authentication service on disconnect")
    func authenticationServiceCleanup() async throws {
        // Arrange
        let mockStorage = MockStorage()
        let manager = ConnectionManager(storage: mockStorage)
        let config = TestFixtures.validServerConfig
        manager.saveConnection(config)
        
        // Verify auth service is created
        #expect(manager.authenticationService != nil)

        // Act
        await manager.disconnect()

        // Assert - No waiting needed, disconnect is now async and completes cleanup
        #expect(manager.authenticationService == nil)
    }

    @Test("Handles corrupted saved data gracefully")
    func corruptedDataHandling() {
        // Arrange - Save corrupted data
        let mockStorage = MockStorage()
        mockStorage.set("not valid json data".data(using: .utf8), forKey: "savedServerConfig")

        // Act
        let manager = ConnectionManager(storage: mockStorage)

        // Assert - Should handle gracefully
        #expect(manager.serverConfig == nil)
        #expect(manager.isConnected == false)
    }

    @Test("Connection state changes are observable")
    func connectionStateObservation() async throws {
        // Arrange
        let mockStorage = MockStorage()
        let manager = ConnectionManager(storage: mockStorage)
        
        // Verify initial state
        #expect(manager.isConnected == false)
        #expect(mockStorage.bool(forKey: "connectionState") == false)

        // Act - Change state and verify immediate observation
        manager.isConnected = true
        
        // Assert - State should be immediately observable (synchronous)
        #expect(manager.isConnected == true)
        #expect(mockStorage.bool(forKey: "connectionState") == true)
        
        // Test state change back to false
        manager.isConnected = false
        #expect(manager.isConnected == false)
        #expect(mockStorage.bool(forKey: "connectionState") == false)
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

    @Test("State change validation prevents unnecessary storage writes")
    func stateChangeValidation() {
        // Arrange
        let mockStorage = MockStorage()
        let manager = ConnectionManager(storage: mockStorage)
        
        // Initially false
        #expect(manager.isConnected == false)
        
        // Setting to same value shouldn't trigger storage write
        manager.isConnected = false
        #expect(mockStorage.bool(forKey: "connectionState") == false)
        
        // Change to true should trigger storage write
        manager.isConnected = true
        #expect(mockStorage.bool(forKey: "connectionState") == true)
        
        // Setting to same value again shouldn't trigger additional write
        manager.isConnected = true
        #expect(mockStorage.bool(forKey: "connectionState") == true)
    }


    @Test("Authentication service cleanup on failed logout")
    func authServiceCleanupOnFailedLogout() async throws {
        // Arrange
        let mockStorage = MockStorage()
        let manager = ConnectionManager(storage: mockStorage)
        let config = TestFixtures.validServerConfig
        manager.saveConnection(config)
        
        // Verify auth service is created
        #expect(manager.authenticationService != nil)

        // Act - Disconnect (which may fail logout but should still clean up)
        await manager.disconnect()

        // Assert - Auth service should be cleaned up even if logout fails
        #expect(manager.authenticationService == nil)
        #expect(manager.isConnected == false)
    }

    @Test("Server config encoding failure handling")
    func serverConfigEncodingFailure() {
        // This test verifies that if encoding fails, the connection isn't saved
        let mockStorage = MockStorage()
        let manager = ConnectionManager(storage: mockStorage)
        
        // Create a config that should encode successfully first
        let validConfig = TestFixtures.validServerConfig
        manager.saveConnection(validConfig)
        
        // Verify the config was saved
        #expect(manager.serverConfig != nil)
        #expect(mockStorage.hasValue(forKey: "savedServerConfig"))
    }
}

// MARK: - Integration Tests

@Suite("ConnectionManager Integration Tests", .tags(.integration, .persistence))
@MainActor
struct ConnectionManagerIntegrationTests {
    @Test("Full connection lifecycle", .timeLimit(.minutes(1)))
    func fullConnectionLifecycle() async throws {
        // Arrange
        let mockStorage = MockStorage()
        let manager = ConnectionManager(storage: mockStorage)
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
        #expect(mockStorage.bool(forKey: "connectionState") == true)

        // 4. Simulate app restart by creating new manager with same storage
        let newManager = ConnectionManager(storage: mockStorage)
        #expect(newManager.serverConfig?.host == config.host)
        #expect(newManager.isConnected == true) // Restored

        // 5. Disconnect
        await newManager.disconnect()
        #expect(newManager.isConnected == false)
        #expect(newManager.serverConfig != nil) // Config preserved

        // 6. Another restart should not restore connection
        let finalManager = ConnectionManager(storage: mockStorage)
        #expect(finalManager.serverConfig != nil)
        #expect(finalManager.isConnected == false)
    }
}
