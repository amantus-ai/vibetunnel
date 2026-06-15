import Foundation
import Testing
@testable import VibeTunnel

@Suite("Pangolin Service Tests", .tags(.networking))
struct PangolinServiceTests {
    @Test
    @MainActor
    func singletonInstance() {
        #expect(PangolinService.shared === PangolinService.shared)
    }

    @Test
    @MainActor
    func searchPathsCoverCommonInstallLocations() {
        #expect(PangolinService.newtSearchPaths.contains("/opt/homebrew/bin/newt"))
        #expect(PangolinService.newtSearchPaths.contains("/usr/local/bin/newt"))
        #expect(PangolinService.newtSearchPaths.contains("/etc/profiles/per-user/\(NSUserName())/bin/newt"))
    }

    @Test
    func normalizesCredentials() throws {
        let credentials = try #require(PangolinService.normalizeCredentials(
            endpoint: " https://app.pangolin.net/ ",
            siteID: " site-id ",
            secret: " site-secret "))

        #expect(credentials == PangolinCredentials(
            endpoint: "https://app.pangolin.net",
            siteID: "site-id",
            secret: "site-secret"))
    }

    @Test
    func rejectsInvalidCredentials() {
        #expect(PangolinService.normalizeCredentials(
            endpoint: "javascript:alert(1)",
            siteID: "site-id",
            secret: "secret") == nil)
        #expect(PangolinService.normalizeCredentials(
            endpoint: "https://app.pangolin.net",
            siteID: "",
            secret: "secret") == nil)
    }

    @Test
    func createsProtectedTemporaryConfig() throws {
        let credentials = PangolinCredentials(
            endpoint: "https://app.pangolin.net",
            siteID: "site-id",
            secret: "site-secret")
        let configURL = try PangolinService.createTemporaryConfig(credentials: credentials)
        defer { try? FileManager.default.removeItem(at: configURL.deletingLastPathComponent()) }

        let attributes = try FileManager.default.attributesOfItem(atPath: configURL.path)
        #expect(attributes[.posixPermissions] as? Int == 0o600)
        let directoryAttributes = try FileManager.default.attributesOfItem(
            atPath: configURL.deletingLastPathComponent().path)
        #expect(directoryAttributes[.posixPermissions] as? Int == 0o700)

        let data = try Data(contentsOf: configURL)
        let config = try #require(JSONSerialization.jsonObject(with: data) as? [String: String])
        #expect(config["endpoint"] == credentials.endpoint)
        #expect(config["id"] == credentials.siteID)
        #expect(config["secret"] == credentials.secret)

        let arguments = PangolinService.startArguments(configPath: configURL.path)
        #expect(arguments == ["--config-file", configURL.path])
        #expect(!arguments.contains(credentials.siteID))
        #expect(!arguments.contains(credentials.secret))
    }

    @Test
    func tracksLatestConnectionEvent() {
        #expect(PangolinService.connectionState(from: "Websocket connected") == nil)
        #expect(PangolinService.connectionState(
            from: "Failed to connect: unauthorized. Retrying") == false)
        #expect(PangolinService.connectionState(
            from: "Failed to connect:\nTunnel connection to server established successfully!") == true)
        #expect(PangolinService.connectionState(
            from: "Tunnel connection to server established successfully!\nFailed to connect: timeout") == false)
        #expect(PangolinService.connectionState(
            from: "Tunnel connection to server established successfully!\nConnection to server lost after 5 failures") ==
            false)
        #expect(PangolinService.connectionState(
            from: "Connection to server lost after 5 failures\nConnection to server restored after 7 failures!") ==
            true)
    }

    @Test
    func errorDescriptions() {
        let errors: [PangolinError] = [
            .notInstalled,
            .credentialsMissing,
            .alreadyRunning,
            .connectionFailed("test"),
        ]
        for error in errors {
            #expect(error.errorDescription?.isEmpty == false)
        }
    }
}
