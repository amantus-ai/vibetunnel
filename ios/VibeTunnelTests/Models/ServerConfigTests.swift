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
            port: 8_888,
            name: nil,
            password: nil
        )

        // Act
        let url = config.baseURL

        // Assert
        #expect(url.absoluteString == "http://localhost:8888")
        #expect(url.scheme == "http")
        #expect(url.host == "localhost")
        #expect(url.port == 8_888)
    }

    @Test("Creates valid URL with different ports")
    func urlWithDifferentPorts() {
        // Arrange
        let config = ServerConfig(
            host: "example.com",
            port: 443,
            name: "user",
            password: "pass"
        )

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
            name: "My Server",
            password: nil
        )
        #expect(config.displayName == "My Server")
    }

    @Test("Handles standard ports correctly")
    func standardPorts() {
        // HTTP standard port (80)
        let httpConfig = ServerConfig(
            host: "example.com",
            port: 80,
        )
        #expect(httpConfig.baseURL.absoluteString == "http://example.com:80")

        // Another port
        let httpsConfig = ServerConfig(
            host: "example.com",
            port: 443,
        )
        #expect(httpsConfig.baseURL.absoluteString == "http://example.com:443")
    }

    @Test("Encodes and decodes correctly")
    func codable() throws {
        // Arrange
        let originalConfig = ServerConfig(
            host: "test.local",
            port: 9_999,
            name: "testuser",
            password: "testpass"
        )

        // Act
        let encoder = JSONEncoder()
        let data = try encoder.encode(originalConfig)

        let decoder = JSONDecoder()
        let decodedConfig = try decoder.decode(ServerConfig.self, from: data)

        // Assert
        #expect(decodedConfig.host == originalConfig.host)
        #expect(decodedConfig.port == originalConfig.port)
        #expect(decodedConfig.name == originalConfig.name)
        #expect(decodedConfig.password == originalConfig.password)
    }

    @Test("Optional credentials encoding")
    func optionalCredentials() throws {
        // Config without credentials
        let configNoAuth = ServerConfig(
            host: "public.server",
            port: 8_080,
        )

        let data = try JSONEncoder().encode(configNoAuth)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]

        #expect(json?["name"] == nil)
        #expect(json?["password"] == nil)
    }

    @Test("Equality comparison")
    func equality() {
        let config1 = ServerConfig(
            host: "localhost",
            port: 8_888,
        )

        let config2 = ServerConfig(
            host: "localhost",
            port: 8_888,
        )

        let config3 = ServerConfig(
            host: "localhost",
            port: 9_999, // Different port
        )

        #expect(config1 == config2)
        #expect(config1 != config3)
    }

    @Test("Handles IPv6 addresses")
    func iPv6Address() {
        let config = ServerConfig(
            host: "::1",
            port: 8_888,
        )

        let url = config.baseURL
        // IPv6 addresses need brackets in URLs
        #expect(url.absoluteString == "http://[::1]:8888" || url.absoluteString == "http://::1:8888")
        #expect(url.port == 8888)
    }

    @Test("Handles domain with subdomain")
    func subdomainHandling() {
        let config = ServerConfig(
            host: "api.staging.example.com",
            port: 443,
        )

        let url = config.baseURL
        #expect(url.absoluteString == "http://api.staging.example.com:443")
        #expect(url.host == "api.staging.example.com")
    }

    @Test("Display name formatting")
    func testDisplayName() {
        // Without custom name
        let simpleConfig = ServerConfig(
            host: "localhost",
            port: 8_888,
        )
        #expect(simpleConfig.displayName == "localhost:8888")

        // With custom name
        let namedConfig = ServerConfig(
            host: "secure.example.com",
            port: 443,
            name: "Production Server"
        )
        #expect(namedConfig.displayName == "Production Server")
    }

    @Test("JSON representation matches expected format")
    func jSONFormat() throws {
        // Arrange
        let config = ServerConfig(
            host: "test.server",
            port: 3_000,
            name: "user",
            password: "pass"
        )

        // Act
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        let data = try encoder.encode(config)
        let jsonString = String(data: data, encoding: .utf8)!

        // Assert
        #expect(jsonString.contains("\"host\":\"test.server\""))
        #expect(jsonString.contains("\"port\":3000"))
        #expect(jsonString.contains("\"name\":\"user\""))
        #expect(jsonString.contains("\"password\":\"pass\""))
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
