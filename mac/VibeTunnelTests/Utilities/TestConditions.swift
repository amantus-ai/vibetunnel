import Foundation
import Testing
@testable import VibeTunnel

// MARK: - Enhanced Test Conditions for Swift 6.2

/// Condition that checks if the server binary is available for testing
enum ServerBinaryAvailableCondition {
    static func isAvailable() -> Bool {
        // Check for the embedded vibetunnel binary in the host app bundle
        // When running tests with swift test, Bundle(for:) won't find the app bundle
        // So tests should fail if the binary is not properly embedded
        let hostBundle = Bundle(for: BunServer.self)

        if let embeddedBinaryPath = hostBundle.path(forResource: "vibetunnel", ofType: nil),
           FileManager.default.fileExists(atPath: embeddedBinaryPath)
        {
            return true
        }

        // The binary MUST be embedded in the app's Resources folder
        // If it's not there, the tests should fail
        return false
    }
}

/// Simple condition checks for tests
enum TestConditions {
    static func isInGitRepository() -> Bool {
        FileManager.default.fileExists(atPath: ".git")
    }

    static func hasNetworkInterfaces() -> Bool {
        !NetworkUtility.getAllIPAddresses().isEmpty
    }

    static func isRunningInCI() -> Bool {
        ProcessInfo.processInfo.environment["CI"] != nil ||
            ProcessInfo.processInfo.environment["GITHUB_ACTIONS"] != nil
    }

    static func canSpawnProcesses() -> Bool {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/bin/echo")
        task.arguments = ["test"]

        do {
            try task.run()
            task.waitUntilExit()
            return task.terminationStatus == 0
        } catch {
            return false
        }
    }
}

// MARK: - Enhanced Test Tags

extension Tag {
    @Tag static var requiresServerBinary: Self
    @Tag static var requiresNetwork: Self
    @Tag static var requiresProcessSpawn: Self
    @Tag static var exitTests: Self
    @Tag static var attachmentTests: Self
}

// MARK: - Test Utilities

enum TestUtilities {
    /// Capture system information for test attachments
    static func captureSystemInfo() -> String {
        """
        System Information:
        - OS: \(ProcessInfo.processInfo.operatingSystemVersionString)
        - Processor: \(ProcessInfo.processInfo.processorCount) cores
        - Memory: \(ProcessInfo.processInfo.physicalMemory / 1_024 / 1_024) MB
        - Environment: \(ProcessInfo.processInfo.environment["CI"] != nil ? "CI" : "Local")
        - Timestamp: \(Date().ISO8601Format())
        """
    }

    /// Capture network configuration for debugging
    static func captureNetworkConfig() -> String {
        let localIP = NetworkUtility.getLocalIPAddress()
        let allIPs = NetworkUtility.getAllIPAddresses()

        return """
        Network Configuration:
        - Local IP: \(localIP ?? "none")
        - All IPs: \(allIPs.isEmpty ? "none" : allIPs.joined(separator: ", "))
        - Interface Count: \(allIPs.count)
        """
    }

    /// Capture server state for debugging
    @MainActor
    static func captureServerState(_ manager: ServerManager) -> String {
        """
        Server State:
        - Running: \(manager.isRunning)
        - Port: \(manager.port)
        - Bind Address: \(manager.bindAddress)
        - Has Server Instance: \(manager.bunServer != nil)
        - Last Error: \(manager.lastError?.localizedDescription ?? "none")
        """
    }

    /// Calculate standard deviation for performance metrics
    static func calculateStandardDeviation(_ values: [TimeInterval]) -> Double {
        guard !values.isEmpty else { return 0 }

        let mean = values.reduce(0, +) / Double(values.count)
        let squaredDifferences = values.map { pow($0 - mean, 2) }
        let variance = squaredDifferences.reduce(0, +) / Double(values.count)

        return sqrt(variance)
    }

}
