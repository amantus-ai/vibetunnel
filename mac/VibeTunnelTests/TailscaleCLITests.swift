import Foundation
import Testing
@testable import VibeTunnel

@Suite("Tailscale CLI Tests", .tags(.networking))
struct TailscaleCLITests {
    @Test
    func searchPathsIncludeNixDarwinLocations() {
        #expect(TailscaleCLI.searchPaths.contains("/run/current-system/sw/bin/tailscale"))
        #expect(TailscaleCLI.searchPaths.contains("/etc/profiles/per-user/\(NSUserName())/bin/tailscale"))
    }

    @Test
    func findsExecutableFromPath() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("tailscale-cli-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let executable = directory.appendingPathComponent("tailscale")
        try Data("#!/bin/sh\n".utf8).write(to: executable)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)

        #expect(TailscaleCLI.findExecutable(
            searchPaths: [],
            environment: [EnvironmentKeys.path: directory.path]) == executable.path)
    }

    @Test
    func parsesRunningDaemonStatus() throws {
        let data = Data(
            """
            {
              "BackendState": "Running",
              "TailscaleIPs": ["100.64.12.34", "fd7a:115c:a1e0::1"],
              "Self": {
                "DNSName": "nix-mac.example.ts.net.",
                "TailscaleIPs": ["100.64.12.34"]
              }
            }
            """.utf8)

        #expect(try TailscaleCLI.parseStatus(data) == .init(
            isRunning: true,
            hostname: "nix-mac.example.ts.net",
            ipv4: "100.64.12.34"))
    }

    @Test
    func parsesStoppedDaemonStatusWithoutAddresses() throws {
        let data = Data(
            """
            {
              "BackendState": "Stopped",
              "TailscaleIPs": null,
              "Self": null
            }
            """.utf8)

        #expect(try TailscaleCLI.parseStatus(data) == .init(
            isRunning: false,
            hostname: nil,
            ipv4: nil))
    }

    @Test
    func statusCommandTimesOut() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("tailscale-timeout-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let executable = directory.appendingPathComponent("tailscale")
        try Data("#!/bin/sh\ntrap '' TERM\nwhile :; do :; done\n".utf8).write(to: executable)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)

        let clock = ContinuousClock()
        let elapsed = await clock.measure {
            let status = await TailscaleCLI.fetchStatus(
                executablePath: executable.path,
                timeout: .milliseconds(100))
            #expect(status == nil)
        }
        #expect(elapsed < .seconds(2))
    }
}
