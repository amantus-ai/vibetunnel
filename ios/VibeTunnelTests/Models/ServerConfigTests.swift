import Foundation
import Testing
@testable import VibeTunnel

@Suite("ServerConfig Tests", .tags(.models))
struct ServerConfigTests {
    @Test("Creates valid HTTP URL")
    func hTTPURLCreation() {
        // Arrange
        let config = ServerConfig(
            host: "localhost",
            port: 8888,
            name: nil)

        // Act
        let url = config.baseURL

        // Assert
        #expect(url.absoluteString == "http://localhost:8888")
        #expect(url.scheme == "http")
        #expect(url.host == "localhost")
        #expect(url.port == 8888)
    }

    @Test("Creates valid URL with different ports")
    func urlWithDifferentPorts() {
        // Arrange
        let config = ServerConfig(
            host: "example.com",
            port: 443,
            name: "user")

        // Act
        let url = config.baseURL

        // Assert - baseURL always uses http://
        #expect(url.absoluteString == "http://example.com:443")
        #expect(url.scheme == "http")
        #expect(url.host == "example.com")
        #expect(url.port == 443)
    }

    @Test("Display name uses custom name if provided")
    func displayNameWithCustomName() {
        let config = ServerConfig(
            host: "localhost",
            port: 8888,
            name: "My Server")
        #expect(config.displayName == "My Server")
    }

    @Test("Handles standard ports correctly")
    func standardPorts() {
        // HTTP standard port (80)
        let httpConfig = ServerConfig(
            host: "example.com",
            port: 80)
        #expect(httpConfig.baseURL.absoluteString == "http://example.com:80")

        // Another port
        let httpsConfig = ServerConfig(
            host: "example.com",
            port: 443)
        #expect(httpsConfig.baseURL.absoluteString == "http://example.com:443")
    }

    @Test("Encodes and decodes correctly")
    func codable() throws {
        // Arrange
        let originalConfig = ServerConfig(
            host: "test.local",
            port: 9999,
            name: "testuser")

        // Act
        let encoder = JSONEncoder()
        let data = try encoder.encode(originalConfig)

        let decoder = JSONDecoder()
        let decodedConfig = try decoder.decode(ServerConfig.self, from: data)

        // Assert
        #expect(decodedConfig.host == originalConfig.host)
        #expect(decodedConfig.port == originalConfig.port)
        #expect(decodedConfig.name == originalConfig.name)
    }

    @Test("Optional credentials encoding")
    func optionalCredentials() throws {
        // Config without credentials
        let configNoAuth = ServerConfig(
            host: "public.server",
            port: 8080)

        let data = try JSONEncoder().encode(configNoAuth)
        let decoded = try JSONDecoder().decode(ServerConfig.self, from: data)

        #expect(decoded.name == nil)
    }

    @Test("Equality comparison")
    func equality() {
        let config1 = ServerConfig(
            host: "localhost",
            port: 8888)

        let config2 = ServerConfig(
            host: "localhost",
            port: 8888)

        let config3 = ServerConfig(
            host: "localhost",
            port: 9999, // Different port
        )

        #expect(config1 == config2)
        #expect(config1 != config3)
    }

    @Test("Handles IPv6 addresses")
    func iPv6Address() {
        // Basic IPv6 loopback
        let loopback = ServerConfig(host: "::1", port: 8888)
        #expect(loopback.baseURL.absoluteString == "http://[::1]:8888")
        #expect(loopback.baseURL.port == 8888)

        // Full IPv6
        let fullIPv6 = ServerConfig(host: "2001:0db8:85a3:0000:0000:8a2e:0370:7334", port: 8080)
        #expect(fullIPv6.baseURL.absoluteString == "http://[2001:0db8:85a3:0000:0000:8a2e:0370:7334]:8080")

        // Compressed IPv6
        let compressedIPv6 = ServerConfig(host: "2001:db8::8a2e:370:7334", port: 8080)
        #expect(compressedIPv6.baseURL.absoluteString == "http://[2001:db8::8a2e:370:7334]:8080")

        // IPv4-mapped IPv6
        let mappedIPv6 = ServerConfig(host: "::ffff:192.0.2.1", port: 8080)
        #expect(mappedIPv6.baseURL.absoluteString == "http://[::ffff:192.0.2.1]:8080")
    }

    // Temporarily disabled - zone ID handling varies between environments
    // @Test("IPv6 with zone identifiers")
    // func iPv6WithZoneId() {
    //     // Link-local with zone ID - note: URL handling of % might vary
    //     let linkLocal = ServerConfig(host: "fe80::1%en0", port: 8080)
    //     // The URL might encode the % or handle it differently
    //     let urlString = linkLocal.baseURL.absoluteString
    //     #expect(urlString == "http://[fe80::1%en0]:8080" || urlString == "http://[fe80::1%25en0]:8080")
    // }

    @Test("Non-IPv6 addresses should not be bracketed")
    func nonIPv6Addresses() {
        // Regular hostname
        let hostname = ServerConfig(host: "example.com", port: 8080)
        #expect(hostname.baseURL.absoluteString == "http://example.com:8080")

        // IPv4 address
        let ipv4 = ServerConfig(host: "192.168.1.1", port: 8080)
        #expect(ipv4.baseURL.absoluteString == "http://192.168.1.1:8080")

        // Localhost
        let localhost = ServerConfig(host: "localhost", port: 8080)
        #expect(localhost.baseURL.absoluteString == "http://localhost:8080")

        // Hostname with dashes
        let dashedHost = ServerConfig(host: "my-server-host", port: 8080)
        #expect(dashedHost.baseURL.absoluteString == "http://my-server-host:8080")
    }

    @Test("Handles edge cases correctly")
    func edgeCases() {
        // Already bracketed IPv6
        let bracketedIPv6 = ServerConfig(host: "[::1]", port: 8080)
        #expect(bracketedIPv6.baseURL.absoluteString == "http://[::1]:8080")

        // IPv4 address (should not be bracketed)
        let ipv4 = ServerConfig(host: "192.168.1.1", port: 8080)
        #expect(ipv4.baseURL.absoluteString == "http://192.168.1.1:8080")

        // Regular hostname
        let hostname = ServerConfig(host: "example.com", port: 8080)
        #expect(hostname.baseURL.absoluteString == "http://example.com:8080")

        // Localhost
        let localhost = ServerConfig(host: "localhost", port: 8080)
        #expect(localhost.baseURL.absoluteString == "http://localhost:8080")
    }

    @Test("Handles domain with subdomain")
    func subdomainHandling() {
        let config = ServerConfig(
            host: "api.staging.example.com",
            port: 443)

        let url = config.baseURL
        #expect(url.absoluteString == "http://api.staging.example.com:443")
        #expect(url.host == "api.staging.example.com")
    }

    @Test("Display name formatting")
    func testDisplayName() {
        // Without custom name
        let simpleConfig = ServerConfig(
            host: "localhost",
            port: 8888)
        #expect(simpleConfig.displayName == "localhost:8888")

        // With custom name
        let namedConfig = ServerConfig(
            host: "secure.example.com",
            port: 443,
            name: "Production Server")
        #expect(namedConfig.displayName == "Production Server")
    }

    @Test("JSON representation matches expected format")
    func jSONFormat() throws {
        // Arrange
        let config = ServerConfig(
            host: "test.server",
            port: 3000,
            name: "user")

        // Act
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        let data = try encoder.encode(config)
        let jsonString = String(data: data, encoding: .utf8)!

        // Assert
        #expect(jsonString.contains("\"host\":\"test.server\""))
        #expect(jsonString.contains("\"port\":3000"))
        #expect(jsonString.contains("\"name\":\"user\""))
    }

    @Test("Tailscale HTTPS URL generation")
    func tailscaleHTTPSURL() {
        // Config with Tailscale HTTPS available
        let httpsConfig = ServerConfig(
            host: "10.0.0.1",
            port: 4_020,
            name: "VibeTunnel Server",
            tailscaleHostname: "my-machine.tailnet.ts.net",
            tailscaleIP: "100.64.0.1",
            isTailscaleEnabled: true,
            preferTailscale: true,
            httpsAvailable: true,
            isPublic: false,
            preferSSL: true
        )

        // Should use HTTPS URL when available and preferred
        let connectionUrl = httpsConfig.connectionURL()
        #expect(connectionUrl.absoluteString == "https://my-machine.tailnet.ts.net")
        #expect(connectionUrl.scheme == "https")
        #expect(connectionUrl.port == nil) // Port 443 is implicit

        // Should fall back to HTTP when SSL not preferred
        var httpConfig = httpsConfig
        httpConfig.preferSSL = false
        let httpUrl = httpConfig.connectionURL()
        #expect(httpUrl.absoluteString == "http://100.64.0.1:4020")
    }

    @Test("Tailscale connection type detection")
    func tailscaleConnectionTypes() {
        // Local only
        let localConfig = ServerConfig(
            host: "localhost",
            port: 4_020
        )
        #expect(localConfig.availableConnectionTypes == .local)

        // Tailscale only
        let tailscaleOnlyConfig = ServerConfig(
            host: "100.64.0.1",
            port: 4_020,
            tailscaleHostname: "machine.ts.net"
        )
        #expect(tailscaleOnlyConfig.availableConnectionTypes == .tailscale)

        // Both local and Tailscale
        let bothConfig = ServerConfig(
            host: "localhost",
            port: 4_020,
            tailscaleHostname: "machine.ts.net",
            isTailscaleEnabled: true
        )
        #expect(bothConfig.availableConnectionTypes == .both)
    }

    @Test("API URL uses connection URL instead of base URL")
    func apiURLUsesConnectionURL() {
        // Config with HTTPS available should use HTTPS for API calls
        let httpsConfig = ServerConfig(
            host: "100.64.0.1",
            port: 4_020,
            name: "Test Server",
            tailscaleHostname: "test-machine.tailnet.ts.net",
            tailscaleIP: "100.64.0.1",
            isTailscaleEnabled: true,
            preferTailscale: true,
            httpsAvailable: true,
            isPublic: false,
            preferSSL: true
        )

        // API URL should use HTTPS when available
        let apiUrl = httpsConfig.apiURL(path: "/api/sessions")
        #expect(apiUrl.absoluteString == "https://test-machine.tailnet.ts.net/api/sessions")
        #expect(apiUrl.scheme == "https")

        // Config without HTTPS should use HTTP
        let httpConfig = ServerConfig(
            host: "localhost",
            port: 4_020,
            name: "Local Server"
        )

        let httpApiUrl = httpConfig.apiURL(path: "/api/sessions")
        #expect(httpApiUrl.absoluteString == "http://localhost:4020/api/sessions")
        #expect(httpApiUrl.scheme == "http")
    }

    @Test("Display name with connection indicators")
    func displayNameWithConnectionIndicators() {
        // HTTPS/SSL connection
        let httpsConfig = ServerConfig(
            host: "localhost",
            port: 4_020,
            name: "My Server",
            httpsAvailable: true,
            preferSSL: true
        )
        #expect(httpsConfig.displayNameWithConnectionType.contains("🔒"))

        // Public (Funnel) connection
        let publicConfig = ServerConfig(
            host: "localhost",
            port: 4_020,
            name: "My Server",
            isPublic: true
        )
        #expect(publicConfig.displayNameWithConnectionType.contains("🌐"))

        // Tailscale without HTTPS
        let tailscaleConfig = ServerConfig(
            host: "100.64.0.1",
            port: 4_020,
            name: "My Server",
            isTailscaleEnabled: true
        )
        #expect(tailscaleConfig.displayNameWithConnectionType.contains("🔗"))

        // All indicators
        let allIndicatorsConfig = ServerConfig(
            host: "100.64.0.1",
            port: 4_020,
            name: "My Server",
            isTailscaleEnabled: true,
            httpsAvailable: true,
            isPublic: true,
            preferSSL: true
        )
        let displayName = allIndicatorsConfig.displayNameWithConnectionType
        #expect(displayName.contains("🔒"))
        #expect(displayName.contains("🌐"))
        #expect(!displayName.contains("🔗")) // Tailscale indicator hidden when HTTPS is used
    }
}

// MARK: - Integration Tests

@Suite("ServerConfig Integration Tests", .tags(.models, .integration))
struct ServerConfigIntegrationTests {
    @Test("Round-trip through UserDefaults")
    func userDefaultsPersistence() throws {
        // Arrange
        let config = TestFixtures.sslServerConfig
        let key = "test_server_config"

        // Clear any existing value
        UserDefaults.standard.removeObject(forKey: key)

        // Act - Save
        let encoder = JSONEncoder()
        let data = try encoder.encode(config)
        UserDefaults.standard.set(data, forKey: key)

        // Act - Load
        guard let loadedData = UserDefaults.standard.data(forKey: key) else {
            Issue.record("Failed to load data from UserDefaults")
            return
        }

        let decoder = JSONDecoder()
        let loadedConfig = try decoder.decode(ServerConfig.self, from: loadedData)

        // Assert
        #expect(loadedConfig == config)

        // Cleanup
        UserDefaults.standard.removeObject(forKey: key)
    }
}
