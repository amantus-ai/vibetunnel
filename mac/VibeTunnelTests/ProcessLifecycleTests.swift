import Foundation
import Testing
@testable import VibeTunnel

// MARK: - Process Lifecycle Tests with Enhanced Attachments

@Suite("Process Lifecycle Tests", .tags(.reliability))
struct ProcessLifecycleTests {
    @Test("Basic process spawning validation", .tags(.attachmentTests))
    func basicProcessSpawning() async throws {
        let result = try await runProcessWithTimeout(
            executablePath: "/bin/echo",
            arguments: ["Hello from VibeTunnel test"],
            timeoutSeconds: 5
        )

        #expect(result.exitStatus == 0)
        #expect(!result.output.isEmpty)
    }

    @Test("Process error handling", .tags(.attachmentTests))
    func processErrorHandling() async throws {
        let result = try await runProcessWithTimeout(
            executablePath: "/bin/sh",
            arguments: ["-c", "exit 1"],
            timeoutSeconds: 5
        )

        // This should fail as intended
        #expect(result.exitStatus != 0)
    }

    @Test("Shell command execution", .tags(.attachmentTests, .integration))
    func shellCommandExecution() async throws {
        // Test shell command execution patterns used in VibeTunnel

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
        let _ = String(data: outputPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        let _ = String(data: errorPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""

        #expect(process.terminationStatus == 0)
    }

    @Test(
        "Network command validation",
        .tags(.attachmentTests, .requiresNetwork),
        .enabled(if: TestConditions.hasNetworkInterfaces())
    )
    func networkCommandValidation() async throws {
        // Test network-related commands that VibeTunnel might use

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/sbin/ifconfig")
        process.arguments = ["-a"]

        let pipe = Pipe()
        process.standardOutput = pipe

        try process.run()
        process.waitUntilExit()

        let _ = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""

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
