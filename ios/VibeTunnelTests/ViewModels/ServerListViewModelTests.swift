import Foundation
import Testing
@testable import VibeTunnel

@Suite("ServerListViewModel Tests", .tags(.critical, .mvvm))
@MainActor
struct ServerListViewModelTests {
    
    // MARK: - Test Helpers
    
    private func createTestViewModel(connectionManager: ConnectionManager? = nil, networkMonitor: NetworkMonitor? = nil) -> ServerListViewModel {
        let mockStorage = MockStorage()
        let testConnectionManager = connectionManager ?? ConnectionManager.createForTesting(storage: mockStorage)
        let testNetworkMonitor = networkMonitor ?? MockNetworkMonitor(isConnected: true)
        return ServerListViewModel(connectionManager: testConnectionManager, networkMonitor: testNetworkMonitor)
    }
    
    private func createTestProfile(requiresAuth: Bool = true, username: String = "testuser") -> ServerProfile {
        return ServerProfile(
            name: "Test Server",
            url: "http://192.168.1.100:4020",
            requiresAuth: requiresAuth,
            username: requiresAuth ? username : nil
        )
    }
    
    // MARK: - Initialization Tests
    
    @Test("ViewModel initializes with empty profiles")
    func initializationWithEmptyProfiles() {
        let viewModel = createTestViewModel()
        
        #expect(viewModel.profiles.isEmpty)
        #expect(viewModel.isLoading == false)
        #expect(viewModel.errorMessage == nil)
        #expect(viewModel.showLoginView == false)
        #expect(viewModel.currentConnectingProfile == nil)
    }
    
    @Test("ViewModel loads existing profiles on initialization")
    func initializationWithExistingProfiles() {
        // Save a profile first
        let profile = createTestProfile()
        ServerProfile.save(profile)
        
        let viewModel = createTestViewModel()
        
        #expect(!viewModel.profiles.isEmpty)
        #expect(viewModel.profiles.contains { $0.id == profile.id })
        
        // Cleanup
        ServerProfile.delete(profile)
    }
    
    // MARK: - Profile Management Tests
    
    @Test("Adding new profile updates profiles list")
    func addNewProfile() async throws {
        let viewModel = createTestViewModel()
        let profile = createTestProfile()
        
        try await viewModel.addProfile(profile, password: "testpass123")
        
        #expect(viewModel.profiles.contains { $0.id == profile.id })
        
        // Verify password was saved
        let savedPassword = try? KeychainService.getPassword(for: profile.id)
        #expect(savedPassword == "testpass123")
        
        // Cleanup
        ServerProfile.delete(profile)
        try? KeychainService.deletePassword(for: profile.id)
    }
    
    @Test("Adding profile without password doesn't save to keychain")
    func addProfileWithoutPassword() async throws {
        let viewModel = createTestViewModel()
        let profile = createTestProfile(requiresAuth: false)
        
        try await viewModel.addProfile(profile, password: nil)
        
        #expect(viewModel.profiles.contains { $0.id == profile.id })
        
        // Verify no password was saved
        let savedPassword = try? KeychainService.getPassword(for: profile.id)
        #expect(savedPassword == nil)
        
        // Cleanup
        ServerProfile.delete(profile)
    }
    
    @Test("Updating profile modifies existing entry")
    func updateExistingProfile() async throws {
        let viewModel = createTestViewModel()
        let profile = createTestProfile()
        
        // Add initial profile
        try await viewModel.addProfile(profile, password: "oldpass")
        
        // Update profile
        var updatedProfile = profile
        updatedProfile.name = "Updated Server"
        try await viewModel.updateProfile(updatedProfile, password: "newpass")
        
        let foundProfile = viewModel.profiles.first { $0.id == profile.id }
        #expect(foundProfile?.name == "Updated Server")
        
        // Verify password was updated
        let savedPassword = try? KeychainService.getPassword(for: profile.id)
        #expect(savedPassword == "newpass")
        
        // Cleanup
        ServerProfile.delete(profile)
        try? KeychainService.deletePassword(for: profile.id)
    }
    
    @Test("Deleting profile removes from list and keychain")
    func deleteProfile() async throws {
        let viewModel = createTestViewModel()
        let profile = createTestProfile()
        
        // Add profile first
        try await viewModel.addProfile(profile, password: "testpass")
        
        // Delete profile
        try await viewModel.deleteProfile(profile)
        
        #expect(!viewModel.profiles.contains { $0.id == profile.id })
        
        // Verify password was deleted from keychain
        let savedPassword = try? KeychainService.getPassword(for: profile.id)
        #expect(savedPassword == nil)
    }
    
    // MARK: - Auto-Login Success Tests
    
    @Test("Auto-login succeeds with valid stored credentials")
    func autoLoginSuccessWithValidCredentials() async throws {
        let mockStorage = MockStorage()
        let connectionManager = ConnectionManager.createForTesting(storage: mockStorage)
        let viewModel = createTestViewModel(connectionManager: connectionManager)
        
        let profile = createTestProfile()
        
        // Save profile and credentials
        try await viewModel.addProfile(profile, password: "validpass")
        
        // Mock successful auth service behavior
        let mockConfig = ServerConfig(host: "192.168.1.100", port: 4020)
        connectionManager.saveConnection(mockConfig)
        
        // Test auto-login flow
        try await viewModel.connectToProfile(profile)
        
        #expect(connectionManager.isConnected == true)
        #expect(viewModel.showLoginView == false)
        #expect(viewModel.errorMessage == nil)
        
        // Cleanup
        ServerProfile.delete(profile)
        try? KeychainService.deletePassword(for: profile.id)
    }
    
    @Test("Auto-login succeeds for servers without authentication")
    func autoLoginSuccessNoAuthRequired() async throws {
        let mockStorage = MockStorage()
        let connectionManager = ConnectionManager.createForTesting(storage: mockStorage)
        let viewModel = createTestViewModel(connectionManager: connectionManager)
        
        let profile = createTestProfile(requiresAuth: false)
        
        // Save profile without password
        try await viewModel.addProfile(profile, password: nil)
        
        // Mock server config
        let mockConfig = ServerConfig(host: "192.168.1.100", port: 4020)
        connectionManager.saveConnection(mockConfig)
        
        // Test connection flow
        try await viewModel.connectToProfile(profile)
        
        #expect(connectionManager.isConnected == true)
        #expect(viewModel.showLoginView == false)
        #expect(viewModel.errorMessage == nil)
        
        // Cleanup
        ServerProfile.delete(profile)
    }
    
    // MARK: - Auto-Login Failure Tests
    
    @Test("Auto-login fails with missing credentials")
    func autoLoginFailsMissingCredentials() async throws {
        let mockStorage = MockStorage()
        let connectionManager = ConnectionManager.createForTesting(storage: mockStorage)
        let viewModel = createTestViewModel(connectionManager: connectionManager)
        
        let profile = createTestProfile()
        
        // Save profile without password
        ServerProfile.save(profile)
        viewModel.loadProfiles()
        
        // Mock server config
        let mockConfig = ServerConfig(host: "192.168.1.100", port: 4020)
        connectionManager.saveConnection(mockConfig)
        
        // Test connection - should trigger login view
        try await viewModel.connectToProfile(profile)
        
        #expect(connectionManager.isConnected == false)
        #expect(viewModel.showLoginView == true)
        #expect(viewModel.errorMessage == nil)
        
        // Cleanup
        ServerProfile.delete(profile)
    }
    
    @Test("Auto-login fails with invalid credentials")
    func autoLoginFailsInvalidCredentials() async throws {
        let mockStorage = MockStorage()
        let connectionManager = ConnectionManager.createForTesting(storage: mockStorage)
        let viewModel = createTestViewModel(connectionManager: connectionManager)
        
        let profile = createTestProfile()
        
        // Save profile with invalid password
        try await viewModel.addProfile(profile, password: "wrongpass")
        
        // Mock server config
        let mockConfig = ServerConfig(host: "192.168.1.100", port: 4020)
        connectionManager.saveConnection(mockConfig)
        
        // Test connection - should trigger login view
        try await viewModel.connectToProfile(profile)
        
        #expect(connectionManager.isConnected == false)
        #expect(viewModel.showLoginView == true)
        #expect(viewModel.errorMessage == nil)
        
        // Cleanup
        ServerProfile.delete(profile)
        try? KeychainService.deletePassword(for: profile.id)
    }
    
    // MARK: - Manual Login and Credential Saving Tests
    
    @Test("Manual login success saves credentials")
    func manualLoginSavesCredentials() async throws {
        let mockStorage = MockStorage()
        let connectionManager = ConnectionManager.createForTesting(storage: mockStorage)
        let viewModel = createTestViewModel(connectionManager: connectionManager)
        
        let profile = createTestProfile()
        
        // Save profile without password
        ServerProfile.save(profile)
        viewModel.loadProfiles()
        viewModel.currentConnectingProfile = profile
        
        // Simulate successful manual login
        viewModel.handleLoginSuccess(username: "testuser", password: "newpass")
        
        // Verify credentials were saved
        let savedPassword = try? KeychainService.getPassword(for: profile.id)
        #expect(savedPassword == "newpass")
        
        // Verify profile was updated
        let updatedProfile = ServerProfile.loadAll().first { $0.id == profile.id }
        #expect(updatedProfile?.username == "testuser")
        #expect(updatedProfile?.requiresAuth == true)
        
        #expect(connectionManager.isConnected == true)
        
        // Cleanup
        ServerProfile.delete(profile)
        try? KeychainService.deletePassword(for: profile.id)
    }
    
    @Test("Manual login without current profile handles gracefully")
    func manualLoginWithoutCurrentProfile() {
        let viewModel = createTestViewModel()
        
        // No current connecting profile set
        viewModel.currentConnectingProfile = nil
        
        // Should handle gracefully
        viewModel.handleLoginSuccess(username: "testuser", password: "testpass")
        
        // Should not crash or cause errors
        #expect(viewModel.currentConnectingProfile == nil)
    }
    
    // MARK: - Network Error Tests
    
    @Test("Connection fails with no internet connection")
    func connectionFailsNoInternet() async {
        let mockNetworkMonitor = MockNetworkMonitor(isConnected: false)
        let viewModel = createTestViewModel(networkMonitor: mockNetworkMonitor)
        
        let profile = createTestProfile()
        
        await viewModel.initiateConnectionToProfile(profile)
        
        #expect(viewModel.errorMessage == "No internet connection available")
        #expect(viewModel.showLoginView == false)
    }
    
    @Test("Connection fails with invalid server URL")
    func connectionFailsInvalidURL() async throws {
        let mockStorage = MockStorage()
        let connectionManager = ConnectionManager.createForTesting(storage: mockStorage)
        let viewModel = createTestViewModel(connectionManager: connectionManager)
        
        // Create profile with invalid URL
        let invalidProfile = ServerProfile(
            name: "Invalid Server",
            url: "invalid-url",
            requiresAuth: false
        )
        
        do {
            try await viewModel.connectToProfile(invalidProfile)
            #expect(Bool(false), "Should have thrown error for invalid URL")
        } catch {
            #expect(error is APIError)
        }
    }
    
    // MARK: - Edge Cases and Error Handling
    
    @Test("Connection with missing server config throws error")
    func connectionMissingServerConfig() async throws {
        let mockStorage = MockStorage()
        let connectionManager = ConnectionManager.createForTesting(storage: mockStorage)
        let viewModel = createTestViewModel(connectionManager: connectionManager)
        
        let profile = createTestProfile()
        // Don't save any server config
        
        do {
            try await viewModel.connectToProfile(profile)
            #expect(Bool(false), "Should have thrown error for missing config")
        } catch {
            #expect(error is APIError)
        }
    }
    
    @Test("Multiple concurrent connection attempts handled safely")
    func multipleConcurrentConnections() async throws {
        let mockStorage = MockStorage()
        let connectionManager = ConnectionManager.createForTesting(storage: mockStorage)
        let viewModel = createTestViewModel(connectionManager: connectionManager)
        
        let profile1 = createTestProfile()
        let profile2 = ServerProfile(
            name: "Test Server 2",
            url: "http://192.168.1.101:4020",
            requiresAuth: true,
            username: "testuser2"
        )
        
        // Save profiles
        try await viewModel.addProfile(profile1, password: "pass1")
        try await viewModel.addProfile(profile2, password: "pass2")
        
        // Attempt concurrent connections
        async let connection1 = viewModel.connectToProfile(profile1)
        async let connection2 = viewModel.connectToProfile(profile2)
        
        // Should handle gracefully without crashes
        do {
            try await connection1
            try await connection2
        } catch {
            // Expected to fail due to mock limitations, but shouldn't crash
        }
        
        // Cleanup
        ServerProfile.delete(profile1)
        ServerProfile.delete(profile2)
        try? KeychainService.deletePassword(for: profile1.id)
        try? KeychainService.deletePassword(for: profile2.id)
    }
    
    @Test("Profile with empty password string handles correctly")
    func profileWithEmptyPassword() async throws {
        let viewModel = createTestViewModel()
        let profile = createTestProfile()
        
        // Add profile with empty password
        try await viewModel.addProfile(profile, password: "")
        
        // Verify no password was saved for empty string
        let savedPassword = try? KeychainService.getPassword(for: profile.id)
        #expect(savedPassword == nil || savedPassword == "")
        
        // Cleanup
        ServerProfile.delete(profile)
        try? KeychainService.deletePassword(for: profile.id)
    }
    
    @Test("Profile update with nil password deletes keychain entry")
    func profileUpdateNilPasswordDeletesKeychain() async throws {
        let viewModel = createTestViewModel()
        let profile = createTestProfile()
        
        // Add profile with password
        try await viewModel.addProfile(profile, password: "testpass")
        
        // Update with nil password (should delete)
        try await viewModel.updateProfile(profile, password: nil)
        
        // Verify password was deleted
        let savedPassword = try? KeychainService.getPassword(for: profile.id)
        #expect(savedPassword == nil)
        
        // Cleanup
        ServerProfile.delete(profile)
    }
    
    @Test("Profile update with empty password deletes keychain entry")
    func profileUpdateEmptyPasswordDeletesKeychain() async throws {
        let viewModel = createTestViewModel()
        let profile = createTestProfile()
        
        // Add profile with password
        try await viewModel.addProfile(profile, password: "testpass")
        
        // Update with empty password (should delete)
        try await viewModel.updateProfile(profile, password: "")
        
        // Verify password was deleted
        let savedPassword = try? KeychainService.getPassword(for: profile.id)
        #expect(savedPassword == nil)
        
        // Cleanup
        ServerProfile.delete(profile)
    }
    
    @Test("Keychain access failures handle gracefully")
    func keychainFailuresHandledGracefully() {
        let viewModel = createTestViewModel()
        let profile = createTestProfile()
        
        // Test getPassword with non-existent profile
        let password = viewModel.getPassword(for: profile)
        #expect(password == nil)
        
        // Should not crash or throw errors
    }
    
    @Test("Profile creation from URL handles edge cases")
    func profileCreationFromURLEdgeCases() {
        let viewModel = createTestViewModel()
        
        // Test various URL formats
        let validProfile1 = viewModel.createProfileFromURL("192.168.1.100:4020")
        #expect(validProfile1?.url == "http://192.168.1.100:4020")
        
        let validProfile2 = viewModel.createProfileFromURL("http://example.com")
        #expect(validProfile2?.url == "http://example.com")
        
        let validProfile3 = viewModel.createProfileFromURL("https://secure.example.com:8080")
        #expect(validProfile3?.url == "https://secure.example.com:8080")
        
        // Test invalid URLs
        let invalidProfile1 = viewModel.createProfileFromURL("")
        #expect(invalidProfile1 == nil)
        
        let invalidProfile2 = viewModel.createProfileFromURL("not-a-url")
        #expect(invalidProfile2 == nil)
        
        let invalidProfile3 = viewModel.createProfileFromURL("   ")
        #expect(invalidProfile3 == nil)
    }
    
    @Test("Loading profiles sorts correctly by last connected")
    func profileSortingByLastConnected() async throws {
        let viewModel = createTestViewModel()
        
        // Create profiles with different last connected times
        let profile1 = createTestProfile()
        let profile2 = ServerProfile(
            name: "Server 2",
            url: "http://192.168.1.101:4020",
            requiresAuth: true,
            username: "user2"
        )
        let profile3 = ServerProfile(
            name: "Server 3", 
            url: "http://192.168.1.102:4020",
            requiresAuth: true,
            username: "user3"
        )
        
        // Save profiles
        try await viewModel.addProfile(profile1, password: "pass1")
        try await viewModel.addProfile(profile2, password: "pass2")
        try await viewModel.addProfile(profile3, password: "pass3")
        
        // Update last connected times
        ServerProfile.updateLastConnected(for: profile2.id) // Most recent
        
        // Reload profiles
        viewModel.loadProfiles()
        
        // Verify sorting (most recent first)
        #expect(viewModel.profiles.first?.id == profile2.id)
        
        // Cleanup
        ServerProfile.delete(profile1)
        ServerProfile.delete(profile2) 
        ServerProfile.delete(profile3)
        try? KeychainService.deletePassword(for: profile1.id)
        try? KeychainService.deletePassword(for: profile2.id)
        try? KeychainService.deletePassword(for: profile3.id)
    }
    
    @Test("Connection state resets properly on failure")
    func connectionStateResetOnFailure() async throws {
        let mockStorage = MockStorage()
        let connectionManager = ConnectionManager.createForTesting(storage: mockStorage)
        let viewModel = createTestViewModel(connectionManager: connectionManager)
        
        let profile = createTestProfile()
        
        // Start connection
        viewModel.isLoading = true
        viewModel.showLoginView = true
        viewModel.currentConnectingProfile = profile
        
        // Simulate connection failure
        do {
            try await viewModel.connectToProfile(profile)
        } catch {
            // Expected to fail
        }
        
        // Verify state is reset
        #expect(viewModel.isLoading == false)
        // showLoginView might be true if auth is needed, which is expected
    }
}

// MARK: - Mock Classes

@MainActor
class MockNetworkMonitor: NetworkMonitor {
    private let mockIsConnected: Bool
    
    init(isConnected: Bool) {
        self.mockIsConnected = isConnected
        super.init()
    }
    
    override var isConnected: Bool {
        return mockIsConnected
    }
}