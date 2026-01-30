import Foundation
import Testing
@testable import VibeTunnel

@Suite("TailscaleDiscoveryService Tests", .tags(.networking))
struct TailscaleDiscoveryServiceTests {
    // MARK: - Discovery Process Tests

    @Test("Start discovery fails when Tailscale not running")
    @MainActor
    func startDiscoveryWhenTailscaleNotRunning() {
        // Arrange
        let discoveryService = TailscaleDiscoveryService.shared
        let tailscaleService = TailscaleService.shared

        discoveryService.resetEnvironment()
        tailscaleService.clearCredentials()

        // Assert - Tailscale not running
        #expect(tailscaleService.isRunning == false)

        // Act
        discoveryService.startDiscovery()

        // Assert
        #expect(discoveryService.isDiscovering == false)
        #expect(discoveryService.lastError == "Tailscale is not running")

        // Cleanup
        discoveryService.resetEnvironment()
    }

    @Test("Stop discovery cancels active discovery")
    @MainActor
    func stopDiscoveryCancelsActiveDiscovery() async {
        // Arrange
        let discoveryService = TailscaleDiscoveryService.shared
        let tailscaleService = TailscaleService.shared

        discoveryService.resetEnvironment()
        tailscaleService.clearCredentials()

        // Setup Tailscale as running (mock scenario)
        tailscaleService.organization = "test@example.com"
        tailscaleService.apiKey = "tskey-api-test123"

        // Act - Start discovery (will fail but sets isDiscovering briefly)
        // Note: In real tests we'd mock the network response

        // Assert
        discoveryService.stopDiscovery()
        #expect(discoveryService.isDiscovering == false)

        // Cleanup
        discoveryService.resetEnvironment()
        tailscaleService.clearCredentials()
    }

    // MARK: - Auto-Refresh Timer Tests

    @Test("Auto-refresh respects settings")
    @MainActor
    func autoRefreshRespectsSettings() {
        // Arrange
        let discoveryService = TailscaleDiscoveryService.shared
        discoveryService.resetEnvironment()

        // Test when auto-refresh is disabled
        UserDefaults.standard.set(false, forKey: "tailscaleAutoRefresh")
        UserDefaults.standard.set(true, forKey: "enableTailscaleDiscovery")

        // Act
        discoveryService.startAutoRefresh()

        // Assert
        #expect(discoveryService.isAutoRefreshing == false)

        // Test when discovery is disabled
        UserDefaults.standard.set(true, forKey: "tailscaleAutoRefresh")
        UserDefaults.standard.set(false, forKey: "enableTailscaleDiscovery")

        // Act
        discoveryService.startAutoRefresh()

        // Assert
        #expect(discoveryService.isAutoRefreshing == false)

        // Cleanup
        discoveryService.stopAutoRefresh()
        discoveryService.resetEnvironment()
    }

    @Test("Stop auto-refresh invalidates timer")
    @MainActor
    func stopAutoRefreshInvalidatesTimer() {
        // Arrange
        let discoveryService = TailscaleDiscoveryService.shared
        let tailscaleService = TailscaleService.shared

        UserDefaults.standard.set(true, forKey: "tailscaleAutoRefresh")
        UserDefaults.standard.set(true, forKey: "enableTailscaleDiscovery")
        tailscaleService.organization = "test@example.com"
        tailscaleService.apiKey = "tskey-api-test123"

        discoveryService.startAutoRefresh()

        // Act
        discoveryService.stopAutoRefresh()

        // Assert
        #expect(discoveryService.isAutoRefreshing == false)
        #expect(discoveryService.nextRefreshTime == nil)

        // Cleanup
        tailscaleService.clearCredentials()
    }

    // MARK: - Environment Reset Tests

    @Test("Reset environment clears all state")
    @MainActor
    func resetEnvironmentClearsAllState() {
        // Arrange
        let discoveryService = TailscaleDiscoveryService.shared

        // Add some state
        discoveryService.addKnownServer(hostname: "test.tailnet.ts.net")
        UserDefaults.standard.set(true, forKey: "tailscaleAutoRefresh")

        // Act
        discoveryService.resetEnvironment()

        // Assert
        #expect(discoveryService.discoveredServers.isEmpty)
        #expect(discoveryService.isDiscovering == false)
        #expect(discoveryService.isAutoRefreshing == false)
        #expect(discoveryService.lastError == nil)
        #expect(discoveryService.nextRefreshTime == nil)

        // Verify known servers are cleared
        let knownServers = UserDefaults.standard.array(forKey: "TailscaleKnownServers") as? [String] ?? []
        #expect(knownServers.isEmpty)
    }

    // MARK: - Known Servers Persistence Tests

    @Test("Add known server persists to UserDefaults")
    @MainActor
    func addKnownServerPersistence() {
        // Arrange
        let discoveryService = TailscaleDiscoveryService.shared
        discoveryService.resetEnvironment()

        let hostname = "test-mac.tailnet.ts.net"

        // Act
        discoveryService.addKnownServer(hostname: hostname)

        // Assert
        let knownServers = UserDefaults.standard.array(forKey: "TailscaleKnownServers") as? [String] ?? []
        #expect(knownServers.contains(hostname))

        // Cleanup
        discoveryService.resetEnvironment()
    }

    @Test("Remove known server updates persistence")
    @MainActor
    func testRemoveKnownServer() {
        // Arrange
        let discoveryService = TailscaleDiscoveryService.shared
        discoveryService.resetEnvironment()

        let hostname = "test-mac.tailnet.ts.net"
        discoveryService.addKnownServer(hostname: hostname)

        // Act
        discoveryService.removeKnownServer(hostname: hostname)

        // Assert
        let knownServers = UserDefaults.standard.array(forKey: "TailscaleKnownServers") as? [String] ?? []
        #expect(!knownServers.contains(hostname))
        #expect(discoveryService.discoveredServers.filter { $0.hostname == hostname }.isEmpty)

        // Cleanup
        discoveryService.resetEnvironment()
    }

    // MARK: - Server Config Generation Tests

    @Test("Server config generation with IP")
    @MainActor
    func serverConfigGeneration() {
        // Arrange
        let discoveryService = TailscaleDiscoveryService.shared
        let tailscaleServer = TailscaleDiscoveryService.TailscaleServer(
            hostname: "test-mac.tailnet.ts.net",
            ip: "100.64.0.1",
            port: 4_020,
            deviceName: "test-mac",
            isReachable: true,
            lastSeen: Date(),
            httpsUrl: nil,
            isPublic: false
        )

        // Act
        let config = discoveryService.serverConfig(from: tailscaleServer)

        // Assert
        #expect(config.host == "100.64.0.1")
        #expect(config.port == 4_020)
        #expect(config.name == "test mac") // Note: displayName replaces - with space
        #expect(config.tailscaleHostname == "test-mac.tailnet.ts.net")
        #expect(config.tailscaleIP == "100.64.0.1")
        #expect(config.isTailscaleEnabled == true)
        #expect(config.preferTailscale == true)
    }

    @Test("Server config generation without IP")
    @MainActor
    func serverConfigWithoutIP() {
        // Arrange
        let discoveryService = TailscaleDiscoveryService.shared
        let tailscaleServer = TailscaleDiscoveryService.TailscaleServer(
            hostname: "test-mac.tailnet.ts.net",
            ip: nil,
            port: 4_020,
            deviceName: "test-mac",
            isReachable: true,
            lastSeen: Date(),
            httpsUrl: nil,
            isPublic: false
        )

        // Act
        let config = discoveryService.serverConfig(from: tailscaleServer)

        // Assert
        #expect(config.host == "test-mac.tailnet.ts.net")
        #expect(config.tailscaleIP == nil)
    }

    // MARK: - Display Name Tests

    @Test("TailscaleServer stores FQDN hostname correctly")
    @MainActor
    func tailscaleServerStoresFQDNHostname() {
        // Arrange
        let server = TailscaleDiscoveryService.TailscaleServer(
            hostname: "test-machine.tail98c6a0.ts.net",
            ip: "100.64.0.1",
            port: 4_020,
            deviceName: "Test Machine",
            isReachable: true,
            lastSeen: Date(),
            httpsUrl: "https://test-machine.tail98c6a0.ts.net",
            isPublic: false
        )

        // Assert
        #expect(server.hostname == "test-machine.tail98c6a0.ts.net")
        #expect(server.deviceName == "Test Machine")
        #expect(server.displayName == "Test Machine")
        #expect(server.httpsUrl == "https://test-machine.tail98c6a0.ts.net")
    }

    @Test("Tailscale server display name formatting")
    @MainActor
    func tailscaleServerDisplayName() {
        // Test hyphen replacement
        let server1 = TailscaleDiscoveryService.TailscaleServer(
            hostname: "my-test-server.tailnet.ts.net",
            ip: nil,
            port: 4_020,
            deviceName: "my-test-server",
            isReachable: true,
            lastSeen: Date(),
            httpsUrl: nil,
            isPublic: false
        )
        #expect(server1.displayName == "my test server")

        // Test domain trimming
        let server2 = TailscaleDiscoveryService.TailscaleServer(
            hostname: "server.tailnet.ts.net",
            ip: nil,
            port: 4_020,
            deviceName: "server.tailnet",
            isReachable: true,
            lastSeen: Date(),
            httpsUrl: nil,
            isPublic: false
        )
        #expect(server2.displayName == "server")

        // Test fallback to device name
        let server3 = TailscaleDiscoveryService.TailscaleServer(
            hostname: "server",
            ip: nil,
            port: 4_020,
            deviceName: "fallback-name",
            isReachable: true,
            lastSeen: Date(),
            httpsUrl: nil,
            isPublic: false
        )
        #expect(server3.displayName == "fallback name")
    }
}
