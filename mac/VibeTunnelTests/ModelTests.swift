import Foundation
import Testing
@testable import VibeTunnel

// MARK: - Model Tests Suite

@Suite("Model Tests", .tags(.models))
struct ModelTests {
    // MARK: - TunnelSession Tests

    @Suite("TunnelSession Tests")
    struct TunnelSessionTests {
        @Test
        func tunnelsessionInitialization() {
            let session = TunnelSession()

            #expect(session.id != UUID())
            #expect(session.createdAt <= Date())
            #expect(session.lastActivity >= session.createdAt)
            #expect(session.processID == nil)
            #expect(session.isActive)
        }

        @Test
        func tunnelsessionWithProcessId() {
            let pid: Int32 = 12345
            let session = TunnelSession(processID: pid)

            #expect(session.processID == pid)
            #expect(session.isActive)
        }

        @Test
        func tunnelsessionActivityUpdate() {
            var session = TunnelSession()
            let initialActivity = session.lastActivity

            // Wait a bit to ensure time difference
            Thread.sleep(forTimeInterval: 0.1)

            session.updateActivity()

            #expect(session.lastActivity > initialActivity)
            #expect(session.lastActivity <= Date())
        }

        @Test(.tags(.models))
        func tunnelsessionSerialization() throws {
            let session = TunnelSession(id: UUID(), processID: 99999)

            // Encode
            let encoder = JSONEncoder()
            let data = try encoder.encode(session)

            // Decode
            let decoder = JSONDecoder()
            let decoded = try decoder.decode(TunnelSession.self, from: data)

            #expect(decoded.id == session.id)
            #expect(decoded.createdAt == session.createdAt)
            #expect(decoded.processID == session.processID)
            #expect(decoded.isActive == session.isActive)
        }

        @Test
        func tunnelsessionSendableConformance() async {
            let session = TunnelSession()

            // Test that we can send across actor boundaries
            let actor = TestActor()
            await actor.receiveSession(session)

            let received = await actor.getSession()
            #expect(received?.id == session.id)
        }
    }

    // MARK: - CreateSessionRequest Tests

    @Suite("CreateSessionRequest Tests")
    struct CreateSessionRequestTests {
        @Test
        func createsessionrequestInitialization() {
            // Default initialization
            let request1 = CreateSessionRequest()
            #expect(request1.workingDirectory == nil)
            #expect(request1.environment == nil)
            #expect(request1.shell == nil)

            // Full initialization
            let request2 = CreateSessionRequest(
                workingDirectory: "/tmp",
                environment: ["KEY": "value"],
                shell: "/bin/zsh")
            #expect(request2.workingDirectory == "/tmp")
            #expect(request2.environment?["KEY"] == "value")
            #expect(request2.shell == "/bin/zsh")
        }

        @Test
        func createsessionrequestSerialization() throws {
            let request = CreateSessionRequest(
                workingDirectory: "/Users/test",
                environment: ["PATH": "/usr/bin", "LANG": "en_US.UTF-8"],
                shell: "/bin/bash")

            let data = try JSONEncoder().encode(request)
            let decoded = try JSONDecoder().decode(CreateSessionRequest.self, from: data)

            #expect(decoded.workingDirectory == request.workingDirectory)
            #expect(decoded.environment?["PATH"] == request.environment?["PATH"])
            #expect(decoded.environment?["LANG"] == request.environment?["LANG"])
            #expect(decoded.shell == request.shell)
        }
    }

    // MARK: - DashboardAccessMode Tests

    @Suite("DashboardAccessMode Tests")
    struct DashboardAccessModeTests {
        @Test(arguments: DashboardAccessMode.allCases)
        func dashboardaccessmodeValidation(mode: DashboardAccessMode) {
            // Each mode should have valid properties
            #expect(!mode.displayName.isEmpty)
            #expect(!mode.description.isEmpty)

            // Verify bind addresses
            switch mode {
            case .localhost:
                #expect(mode.fixedBindAddress?.value == "127.0.0.1")
            case .network:
                #expect(mode.fixedBindAddress?.value == "0.0.0.0")
            case .custom:
                #expect(mode.fixedBindAddress == nil)
                #expect(mode.resolvedBindAddress(customAddress: "::").value == "::")
                #expect(mode.resolvedBindAddress(customAddress: "invalid").value == "127.0.0.1")
            }
        }

        @Test
        func dashboardaccessmodeRawValues() {
            #expect(DashboardAccessMode.localhost.rawValue == AppConstants.DashboardAccessModeRawValues.localhost)
            #expect(DashboardAccessMode.network.rawValue == AppConstants.DashboardAccessModeRawValues.network)
            #expect(DashboardAccessMode.custom.rawValue == AppConstants.DashboardAccessModeRawValues.custom)
        }

        @Test
        func dashboardaccessmodeDescriptions() {
            #expect(DashboardAccessMode.localhost.description.contains("this Mac"))
            #expect(DashboardAccessMode.network.description.contains("other devices"))
            #expect(DashboardAccessMode.custom.description.contains("IPv4 or IPv6"))
        }

        @Test
        func dashboardaccessmodeDefaultValue() {
            // Verify the default is network mode
            #expect(AppConstants.Defaults.dashboardAccessMode == DashboardAccessMode.network.rawValue)

            // Verify we can create a mode from the default
            let mode = DashboardAccessMode(rawValue: AppConstants.Defaults.dashboardAccessMode)
            #expect(mode == .network)
            #expect(mode?.fixedBindAddress?.value == "0.0.0.0")
        }

        @Test
        func dashboardaccessmodeFromInvalidRawValue() {
            let mode = DashboardAccessMode(rawValue: "invalid")
            #expect(mode == nil)

            let emptyMode = DashboardAccessMode(rawValue: "")
            #expect(emptyMode == nil)
        }
    }

    // MARK: - ServerBindAddress Tests

    @Suite("ServerBindAddress Tests")
    struct ServerBindAddressTests {
        @Test(arguments: [
            ("127.0.0.1", ServerBindAddress.Family.ipv4),
            ("0.0.0.0", ServerBindAddress.Family.ipv4),
            ("::1", ServerBindAddress.Family.ipv6),
            ("::", ServerBindAddress.Family.ipv6),
            ("2001:db8::1", ServerBindAddress.Family.ipv6),
        ])
        func acceptsIPv4AndIPv6(value: String, family: ServerBindAddress.Family) {
            let address = ServerBindAddress(value)
            #expect(address?.value == value)
            #expect(address?.family == family)
        }

        @Test(arguments: ["", "localhost", "256.0.0.1", "192.168.1", "[::1]", "2001:db8:::1"])
        func rejectsInvalidAddressLiterals(value: String) {
            #expect(ServerBindAddress(value) == nil)
        }

        @Test
        func trimsAddressWhitespace() {
            #expect(ServerBindAddress("  ::1 \n")?.value == "::1")
        }

        @Test
        func buildsBracketedIPv6URLs() {
            let loopback = ServerBindAddress("::1")
            #expect(loopback?.endpoint(port: "4020") == "[::1]:4020")
            #expect(
                loopback?.url(port: "4020", endpoint: "/api/health")?.absoluteString ==
                    "http://[::1]:4020/api/health")
        }

        @Test
        func mapsWildcardAddressesToUsableLoopbackURLs() {
            let ipv4Wildcard = ServerBindAddress("0.0.0.0")
            let ipv6Wildcard = ServerBindAddress("::")

            #expect(ipv4Wildcard?.connectableAddress.value == "127.0.0.1")
            #expect(ipv6Wildcard?.connectableAddress.value == "::1")
            #expect(ipv6Wildcard?.connectableAddress.url(port: "4020")?.absoluteString == "http://[::1]:4020/")
        }
    }

    // MARK: - UpdateChannel Tests

    @Suite("UpdateChannel Tests")
    struct UpdateChannelTests {
        @Test(arguments: zip(
            UpdateChannel.allCases,
            ["stable", "prerelease"]))
        func updatechannelPrecedence(channel: UpdateChannel, expectedRawValue: String) {
            #expect(channel.rawValue == expectedRawValue)
        }

        @Test
        func updatechannelProperties() {
            // Stable channel
            let stable = UpdateChannel.stable
            #expect(stable.displayName == "Stable Only")
            #expect(stable.includesPreReleases == false)
            #expect(stable.appcastURL.absoluteString.contains("appcast.xml"))

            // Prerelease channel
            let prerelease = UpdateChannel.prerelease
            #expect(prerelease.displayName == "Include Pre-releases")
            #expect(prerelease.includesPreReleases == true)
            #expect(prerelease.appcastURL.absoluteString.contains("prerelease"))
        }

        @Test(arguments: [
            ("1.0.0", UpdateChannel.stable),
            ("1.0.0-beta", UpdateChannel.prerelease),
            ("2.0-alpha.1", UpdateChannel.prerelease),
            ("1.0.0-rc1", UpdateChannel.prerelease),
            ("1.0.0-pre", UpdateChannel.prerelease),
            ("1.0.0-dev", UpdateChannel.prerelease),
            ("1.2.3", UpdateChannel.stable),
        ])
        func updatechannelDefaultDetection(version: String, expectedChannel: UpdateChannel) {
            let detectedChannel = UpdateChannel.defaultChannel(for: version)
            #expect(detectedChannel == expectedChannel)
        }

        @Test
        func updatechannelAppcastUrls() {
            // URLs should be valid
            for channel in UpdateChannel.allCases {
                let url = channel.appcastURL
                #expect(url.scheme == "https")
                #expect(url.host?.contains("stats.store") == true)
                #expect(url.pathComponents.contains("appcast"))
            }
        }

        @Test
        func updatechannelSerialization() throws {
            for channel in UpdateChannel.allCases {
                let data = try JSONEncoder().encode(channel)
                let decoded = try JSONDecoder().decode(UpdateChannel.self, from: data)
                #expect(decoded == channel)
            }
        }

        @Test
        func updatechannelUserdefaultsIntegration() {
            let defaults = UserDefaults.standard
            let originalValue = defaults.updateChannel

            // Set and retrieve
            defaults.updateChannel = UpdateChannel.prerelease.rawValue
            #expect(defaults.updateChannel == "prerelease")

            // Test current channel
            #expect(UpdateChannel.current == .prerelease)

            // Cleanup
            defaults.updateChannel = originalValue
        }

        @Test
        func updatechannelIdentifiableConformance() {
            #expect(UpdateChannel.stable.id == "stable")
            #expect(UpdateChannel.prerelease.id == "prerelease")
        }
    }

    // MARK: - AppConstants Tests

    @Suite("AppConstants Tests")
    struct AppConstantsTests {
        @Test
        func welcomeVersionConstant() {
            #expect(AppConstants.currentWelcomeVersion > 0)
            #expect(AppConstants.currentWelcomeVersion == 5)
        }

        @Test
        func userdefaultsKeys() {
            #expect(AppConstants.UserDefaultsKeys.welcomeVersion == "welcomeVersion")
            #expect(AppConstants.UserDefaultsKeys.dashboardAccessMode == "dashboardAccessMode")
            #expect(AppConstants.UserDefaultsKeys.serverPort == "serverPort")
        }

        @Test
        func appconstantsDefaultValues() {
            // Verify dashboard access mode default
            #expect(AppConstants.Defaults.dashboardAccessMode == DashboardAccessMode.network.rawValue)

            // Verify server port default
            #expect(AppConstants.Defaults.serverPort == 4020)

            // Verify other defaults
            #expect(AppConstants.Defaults.cleanupOnStartup == true)
            #expect(AppConstants.Defaults.showInDock == false)
        }

        @Test
        func appconstantsStringvalueHelperWithDashboardaccessmode() {
            // Store original value
            let originalValue = UserDefaults.standard.string(forKey: AppConstants.UserDefaultsKeys.dashboardAccessMode)

            defer {
                // Restore original value
                if let originalValue {
                    UserDefaults.standard.set(originalValue, forKey: AppConstants.UserDefaultsKeys.dashboardAccessMode)
                } else {
                    UserDefaults.standard.removeObject(forKey: AppConstants.UserDefaultsKeys.dashboardAccessMode)
                }
            }

            // When key doesn't exist, should return default
            UserDefaults.standard.removeObject(forKey: AppConstants.UserDefaultsKeys.dashboardAccessMode)
            let defaultValue = AppConstants.stringValue(for: AppConstants.UserDefaultsKeys.dashboardAccessMode)
            #expect(defaultValue == AppConstants.Defaults.dashboardAccessMode)
            #expect(defaultValue == AppConstants.DashboardAccessModeRawValues.network) // Our default is network

            // When key exists with localhost, should return localhost
            UserDefaults.standard.set(
                AppConstants.DashboardAccessModeRawValues.localhost,
                forKey: AppConstants.UserDefaultsKeys.dashboardAccessMode)
            let localhostValue = AppConstants.stringValue(for: AppConstants.UserDefaultsKeys.dashboardAccessMode)
            #expect(localhostValue == AppConstants.DashboardAccessModeRawValues.localhost)

            // When key exists with network, should return network
            UserDefaults.standard.set(
                AppConstants.DashboardAccessModeRawValues.network,
                forKey: AppConstants.UserDefaultsKeys.dashboardAccessMode)
            let networkValue = AppConstants.stringValue(for: AppConstants.UserDefaultsKeys.dashboardAccessMode)
            #expect(networkValue == AppConstants.DashboardAccessModeRawValues.network)
        }
    }
}

// MARK: - Test Helpers

actor TestActor {
    private var session: TunnelSession?

    func receiveSession(_ session: TunnelSession) {
        self.session = session
    }

    func getSession() -> TunnelSession? {
        self.session
    }
}
