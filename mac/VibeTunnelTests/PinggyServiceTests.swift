import Foundation
import Testing
@testable import VibeTunnel

@Suite("Pinggy Service Tests", .tags(.networking))
struct PinggyServiceTests {
    @Test
    @MainActor
    func singletonInstance() {
        #expect(PinggyService.shared === PinggyService.shared)
    }

    @Test
    @MainActor
    func searchPathsCoverCommonInstallLocations() {
        #expect(PinggyService.pinggySearchPaths.contains("/opt/homebrew/bin/pinggy"))
        #expect(PinggyService.pinggySearchPaths.contains("/usr/local/bin/pinggy"))
        #expect(PinggyService.pinggySearchPaths.contains("/etc/profiles/per-user/\(NSUserName())/bin/pinggy"))
    }

    @Test
    func startArgumentsWithoutToken() {
        #expect(PinggyService.startArguments(port: 4020, configPath: nil) == [
            "--noTui",
            "-l",
            "http://localhost:4020",
        ])
    }

    @Test
    func startArgumentsWithTokenConfig() {
        #expect(PinggyService.startArguments(port: 4021, configPath: "/tmp/token.json") == [
            "--noTui",
            "-l",
            "http://localhost:4021",
            "--conf",
            "/tmp/token.json",
        ])
    }

    @Test
    func createsProtectedTemporaryTokenConfig() throws {
        let createdConfigURL = try PinggyService.createTemporaryTokenConfig(token: " token123 ")
        let configURL = try #require(createdConfigURL)
        defer { try? FileManager.default.removeItem(at: configURL) }

        let attributes = try FileManager.default.attributesOfItem(atPath: configURL.path)
        #expect(attributes[.posixPermissions] as? Int == 0o600)

        let data = try Data(contentsOf: configURL)
        let config = try #require(JSONSerialization.jsonObject(with: data) as? [String: String])
        #expect(config == ["token": "token123"])

        let arguments = PinggyService.startArguments(port: 4020, configPath: configURL.path)
        #expect(!arguments.contains("token123"))
    }

    @Test
    func extractsPinggyAndCustomPublicURLs() {
        #expect(PinggyService.extractPublicURL(from: "  https://demo.a.pinggy.link\n") ==
            "https://demo.a.pinggy.link")
        #expect(PinggyService.extractPublicURL(from: "Remote URLs: https://terminal.example.com") ==
            "https://terminal.example.com")
    }

    @Test
    func ignoresControlAndDocumentationURLs() {
        #expect(PinggyService.extractPublicURL(from: "Visit https://dashboard.pinggy.io") == nil)
        #expect(PinggyService.extractPublicURL(from: "Server https://pro.pinggy.io") == nil)
        #expect(PinggyService.extractPublicURL(from: "No public URL yet") == nil)
    }

    @Test
    func errorDescriptions() {
        let errors: [PinggyError] = [
            .notInstalled,
            .tunnelAlreadyRunning,
            .tunnelCreationFailed("test"),
        ]
        for error in errors {
            #expect(error.errorDescription?.isEmpty == false)
        }
    }
}
