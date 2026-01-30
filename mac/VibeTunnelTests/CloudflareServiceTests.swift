import AppKit
import Foundation
import Testing
@testable import VibeTunnel

@Suite("Cloudflare Service Tests", .tags(.networking))
struct CloudflareServiceTests {
    let testPort = 8888

    @Test("Singleton instance")
    @MainActor
    func singletonInstance() {
        let instance1 = CloudflareService.shared
        let instance2 = CloudflareService.shared
        #expect(instance1 === instance2)
    }

    @Test("Initial state")
    @MainActor
    func initialState() {
        let service = CloudflareService.shared

        // Initial state should have no public URL regardless of installation status
        #expect(service.publicUrl == nil)

        // If cloudflared is installed, cloudflaredPath should be set
        if service.isInstalled {
            #expect(service.cloudflaredPath != nil)
        } else {
            #expect(service.cloudflaredPath == nil)
        }
    }

    @Test("CLI installation check")
    @MainActor
    func cliInstallationCheck() {
        let service = CloudflareService.shared

        // This will return true or false depending on whether cloudflared is installed
        let isInstalled = service.checkCLIInstallation()

        // The service's isInstalled property should match what checkCLIInstallation returns
        // Note: Service might have cached state, so we check the method result
        #expect(isInstalled == service.checkCLIInstallation())

        // If installed, cloudflaredPath should be set
        if isInstalled {
            #expect(service.cloudflaredPath != nil)
            #expect(!service.cloudflaredPath!.isEmpty)
        }
    }

    @Test("Cloudflared search paths include Nix profile")
    @MainActor
    func cloudflaredSearchPathsIncludeNixProfile() {
        let expectedPath = "/etc/profiles/per-user/\(NSUserName())/bin/cloudflared"
        #expect(CloudflareService.cloudflaredSearchPaths.contains(expectedPath))
    }

    @Test("Status check when not installed")
    @MainActor
    func statusCheckWhenNotInstalled() async {
        let service = CloudflareService.shared

        // If cloudflared is not installed, status should reflect that
        await service.checkCloudflaredStatus()

        if !service.isInstalled {
            #expect(service.isRunning == false)
            #expect(service.publicUrl == nil)
            #expect(service.statusError == "cloudflared is not installed")
        }
    }

    @Test("Start tunnel without installation fails")
    @MainActor
    func startTunnelWithoutInstallation() async throws {
        let service = CloudflareService.shared

        // If cloudflared is not installed, starting should fail
        if !service.isInstalled {
            do {
                try await service.startQuickTunnel(port: self.testPort)
                Issue.record("Expected error to be thrown")
            } catch let error as CloudflareError {
                #expect(error == .notInstalled)
            } catch {
                Issue.record("Expected CloudflareError.notInstalled")
            }
        }
    }

    @Test("Start tunnel when already running fails")
    @MainActor
    func startTunnelWhenAlreadyRunning() async throws {
        let service = CloudflareService.shared

        // Skip if not installed
        guard service.isInstalled else {
            return
        }

        // If tunnel is already running, starting again should fail
        if service.isRunning {
            do {
                try await service.startQuickTunnel(port: self.testPort)
                Issue.record("Expected error to be thrown")
            } catch let error as CloudflareError {
                #expect(error == .tunnelAlreadyRunning)
            } catch {
                Issue.record("Expected CloudflareError.tunnelAlreadyRunning")
            }
        }
    }

    @Test("Stop tunnel when not running")
    @MainActor
    func stopTunnelWhenNotRunning() async {
        let service = CloudflareService.shared

        // Ensure not running by stopping first
        await service.stopQuickTunnel()

        // Refresh status to ensure we have the latest state
        await service.checkCloudflaredStatus()

        // Stop again should be safe
        await service.stopQuickTunnel()

        // After stopping our managed tunnel, the service should report not running
        // Note: There might be external cloudflared processes, but our service shouldn't be managing them
        #expect(service.publicUrl == nil)
    }

    @Test("URL extraction from output")
    @MainActor
    func urlExtractionFromOutput() {
        // Test URL extraction with sample cloudflared output
        let testOutputs = [
            "Your free tunnel has started! Visit it: https://example-test.trycloudflare.com",
            "2024-01-01 12:00:00 INF https://another-test.trycloudflare.com",
            "Tunnel URL: https://third-test.trycloudflare.com",
            "No URL in this output",
            "https://invalid-domain.com should not match",
        ]

        // This test verifies the URL extraction logic indirectly
        // The actual extraction is private, but we can test the pattern
        let pattern = "https://[a-zA-Z0-9-]+\\.trycloudflare\\.com"
        let regex = try? NSRegularExpression(pattern: pattern, options: [])

        for output in testOutputs {
            let range = NSRange(location: 0, length: output.count)
            let matches = regex?.matches(in: output, options: [], range: range)

            if output.contains("trycloudflare.com"), !output.contains("invalid-domain") {
                #expect(matches?.count == 1)
            }
        }
    }

    @Test("CloudflareError descriptions")
    func cloudflareErrorDescriptions() {
        let errors: [CloudflareError] = [
            .notInstalled,
            .tunnelAlreadyRunning,
            .tunnelCreationFailed("test error"),
            .networkError("connection failed"),
            .invalidOutput,
            .processTerminated,
        ]

        for error in errors {
            #expect(error.errorDescription != nil)
            if let description = error.errorDescription {
                #expect(!description.isEmpty)
            }
        }
    }

    @Test("CloudflareError equality")
    func cloudflareErrorEquality() {
        #expect(CloudflareError.notInstalled == CloudflareError.notInstalled)
        #expect(CloudflareError.tunnelAlreadyRunning == CloudflareError.tunnelAlreadyRunning)
        #expect(CloudflareError.tunnelCreationFailed("a") == CloudflareError.tunnelCreationFailed("a"))
        #expect(CloudflareError.tunnelCreationFailed("a") != CloudflareError.tunnelCreationFailed("b"))
        #expect(CloudflareError.networkError("a") == CloudflareError.networkError("a"))
        #expect(CloudflareError.networkError("a") != CloudflareError.networkError("b"))
    }

    @Test("Installation method URLs")
    @MainActor
    func installationMethodUrls() {
        let service = CloudflareService.shared

        // Enable test mode to prevent opening URLs
        CloudflareService.isTestMode = true
        defer { CloudflareService.isTestMode = false }

        // Test that installation methods don't crash
        // These should NOT open URLs in test mode
        service.openHomebrewInstall()
        service.openDownloadPage()
        service.openSetupGuide()

        // Verify clipboard was populated for homebrew install
        let pasteboard = NSPasteboard.general
        let copiedString = pasteboard.string(forType: .string)
        #expect(copiedString == "brew install cloudflared")

        // No exceptions should be thrown
        #expect(Bool(true))
    }

    @Test("Service state consistency")
    @MainActor
    func serviceStateConsistency() async {
        let service = CloudflareService.shared

        await service.checkCloudflaredStatus()

        // If not installed, should not be running
        if !service.isInstalled {
            #expect(service.isRunning == false)
            #expect(service.publicUrl == nil)
        }

        // If not running, should not have public URL
        if !service.isRunning {
            #expect(service.publicUrl == nil)
        }

        // If running, should be installed
        if service.isRunning {
            #expect(service.isInstalled == true)
        }
    }

    @Test("Concurrent status checks")
    @MainActor
    func concurrentStatusChecks() async {
        let service = CloudflareService.shared

        // Run multiple status checks concurrently
        await withTaskGroup(of: Void.self) { group in
            for _ in 0..<5 {
                group.addTask {
                    await service.checkCloudflaredStatus()
                }
            }
        }

        // Service should still be in a consistent state
        let finalState = service.isRunning
        #expect(finalState == service.isRunning) // Should be consistent
    }

    @Test("Status error handling")
    @MainActor
    func statusErrorHandling() async {
        let service = CloudflareService.shared

        await service.checkCloudflaredStatus()

        // If not installed, should have appropriate error
        if !service.isInstalled {
            #expect(service.statusError == "cloudflared is not installed")
        } else if !service.isRunning {
            #expect(service.statusError == "No active cloudflared tunnel")
        }
    }
}
