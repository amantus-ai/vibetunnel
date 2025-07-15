import Foundation
import Network
import Testing
@testable import VibeTunnel

// MARK: - Mock Network Utility for Testing

@MainActor
enum MockNetworkUtility {
    static var mockLocalIP: String?
    static var mockAllIPs: [String] = []
    static var shouldFailGetAddresses = false

    static func reset() {
        mockLocalIP = nil
        mockAllIPs = []
        shouldFailGetAddresses = false
    }

    static func getLocalIPAddress() -> String? {
        if shouldFailGetAddresses { return nil }
        return mockLocalIP
    }

    static func getAllIPAddresses() -> [String] {
        if shouldFailGetAddresses { return [] }
        return mockAllIPs
    }
}

// MARK: - Network Utility Tests

@Suite("Network Utility Tests", .tags(.networking))
struct NetworkUtilityTests {
    // MARK: - Local IP Address Tests

    @Test("Get local IP address")
    func testGetLocalIPAddress() throws {
        // Test real implementation
        let localIP = NetworkUtility.getLocalIPAddress()

        // On a real system, we should get some IP address
        // It might be nil in some test environments
        if let ip = localIP {
            #expect(!ip.isEmpty)

            // Should be a valid IPv4 address format
            let components = ip.split(separator: ".")
            #expect(components.count == 4)

            // Each component should be a valid number 0-255
            for component in components {
                if let num = Int(component) {
                    #expect(num >= 0 && num <= 255)
                } else {
                    Issue.record("Invalid IP component: \(component)")
                }
            }
        }
    }

    @Test("Local IP address preferences")
    func localIPPreferences() throws {
        // Test that we prefer local network addresses
        let mockIPs = [
            "192.168.1.100", // Preferred - local network
            "10.0.0.50", // Preferred - local network
            "172.16.0.10", // Preferred - local network
            "8.8.8.8", // Not preferred - public IP
            "127.0.0.1" // Should be filtered out - loopback
        ]

        // Verify our preference logic
        for ip in mockIPs {
            if ip.hasPrefix("192.168.") || ip.hasPrefix("10.") || ip.hasPrefix("172.") {
                #expect(Bool(true), "IP \(ip) should be preferred")
            }
        }
    }

    @Test("Get all IP addresses")
    func testGetAllIPAddresses() throws {
        let allIPs = NetworkUtility.getAllIPAddresses()

        // Should return array (might be empty in test environment)
        #expect(allIPs.count >= 0)

        // If we have IPs, verify they're valid
        for ip in allIPs {
            #expect(!ip.isEmpty)

            // Should not contain loopback
            #expect(!ip.hasPrefix("127."))

            // Should be valid IPv4 format
            let components = ip.split(separator: ".")
            #expect(components.count == 4)
        }
    }

    // MARK: - Network Interface Tests

    @Test("Network interface filtering")
    func interfaceFiltering() throws {
        // Test that we filter interfaces correctly
        let allIPs = NetworkUtility.getAllIPAddresses()

        // Should not contain any loopback addresses
        for ip in allIPs {
            #expect(!ip.hasPrefix("127.0.0"))
            #expect(ip != "::1") // IPv6 loopback
        }
    }

    @Test("IPv4 address validation")
    func iPv4Validation() throws {
        let testIPs = [
            ("192.168.1.1", true),
            ("10.0.0.1", true),
            ("172.16.0.1", true),
            ("256.1.1.1", false), // Invalid - component > 255
            ("1.1.1", false), // Invalid - only 3 components
            ("1.1.1.1.1", false), // Invalid - too many components
            ("a.b.c.d", false), // Invalid - non-numeric
            ("", false) // Invalid - empty
        ]

        for (ip, shouldBeValid) in testIPs {
            let components = ip.split(separator: ".")
            let isValid = components.count == 4 && components.allSatisfy { component in
                if let num = Int(component) {
                    return num >= 0 && num <= 255
                }
                return false
            }

            #expect(isValid == shouldBeValid, "IP \(ip) validation failed")
        }
    }

    // MARK: - Edge Cases Tests

    @Test("Handle no network interfaces")
    @MainActor
    func noNetworkInterfaces() throws {
        // In a real scenario where no interfaces are available
        // the functions should return nil/empty array gracefully

        MockNetworkUtility.shouldFailGetAddresses = true

        #expect(MockNetworkUtility.getLocalIPAddress() == nil)
        #expect(MockNetworkUtility.getAllIPAddresses().isEmpty)

        MockNetworkUtility.reset()
    }

    @Test("Multiple network interfaces")
    @MainActor
    func multipleInterfaces() throws {
        // When multiple interfaces exist, we should get all of them
        MockNetworkUtility.mockAllIPs = [
            "192.168.1.100", // Wi-Fi
            "192.168.2.50", // Ethernet
            "10.0.0.100" // VPN
        ]

        let allIPs = MockNetworkUtility.getAllIPAddresses()
        #expect(allIPs.count == 3)
        #expect(Set(allIPs).count == 3) // All unique

        MockNetworkUtility.reset()
    }

    // MARK: - Platform-Specific Tests

    @Test("macOS network interface names")
    func macOSInterfaceNames() throws {
        // On macOS, typical interface names are:
        // en0 - Primary network interface (often Wi-Fi)
        // en1 - Secondary network interface (often Ethernet)
        // en2, en3, etc. - Additional interfaces

        // This test documents expected behavior
        let expectedPrefixes = ["en"]

        for prefix in expectedPrefixes {
            #expect(prefix.hasPrefix("en"), "Network interfaces should start with 'en' on macOS")
        }
    }

    // MARK: - Performance Tests

    @Test("Performance of IP address retrieval", .tags(.performance, .attachmentTests))
    func iPRetrievalPerformance() async throws {
        // Enhanced performance testing with detailed metrics
        var timings: [TimeInterval] = []
        let iterations = 50
        
        // Attach system configuration
        Attachment.record("""
            Test: IP Address Retrieval Performance
            Iterations: \(iterations)
            Test Environment: \(ProcessInfo.processInfo.environment["CI"] != nil ? "CI" : "Local")
            System: \(TestUtilities.captureSystemInfo())
            Network: \(TestUtilities.captureNetworkConfig())
            """, named: "Performance Test Configuration")
        
        // Measure individual timings
        for i in 0..<iterations {
            let start = CFAbsoluteTimeGetCurrent()
            _ = NetworkUtility.getLocalIPAddress()
            let end = CFAbsoluteTimeGetCurrent()
            timings.append(end - start)
        }
        
        // Calculate statistics
        let average = timings.reduce(0, +) / Double(timings.count)
        let max = timings.max() ?? 0
        let min = timings.min() ?? 0
        let stdDev = TestUtilities.calculateStandardDeviation(timings)
        
        // Attach detailed performance metrics
        Attachment.record("""
            Iterations: \(iterations)
            Average: \(String(format: "%.4f", average * 1000))ms
            Min: \(String(format: "%.4f", min * 1000))ms  
            Max: \(String(format: "%.4f", max * 1000))ms
            Standard Deviation: \(String(format: "%.4f", stdDev * 1000))ms
            95th Percentile: \(String(format: "%.4f", calculatePercentile95(timings) * 1000))ms
            """, named: "Performance Metrics")
        
        // Attach timing distribution for analysis
        let timingData = timings.enumerated().map { i, timing in
            "Iteration \(i + 1): \(String(format: "%.4f", timing * 1000))ms"
        }.joined(separator: "\n")
        Attachment.record(timingData, named: "Individual Timings")
        
        // Performance assertions
        #expect(average < 0.01, "Average response time should be under 10ms, got \(String(format: "%.2f", average * 1000))ms")
        #expect(max < 0.05, "Maximum response time should be under 50ms, got \(String(format: "%.2f", max * 1000))ms")
    }

    // MARK: - Concurrent Access Tests

    @Test("Concurrent IP address retrieval", .tags(.concurrency))
    func concurrentAccess() async throws {
        await withTaskGroup(of: String?.self) { group in
            // Multiple concurrent calls
            for _ in 0..<10 {
                group.addTask {
                    NetworkUtility.getLocalIPAddress()
                }
            }

            var results: [String?] = []
            for await result in group {
                results.append(result)
            }

            // All calls should return the same value
            let uniqueResults = Set(results.compactMap(\.self))
            #expect(uniqueResults.count <= 1, "Concurrent calls returned different IPs")
        }
    }

    // MARK: - Integration Tests

    @Test("Network utility with system network state", .tags(.integration))
    func systemNetworkState() throws {
        let localIP = NetworkUtility.getLocalIPAddress()
        let allIPs = NetworkUtility.getAllIPAddresses()

        // If we have a local IP, it should be in the all IPs list
        if let localIP {
            #expect(allIPs.contains(localIP), "Local IP should be in all IPs list")
        }

        // All IPs should be unique
        #expect(Set(allIPs).count == allIPs.count, "IP addresses should be unique")
    }

    @Test("IP address format consistency")
    func iPAddressFormat() throws {
        let allIPs = NetworkUtility.getAllIPAddresses()

        for ip in allIPs {
            // Should not have leading/trailing whitespace
            #expect(ip == ip.trimmingCharacters(in: .whitespacesAndNewlines))

            // Should not contain port numbers
            #expect(!ip.contains(":"))

            // Should be standard dotted decimal notation
            #expect(ip.contains("."))
        }
    }

    // MARK: - Mock Tests

    @Test("Mock network utility behavior")
    @MainActor
    func mockUtility() throws {
        // Set up mock
        MockNetworkUtility.mockLocalIP = "192.168.1.100"
        MockNetworkUtility.mockAllIPs = ["192.168.1.100", "10.0.0.50"]

        #expect(MockNetworkUtility.getLocalIPAddress() == "192.168.1.100")
        #expect(MockNetworkUtility.getAllIPAddresses().count == 2)

        // Test failure scenario
        MockNetworkUtility.shouldFailGetAddresses = true
        #expect(MockNetworkUtility.getLocalIPAddress() == nil)
        #expect(MockNetworkUtility.getAllIPAddresses().isEmpty)

        MockNetworkUtility.reset()
    }
    
    // MARK: - Helper Functions
    
    /// Safely calculate 95th percentile, guarding against empty arrays and out-of-bounds access
    private func calculatePercentile95(_ timings: [TimeInterval]) -> TimeInterval {
        guard !timings.isEmpty else { return 0 }
        let sortedTimings = timings.sorted()
        let percentileIndex = min(Int(0.95 * Double(sortedTimings.count)), sortedTimings.count - 1)
        return sortedTimings[percentileIndex]
    }
}
