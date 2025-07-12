import Foundation
import Testing
@testable import VibeTunnel

// MARK: - Process Lifecycle Tests with Enhanced Attachments

@Suite("Process Lifecycle Tests", .tags(.reliability))
struct ProcessLifecycleTests {
    
    @Test("Basic process spawning validation", .tags(.attachmentTests))
    func basicProcessSpawning() async throws {
        // Test that we can spawn simple processes without issues
        Attachment.record("""
            Test: Basic Process Spawning
            Command: /bin/echo
            Expected: Clean exit with status 0
            Environment: \(ProcessInfo.processInfo.environment["USER"] ?? "unknown")
            """, named: "Process Test Configuration")
        
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/echo")
        process.arguments = ["Hello from VibeTunnel test"]
        
        let pipe = Pipe()
        process.standardOutput = pipe
        
        try process.run()
        process.waitUntilExit()
        
        // Capture output for verification
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        let output = String(data: data, encoding: .utf8) ?? ""
        
        Attachment.record("""
            Exit Status: \(process.terminationStatus)
            Output: \(output.trimmingCharacters(in: .whitespacesAndNewlines))
            Process ID: \(process.processIdentifier)
            """, named: "Process Output")
        
        #expect(process.terminationStatus == 0)
    }
    
    @Test("Process error handling", .tags(.attachmentTests))
    func processErrorHandling() async throws {
        // Test that we properly handle process failures
        Attachment.record("""
            Test: Process Error Handling
            Command: /bin/false (always exits with code 1)
            Expected: Exit with failure status
            """, named: "Error Test Configuration")
        
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/false")
        
        try process.run()
        process.waitUntilExit()
        
        Attachment.record("""
            Exit Status: \(process.terminationStatus)
            Expected: Non-zero exit status
            Process ID: \(process.processIdentifier)
            """, named: "Process Error Details")
        
        // This should fail as intended
        #expect(process.terminationStatus != 0)
    }
    
    @Test("Shell command execution", .tags(.attachmentTests, .integration))
    func shellCommandExecution() async throws {
        // Test shell command execution patterns used in VibeTunnel
        Attachment.record("""
            Test: Shell Command Execution
            Command: ls /tmp
            Expected: Successful directory listing
            """, named: "Shell Test Configuration")
        
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/sh")
        process.arguments = ["-c", "ls /tmp | head -5"]
        
        let outputPipe = Pipe()
        let errorPipe = Pipe()
        process.standardOutput = outputPipe
        process.standardError = errorPipe
        
        try process.run()
        process.waitUntilExit()
        
        // Capture both output and error streams
        let output = String(data: outputPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        let error = String(data: errorPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        
        Attachment.record("""
            Exit Status: \(process.terminationStatus)
            Standard Output:
            \(output)
            Standard Error:
            \(error.isEmpty ? "(none)" : error)
            """, named: "Shell Execution Results")
        
        #expect(process.terminationStatus == 0)
    }
    
    @Test("Network command validation", .tags(.attachmentTests, .requiresNetwork), .enabled(if: TestConditions.hasNetworkInterfaces()))
    func networkCommandValidation() async throws {
        // Test network-related commands that VibeTunnel might use
        Attachment.record("""
            Test: Network Command Validation
            Command: ifconfig -a
            Purpose: Validate network interface enumeration
            """, named: "Network Command Test")
        
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/sbin/ifconfig")
        process.arguments = ["-a"]
        
        let pipe = Pipe()
        process.standardOutput = pipe
        
        try process.run()
        process.waitUntilExit()
        
        let output = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        
        Attachment.record("""
            Exit Status: \(process.terminationStatus)
            Output Length: \(output.count) characters
            Contains 'lo0': \(output.contains("lo0"))
            Contains 'en0': \(output.contains("en0"))
            """, named: "Network Interface Information")
        
        #expect(process.terminationStatus == 0)
    }
}

// MARK: - Process Error Types

enum ProcessError: Error, LocalizedError {
    case nonZeroExit(Int32)
    case unexpectedSuccess
    case shellCommandFailed(Int32, String)
    case networkCommandFailed(Int32)
    
    var errorDescription: String? {
        switch self {
        case .nonZeroExit(let code):
            return "Process exited with non-zero status: \(code)"
        case .unexpectedSuccess:
            return "Process succeeded when failure was expected"
        case .shellCommandFailed(let code, let error):
            return "Shell command failed with status \(code): \(error)"
        case .networkCommandFailed(let code):
            return "Network command failed with status \(code)"
        }
    }
}