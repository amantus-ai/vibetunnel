import Foundation
import Testing
@testable import VibeTunnel

// MARK: - Model Tests Suite

@Suite("Model Tests", .tags(.models))
struct ModelTests {
    // MARK: - TunnelSession Tests

    @Suite("TunnelSession Tests")
    struct TunnelSessionTests {
        @Test("TunnelSession initialization")
        func initialization() throws {
            let session = TunnelSession()

            #expect(session.id != UUID())
            #expect(session.createdAt <= Date())
            #expect(session.lastActivity >= session.createdAt)
            #expect(session.processID == nil)
            #expect(session.isActive)
        }

        @Test("TunnelSession with process ID")
        func initWithProcessID() throws {
            let pid: Int32 = 12_345
            let session = TunnelSession(processID: pid)

            #expect(session.processID == pid)
            #expect(session.isActive)
        }

        @Test("TunnelSession activity update")
        func activityUpdate() throws {
            var session = TunnelSession()
            let initialActivity = session.lastActivity

            // Wait a bit to ensure time difference
            Thread.sleep(forTimeInterval: 0.1)

            session.updateActivity()

            #expect(session.lastActivity > initialActivity)
            #expect(session.lastActivity <= Date())
        }

        @Test("TunnelSession serialization", .tags(.models))
        func serialization() throws {
            let session = TunnelSession(id: UUID(), processID: 99_999)

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

        @Test("TunnelSession Sendable conformance")
        func sendable() async throws {
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
        @Test("CreateSessionRequest initialization")
        func testInitialization() throws {
            // Default initialization
            let request1 = CreateSessionRequest()
            #expect(request1.workingDirectory == nil)
            #expect(request1.environment == nil)
            #expect(request1.shell == nil)

            // Full initialization
            let request2 = CreateSessionRequest(
                workingDirectory: "/tmp",
                environment: ["KEY": "value"],
                shell: "/bin/zsh"
            )
            #expect(request2.workingDirectory == "/tmp")
            #expect(request2.environment?["KEY"] == "value")
            #expect(request2.shell == "/bin/zsh")
        }

        @Test("CreateSessionRequest serialization")
        func testSerialization() throws {
            let request = CreateSessionRequest(
                workingDirectory: "/Users/test",
                environment: ["PATH": "/usr/bin", "LANG": "en_US.UTF-8"],
                shell: "/bin/bash"
            )

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
        @Test("DashboardAccessMode validation", arguments: DashboardAccessMode.allCases)
        func accessModeValidation(mode: DashboardAccessMode) throws {
            // Each mode should have valid properties
            #expect(!mode.displayName.isEmpty)
            #expect(!mode.bindAddress.isEmpty)
            #expect(!mode.description.isEmpty)

            // Verify bind addresses
            switch mode {
            case .localhost:
                #expect(mode.bindAddress == "127.0.0.1")
            case .network:
                #expect(mode.bindAddress == "0.0.0.0")
            }
        }

        @Test("DashboardAccessMode raw values")
        func rawValues() throws {
            #expect(DashboardAccessMode.localhost.rawValue == "localhost")
            #expect(DashboardAccessMode.network.rawValue == "network")
        }

        @Test("DashboardAccessMode descriptions")
        func descriptions() throws {
            #expect(DashboardAccessMode.localhost.description.contains("this Mac"))
            #expect(DashboardAccessMode.network.description.contains("other devices"))
        }
    }

    // MARK: - UpdateChannel Tests

    @Suite("UpdateChannel Tests")
    struct UpdateChannelTests {
        @Test("UpdateChannel precedence", arguments: zip(
            UpdateChannel.allCases,
            ["stable", "prerelease"]
        ))
        func updateChannelPrecedence(channel: UpdateChannel, expectedRawValue: String) throws {
            #expect(channel.rawValue == expectedRawValue)
        }

        @Test("UpdateChannel properties")
        func channelProperties() throws {
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

        @Test("UpdateChannel default detection", arguments: [
            ("1.0.0", UpdateChannel.stable),
            ("1.0.0-beta", UpdateChannel.prerelease),
            ("2.0-alpha.1", UpdateChannel.prerelease),
            ("1.0.0-rc1", UpdateChannel.prerelease),
            ("1.0.0-pre", UpdateChannel.prerelease),
            ("1.0.0-dev", UpdateChannel.prerelease),
            ("1.2.3", UpdateChannel.stable)
        ])
        func defaultChannelDetection(version: String, expectedChannel: UpdateChannel) throws {
            let detectedChannel = UpdateChannel.defaultChannel(for: version)
            #expect(detectedChannel == expectedChannel)
        }

        @Test("UpdateChannel appcast URLs")
        func appcastURLs() throws {
            // URLs should be valid
            for channel in UpdateChannel.allCases {
                let url = channel.appcastURL
                #expect(url.scheme == "https")
                #expect(url.host?.contains("stats.store") == true)
                #expect(url.pathComponents.contains("appcast"))
            }
        }

        @Test("UpdateChannel serialization")
        func testSerialization() throws {
            for channel in UpdateChannel.allCases {
                let data = try JSONEncoder().encode(channel)
                let decoded = try JSONDecoder().decode(UpdateChannel.self, from: data)
                #expect(decoded == channel)
            }
        }

        @Test("UpdateChannel UserDefaults integration")
        func userDefaultsIntegration() throws {
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

        @Test("UpdateChannel Identifiable conformance")
        func identifiable() throws {
            #expect(UpdateChannel.stable.id == "stable")
            #expect(UpdateChannel.prerelease.id == "prerelease")
        }
    }

    // MARK: - AppConstants Tests

    @Suite("AppConstants Tests")
    struct AppConstantsTests {
        @Test("Welcome version constant")
        func testWelcomeVersion() throws {
            #expect(AppConstants.currentWelcomeVersion > 0)
            #expect(AppConstants.currentWelcomeVersion == 5)
        }

        @Test("UserDefaults keys")
        func userDefaultsKeys() throws {
            #expect(AppConstants.UserDefaultsKeys.welcomeVersion == "welcomeVersion")
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
        session
    }
}
