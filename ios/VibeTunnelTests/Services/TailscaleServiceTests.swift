import Foundation
import Testing
@testable import VibeTunnel

@Suite("TailscaleService Tests", .tags(.networking))
struct TailscaleServiceTests {
    // MARK: - Credential Management Tests

    @Test("Save and load OAuth credentials")
    @MainActor
    func saveAndLoadCredentials() async {
        // Arrange
        let service = TailscaleService.shared
        service.clearCredentials()

        let testClientId = "k4cdcxxxxxxxx"
        let testClientSecret = "tskey-client-k4cdcSQfcc11CNTRL-xxxxxxxxxx"

        // Act - use legacy properties that map to new ones
        service.organization = testClientId // maps to clientId
        service.apiKey = testClientSecret // maps to clientSecret

        // Assert
        #expect(service.organization == testClientId)
        #expect(service.apiKey == testClientSecret)
        #expect(service.isConfigured == true)

        // Cleanup
        service.clearCredentials()
    }

    @Test("Clear credentials removes all data including tokens")
    @MainActor
    func testClearCredentials() async {
        // Arrange
        let service = TailscaleService.shared
        service.organization = "k4cdcxxxxxxxx" // clientId
        service.apiKey = "tskey-client-k4cdcSQfcc11CNTRL-xxx" // clientSecret

        // Act
        service.clearCredentials()

        // Assert
        #expect(service.organization == nil)
        #expect(service.apiKey == nil)
        #expect(service.isConfigured == false)
        #expect(service.isRunning == false)
        #expect(service.devices.isEmpty)
    }

    @Test("isConfigured requires both OAuth credentials")
    @MainActor
    func isConfiguredRequiresBothCredentials() {
        // Arrange
        let service = TailscaleService.shared
        service.clearCredentials()

        // Assert - No credentials
        #expect(service.isConfigured == false)

        // Act & Assert - Only client ID
        service.organization = "k4cdcxxxxxxxx"
        #expect(service.isConfigured == false)

        // Act & Assert - Both credentials
        service.apiKey = "tskey-client-k4cdcSQfcc11CNTRL-xxx"
        #expect(service.isConfigured == true)

        // Act & Assert - Only client secret
        service.organization = nil
        #expect(service.isConfigured == false)

        // Cleanup
        service.clearCredentials()
    }

    // MARK: - OAuth Client Credential Validation Tests

    @Test("Valid client credential formats")
    @MainActor
    func validClientCredentialFormats() async {
        // Arrange
        let service = TailscaleService.shared
        service.clearCredentials()

        service.organization = "k4cdcxxxxxxxx" // Valid client ID
        service.apiKey = "tskey-client-k4cdcSQfcc11CNTRL-xxx" // Valid client secret

        // Act
        await service.refreshStatus()

        // Assert - should attempt OAuth flow (credentials format is valid)
        // Note: This will fail to get a token in test, but formats are valid
        if let error = service.statusError {
            // Error should be about network/auth, not format
            #expect(!error.contains("Invalid Client ID format") && !error.contains("Invalid Client Secret format"))
        }

        // Cleanup
        service.clearCredentials()
    }

    @Test("Invalid client credential formats", arguments: [
        ("invalidclientid", "tskey-client-xxx"), // Bad client ID
        ("k4cdcxxxxxxxx", "invalid-secret"), // Bad client secret
        ("k4cdcxxxxxxxx", "tskey-api-xxx") // Wrong token type for secret
    ])
    @MainActor
    func invalidClientCredentialFormats(clientId: String, clientSecret: String) async {
        // Arrange
        let service = TailscaleService.shared
        service.clearCredentials()

        service.organization = clientId
        service.apiKey = clientSecret

        // Act
        await service.refreshStatus()

        // Assert
        #expect(service.isRunning == false)
        #expect(service.statusError != nil)
        // Check that the error is about invalid credential format
        if let error = service.statusError {
            #expect(error.contains("Invalid") || error.contains("format") || error.contains("must start with"))
        }

        // Cleanup
        service.clearCredentials()
    }

    @Test("Missing client ID shows error")
    @MainActor
    func missingClientIdError() async {
        // Arrange
        let service = TailscaleService.shared
        service.clearCredentials()

        service.organization = nil // Missing client ID
        service.apiKey = "tskey-client-k4cdcSQfcc11CNTRL-xxx"

        // Act
        await service.refreshStatus()

        // Assert
        #expect(service.isRunning == false)
        #expect(service.statusError != nil)
        #expect(service.statusError == "No credentials configured")

        // Cleanup
        service.clearCredentials()
    }

    // MARK: - Device Filtering Tests

    @Test("VibeTunnel server detection")
    @MainActor
    func isVibeTunnelServerDetection() {
        // Test macOS/Darwin detection
        let macDevice = TailscaleService.TailscaleDevice(
            id: "1",
            nodeId: "node1",
            name: "mac",
            hostname: "mac.ts.net",
            addresses: [],
            lastSeen: "2024-01-01T12:00:00Z",
            os: "macOS",
            tags: nil,
            authorized: true,
            isExternal: false,
            user: nil,
            created: nil,
            expires: nil,
            keyExpiryDisabled: nil,
            updateAvailable: nil,
            clientVersion: nil
        )
        #expect(macDevice.isVibeTunnelServer == true)

        // Test Darwin detection
        let darwinDevice = TailscaleService.TailscaleDevice(
            id: "2",
            nodeId: "node2",
            name: "darwin",
            hostname: "darwin.ts.net",
            addresses: [],
            lastSeen: "2024-01-01T12:00:00Z",
            os: "Darwin",
            tags: nil,
            authorized: true,
            isExternal: false,
            user: nil,
            created: nil,
            expires: nil,
            keyExpiryDisabled: nil,
            updateAvailable: nil,
            clientVersion: nil
        )
        #expect(darwinDevice.isVibeTunnelServer == true)

        // Test tag detection
        let taggedDevice = TailscaleService.TailscaleDevice(
            id: "3",
            nodeId: "node3",
            name: "linux",
            hostname: "linux.ts.net",
            addresses: [],
            lastSeen: "2024-01-01T12:00:00Z",
            os: "Linux",
            tags: ["vibetunnel"],
            authorized: true,
            isExternal: false,
            user: nil,
            created: nil,
            expires: nil,
            keyExpiryDisabled: nil,
            updateAvailable: nil,
            clientVersion: nil
        )
        #expect(taggedDevice.isVibeTunnelServer == true)

        // Test non-server device
        let iosDevice = TailscaleService.TailscaleDevice(
            id: "4",
            nodeId: "node4",
            name: "iphone",
            hostname: "iphone.ts.net",
            addresses: [],
            lastSeen: "2024-01-01T12:00:00Z",
            os: "iOS",
            tags: nil,
            authorized: true,
            isExternal: false,
            user: nil,
            created: nil,
            expires: nil,
            keyExpiryDisabled: nil,
            updateAvailable: nil,
            clientVersion: nil
        )
        #expect(iosDevice.isVibeTunnelServer == false)
    }

    @Test("Device online status based on lastSeen")
    @MainActor
    func isOnlineBasedOnLastSeen() {
        let formatter = ISO8601DateFormatter()

        // Device seen 1 minute ago - should be online
        let recentDevice = TailscaleService.TailscaleDevice(
            id: "1",
            nodeId: "node1",
            name: "recent",
            hostname: "recent.ts.net",
            addresses: [],
            lastSeen: formatter.string(from: Date().addingTimeInterval(-60)),
            os: "macOS",
            tags: nil,
            authorized: true,
            isExternal: false,
            user: nil,
            created: nil,
            expires: nil,
            keyExpiryDisabled: nil,
            updateAvailable: nil,
            clientVersion: nil
        )
        #expect(recentDevice.isOnline == true)

        // Device seen 10 minutes ago - should be offline
        let oldDevice = TailscaleService.TailscaleDevice(
            id: "2",
            nodeId: "node2",
            name: "old",
            hostname: "old.ts.net",
            addresses: [],
            lastSeen: formatter.string(from: Date().addingTimeInterval(-600)),
            os: "macOS",
            tags: nil,
            authorized: true,
            isExternal: false,
            user: nil,
            created: nil,
            expires: nil,
            keyExpiryDisabled: nil,
            updateAvailable: nil,
            clientVersion: nil
        )
        #expect(oldDevice.isOnline == false)

        // Device with no lastSeen - should be offline
        let noLastSeenDevice = TailscaleService.TailscaleDevice(
            id: "3",
            nodeId: "node3",
            name: "unknown",
            hostname: "unknown.ts.net",
            addresses: [],
            lastSeen: nil,
            os: "macOS",
            tags: nil,
            authorized: true,
            isExternal: false,
            user: nil,
            created: nil,
            expires: nil,
            keyExpiryDisabled: nil,
            updateAvailable: nil,
            clientVersion: nil
        )
        #expect(noLastSeenDevice.isOnline == false)
    }
}
