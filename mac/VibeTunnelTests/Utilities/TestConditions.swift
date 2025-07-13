import Foundation
import Testing
@testable import VibeTunnel

// MARK: - Enhanced Test Conditions for Swift 6.2

/// Condition that checks if the Bun server binary is available for testing
struct BunServerAvailableCondition {
    static func isAvailable() -> Bool {
        // Check for the embedded vibetunnel binary (same logic as BunServer)
        if let embeddedBinaryPath = Bundle.main.path(forResource: "vibetunnel", ofType: nil),
           FileManager.default.fileExists(atPath: embeddedBinaryPath) {
            return true
        }
        
        // Fallback: Check if we can find external Bun binary
        let bunPath = "/usr/local/bin/bun"
        let altBunPath = "/opt/homebrew/bin/bun"
        
        return FileManager.default.fileExists(atPath: bunPath) || 
               FileManager.default.fileExists(atPath: altBunPath)
    }
}

/// Simple condition checks for tests
enum TestConditions {
    
    static func isInGitRepository() -> Bool {
        return FileManager.default.fileExists(atPath: ".git")
    }
    
    static func hasNetworkInterfaces() -> Bool {
        return !NetworkUtility.getAllIPAddresses().isEmpty
    }
    
    static func isRunningInCI() -> Bool {
        return ProcessInfo.processInfo.environment["CI"] != nil ||
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
        return """
        System Information:
        - OS: \(ProcessInfo.processInfo.operatingSystemVersionString)
        - Processor: \(ProcessInfo.processInfo.processorCount) cores
        - Memory: \(ProcessInfo.processInfo.physicalMemory / 1024 / 1024) MB
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
        return """
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