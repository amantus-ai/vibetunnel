import Foundation
import Testing
@testable import VibeTunnel

@Suite("ServerProfile Tests", .tags(.models))
struct ServerProfileTests {
    @Test("Creates ServerConfig with correct Tailscale properties")
    func toServerConfigWithTailscaleProperties() {
        // Arrange
        let profile = ServerProfile(
            id: UUID(),
            name: "Test Server",
            url: "https://test-machine.tail98c6a0.ts.net",
            host: "100.64.0.1",
            port: 4_020,
            tailscaleHostname: "test-machine.tail98c6a0.ts.net",
            tailscaleIP: "100.64.0.1",
            isTailscaleEnabled: true,
            preferTailscale: true,
            httpsAvailable: true,
            isPublic: false,
            preferSSL: true
        )

        // Act
        let config = profile.toServerConfig()

        // Assert
        #expect(config != nil)
        guard let config else { return }

        #expect(config.host == "test-machine.tail98c6a0.ts.net")
        #expect(config.port == 443) // HTTPS URL should extract port 443
        #expect(config.tailscaleHostname == "test-machine.tail98c6a0.ts.net")
        #expect(config.tailscaleIP == "100.64.0.1")
        #expect(config.isTailscaleEnabled == true)
        #expect(config.preferTailscale == true)
        #expect(config.httpsAvailable == true)
        #expect(config.isPublic == false)
        #expect(config.preferSSL == true)

        // Connection URL should use HTTPS
        let connectionUrl = config.connectionURL()
        #expect(connectionUrl.scheme == "https")
        #expect(connectionUrl.host == "test-machine.tail98c6a0.ts.net")
    }

    @Test("Creates ServerConfig from HTTP URL")
    func toServerConfigFromHTTPURL() {
        // Arrange
        let profile = ServerProfile(
            id: UUID(),
            name: "Local Server",
            url: "http://localhost:4020"
        )

        // Act
        let config = profile.toServerConfig()

        // Assert
        #expect(config != nil)
        guard let config else { return }

        #expect(config.host == "localhost")
        #expect(config.port == 4_020)
        #expect(config.isTailscaleEnabled == false)
        #expect(config.httpsAvailable == false)

        // Connection URL should use HTTP
        let connectionUrl = config.connectionURL()
        #expect(connectionUrl.scheme == "http")
        #expect(connectionUrl.host == "localhost")
        #expect(connectionUrl.port == 4_020)
    }

    @Test("Handles IPv6 addresses correctly")
    func toServerConfigWithIPv6() {
        // Arrange
        let profile = ServerProfile(
            id: UUID(),
            name: "IPv6 Server",
            url: "http://[::1]:8080"
        )

        // Act
        let config = profile.toServerConfig()

        // Assert
        #expect(config != nil)
        guard let config else { return }

        #expect(config.host == "::1") // Brackets should be removed
        #expect(config.port == 8_080)
    }

    @Test("ServerProfile storage and retrieval")
    func storageAndRetrieval() {
        // Arrange
        let testDefaults = UserDefaults(suiteName: "test.serverprofile")!
        testDefaults.removePersistentDomain(forName: "test.serverprofile")

        let profile1 = ServerProfile(
            name: "Server 1",
            url: "http://localhost:4020"
        )
        let profile2 = ServerProfile(
            name: "Server 2",
            url: "https://test.example.com"
        )

        // Act - Save profiles
        ServerProfile.save(profile1, to: testDefaults)
        ServerProfile.save(profile2, to: testDefaults)

        // Assert - Load profiles
        let loadedProfiles = ServerProfile.loadAll(from: testDefaults)
        #expect(loadedProfiles.count == 2)
        #expect(loadedProfiles.contains { $0.name == "Server 1" })
        #expect(loadedProfiles.contains { $0.name == "Server 2" })

        // Act - Delete profile
        ServerProfile.delete(profile1, from: testDefaults)

        // Assert - Profile deleted
        let remainingProfiles = ServerProfile.loadAll(from: testDefaults)
        #expect(remainingProfiles.count == 1)
        #expect(remainingProfiles.first?.name == "Server 2")

        // Cleanup
        testDefaults.removePersistentDomain(forName: "test.serverprofile")
    }

    @Test("Updates last connected time")
    func updateLastConnectedTime() {
        // Arrange
        let testDefaults = UserDefaults(suiteName: "test.serverprofile.time")!
        testDefaults.removePersistentDomain(forName: "test.serverprofile.time")

        let profile = ServerProfile(
            name: "Test Server",
            url: "http://localhost:4020"
        )
        ServerProfile.save(profile, to: testDefaults)

        // Act
        ServerProfile.updateLastConnected(for: profile.id, in: testDefaults)

        // Assert
        let updatedProfiles = ServerProfile.loadAll(from: testDefaults)
        #expect(updatedProfiles.count == 1)
        #expect(updatedProfiles.first?.lastConnected != nil)

        // Cleanup
        testDefaults.removePersistentDomain(forName: "test.serverprofile.time")
    }
}
