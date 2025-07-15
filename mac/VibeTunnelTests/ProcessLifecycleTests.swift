import Foundation
import Testing
@testable import VibeTunnel

// MARK: - Process Lifecycle Tests with Enhanced Attachments

@Suite("Process Lifecycle Tests", .tags(.reliability))
struct ProcessLifecycleTests {
    @Test("Basic process spawning validation", .tags(.attachmentTests))
    func basicProcessSpawning() async throws {
        TestUtilities.recordTestConfiguration(
            name: "Basic Process Spawning",
            details: "Command: /bin/echo\nExpected: Clean exit with status 0"
        )

        let result = try await runProcessWithTimeout(
            executablePath: "/bin/echo",
            arguments: ["Hello from VibeTunnel test"],
            timeoutSeconds: 5
        )

        TestUtilities.recordProcessExecution(
            command: "/bin/echo",
            arguments: ["Hello from VibeTunnel test"],
            exitStatus: result.exitStatus,
            output: result.output
        )

        #expect(result.exitStatus == 0)
        #expect(!result.output.isEmpty)
    }

    @Test("Process error handling", .tags(.attachmentTests))
    func processErrorHandling() async throws {
        TestUtilities.recordTestConfiguration(
            name: "Process Error Handling",
            details: "Command: /bin/sh -c \"exit 1\"\nExpected: Exit with failure status"
        )

        let result = try await runProcessWithTimeout(
            executablePath: "/bin/sh",
            arguments: ["-c", "exit 1"],
            timeoutSeconds: 5
        )

        TestUtilities.recordProcessExecution(
            command: "/bin/sh",
            arguments: ["-c", "exit 1"],
            exitStatus: result.exitStatus
        )

        // This should fail as intended
        #expect(result.exitStatus != 0)
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

    @Test(
        "Network command validation",
        .tags(.attachmentTests, .requiresNetwork),
        .enabled(if: TestConditions.hasNetworkInterfaces())
    )
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

    // MARK: - Helper Functions

    /// Run a process with timeout protection
    private func runProcessWithTimeout(
        executablePath: String,
        arguments: [String],
        timeoutSeconds: TimeInterval
    )
        async throws -> ProcessResult
    {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executablePath)
        process.arguments = arguments

        let outputPipe = Pipe()
        let errorPipe = Pipe()
        process.standardOutput = outputPipe
        process.standardError = errorPipe

        // Start timeout task
        let timeoutTask = Task {
            try await Task.sleep(for: .seconds(timeoutSeconds))
            if process.isRunning {
                process.terminate()
                throw ProcessError.timeout
            }
        }

        // Run the process
        try process.run()
        process.waitUntilExit()
        timeoutTask.cancel()

        // Capture output
        let outputData = outputPipe.fileHandleForReading.readDataToEndOfFile()
        let errorData = errorPipe.fileHandleForReading.readDataToEndOfFile()
        let output = String(data: outputData, encoding: .utf8) ?? ""
        let errorOutput = String(data: errorData, encoding: .utf8) ?? ""

        return ProcessResult(
            exitStatus: process.terminationStatus,
            output: output.trimmingCharacters(in: .whitespacesAndNewlines),
            errorOutput: errorOutput.trimmingCharacters(in: .whitespacesAndNewlines)
        )
    }
}

// MARK: - Process Error Types

enum ProcessError: Error, LocalizedError {
    case nonZeroExit(Int32)
    case unexpectedSuccess
    case shellCommandFailed(Int32, String)
    case networkCommandFailed(Int32)
    case timeout

    var errorDescription: String? {
        switch self {
        case .nonZeroExit(let code):
            "Process exited with non-zero status: \(code)"
        case .unexpectedSuccess:
            "Process succeeded when failure was expected"
        case .shellCommandFailed(let code, let error):
            "Shell command failed with status \(code): \(error)"
        case .networkCommandFailed(let code):
            "Network command failed with status \(code)"
        case .timeout:
            "Process timed out"
        }
    }
}

// MARK: - Process Result

struct ProcessResult {
    let exitStatus: Int32
    let output: String
    let errorOutput: String
}
