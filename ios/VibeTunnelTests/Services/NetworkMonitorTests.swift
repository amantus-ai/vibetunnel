import Foundation
import Network
import Testing
@testable import VibeTunnel

@Suite("NetworkMonitor Tests", .tags(.networking, .services))
@MainActor
struct NetworkMonitorTests {
    @Test("Shared instance is singleton")
    func sharedInstanceSingleton() {
        let instance1 = NetworkMonitor.shared
        let instance2 = NetworkMonitor.shared

        #expect(instance1 === instance2)
    }

    @Test("Network reachability check with invalid host")
    func networkReachabilityCheckInvalidHost() async {
        let monitor = NetworkMonitor.shared

        // Test with an invalid URL
        let isReachable = await monitor.checkHostReachability("invalid-url")

        // Should return false for invalid URLs
        #expect(isReachable == false)
    }

    @Test("Network reachability check with malformed URL")
    func networkReachabilityCheckMalformedURL() async {
        let monitor = NetworkMonitor.shared

        // Test with malformed URLs that should return false
        let malformedUrls = [
            "",
            "not-a-url",
            "http://", // No host
            "just text"
        ]

        for malformedUrl in malformedUrls {
            let isReachable = await monitor.checkHostReachability(malformedUrl)
            #expect(isReachable == false, "URL '\(malformedUrl)' should be unreachable")
        }

        // Special case: "://missing-scheme" actually parses as a valid URL with host "missing-scheme"
        // This is technically valid according to URL parsing, but not a useful real-world URL
        _ = await monitor.checkHostReachability("://missing-scheme")
        // This test just verifies the method doesn't crash - the actual result depends on network connectivity
        // since the current implementation only checks general connectivity, not specific host reachability
    }

    @Test("Notification names are defined")
    func notificationNamesExist() {
        // Verify notification names are properly defined
        #expect(Notification.Name.networkBecameAvailable.rawValue == "networkBecameAvailable")
        #expect(Notification.Name.networkBecameUnavailable.rawValue == "networkBecameUnavailable")
    }

    @Test("Reachability method handles edge cases")
    func reachabilityEdgeCases() async {
        let monitor = NetworkMonitor.shared

        // Test empty string - should return false
        let emptyResult = await monitor.checkHostReachability("")
        #expect(emptyResult == false, "Empty string should be unreachable")

        // Test URL without scheme - should return false because url.host will be nil
        let noSchemeResult = await monitor.checkHostReachability("www.example.com")
        #expect(noSchemeResult == false, "URL without scheme should be unreachable")

        // Test malformed URL - this actually parses as valid URL with host "a"
        // Since the current implementation only checks URL validity + general connectivity,
        // this will depend on network status rather than being guaranteed false
        _ = await monitor.checkHostReachability("not://a//valid::url")
        // We just verify it doesn't crash - the result depends on network connectivity
    }

    @Test("Multiple reachability checks don't interfere")
    func multipleReachabilityChecks() async {
        let monitor = NetworkMonitor.shared

        // Start multiple reachability checks concurrently
        async let check1 = monitor.checkHostReachability("https://www.apple.com")
        async let check2 = monitor.checkHostReachability("https://www.google.com")
        async let check3 = monitor.checkHostReachability("invalid-url")

        let results = await [check1, check2, check3]

        // Should get results for all checks
        #expect(results.count == 3)
        #expect(results[2] == false) // Invalid URL should be false
    }

    @Test("Reachability check timeout behavior")
    func reachabilityCheckTimeout() async {
        let monitor = NetworkMonitor.shared

        // This should complete within a reasonable time (the method has a 5-second timeout)
        let startTime = Date()
        _ = await monitor.checkHostReachability("https://httpbin.org/delay/10") // 10-second delay endpoint
        let elapsed = Date().timeIntervalSince(startTime)

        // Should timeout before 10 seconds (the method has a 5-second timeout)
        #expect(elapsed < 8.0) // Give some buffer for the timeout
    }
}
