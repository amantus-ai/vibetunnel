import Foundation
import Testing

/// Configuration for test behavior in CI environments
enum CITestConfiguration {
    /// Multiplier for timeouts when running in CI
    static let timeoutMultiplier: Double = TestConditions.isRunningInCI() ? 2.5 : 1.0

    /// Get adjusted timeout for CI
    static func adjustedTimeout(base: TimeInterval) -> TimeInterval {
        base * timeoutMultiplier
    }

    /// Get adjusted sleep duration for CI
    static func adjustedSleep(milliseconds: Int) -> Duration {
        let adjustedMs = Double(milliseconds) * timeoutMultiplier
        return .milliseconds(Int(adjustedMs))
    }

    /// Check if a slow test should run
    static func shouldRunSlowTest() -> Bool {
        // Skip slow tests in CI unless explicitly enabled
        if TestConditions.isRunningInCI() {
            return ProcessInfo.processInfo.environment["RUN_SLOW_TESTS"] == "true"
        }
        return true
    }

    /// Check if a flaky test should run
    static func shouldRunFlakyTest() -> Bool {
        // Skip flaky tests in CI unless explicitly enabled
        if TestConditions.isRunningInCI() {
            return ProcessInfo.processInfo.environment["RUN_FLAKY_TESTS"] == "true"
        }
        return true
    }
}

// MARK: - Test Tags for CI

extension Tag {
    /// Test that is slow and might timeout in CI
    @Tag static var slow: Tag

    /// Test that is known to be flaky in CI
    @Tag static var flaky: Tag

    /// Test that requires real file system access
    @Tag static var fileSystem: Tag

    /// Test that requires network access
    @Tag static var network: Tag
}
