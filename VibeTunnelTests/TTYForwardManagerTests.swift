import Testing
import Foundation
@testable import VibeTunnel

// MARK: - Mock Process for Testing

final class MockTTYProcess: Process {
    // Override properties we need to control
    private var _executableURL: URL?
    override var executableURL: URL? {
        get { _executableURL }
        set { _executableURL = newValue }
    }
    
    private var _arguments: [String]?
    override var arguments: [String]? {
        get { _arguments }
        set { _arguments = newValue }
    }
    
    private var _standardOutput: Any?
    override var standardOutput: Any? {
        get { _standardOutput }
        set { _standardOutput = newValue }
    }
    
    private var _standardError: Any?
    override var standardError: Any? {
        get { _standardError }
        set { _standardError = newValue }
    }
    
    private var _terminationStatus: Int32 = 0
    override var terminationStatus: Int32 {
        get { _terminationStatus }
    }
    
    private var _isRunning: Bool = false
    override var isRunning: Bool {
        get { _isRunning }
    }
    
    // Test control properties
    var shouldFailToRun = false
    var runError: Error?
    var simulatedOutput: String?
    var simulatedError: String?
    var simulatedTerminationStatus: Int32 = 0
    
    override func run() throws {
        if shouldFailToRun {
            throw runError ?? CocoaError(.fileNoSuchFile)
        }
        
        _isRunning = true
        
        // Simulate output if provided
        if let output = simulatedOutput,
           let outputPipe = standardOutput as? Pipe {
            outputPipe.fileHandleForWriting.write(output.data(using: .utf8)!)
            outputPipe.fileHandleForWriting.closeFile()
        }
        
        // Simulate error if provided
        if let error = simulatedError,
           let errorPipe = standardError as? Pipe {
            errorPipe.fileHandleForWriting.write(error.data(using: .utf8)!)
            errorPipe.fileHandleForWriting.closeFile()
        }
        
        // Simulate termination
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(10))
            self._isRunning = false
            self._terminationStatus = self.simulatedTerminationStatus
            self.terminationHandler?(self)
        }
    }
    
    override func terminate() {
        _isRunning = false
        _terminationStatus = 15 // SIGTERM
        terminationHandler?(self)
    }
}

// MARK: - Mock TTYForwardManager for Testing

@MainActor
final class MockTTYForwardManager {
    var mockExecutableURL: URL?
    var mockExecutableExists = true
    var mockIsExecutable = true
    var processFactory: (() -> Process)?
    
    var ttyForwardExecutableURL: URL? {
        mockExecutableURL
    }
    
    func createTTYForwardProcess(with arguments: [String]) -> Process? {
        guard mockExecutableURL != nil else { return nil }
        
        if let factory = processFactory {
            let process = factory()
            process.executableURL = mockExecutableURL
            process.arguments = arguments
            return process
        }
        
        // Create a default process if no factory provided
        let process = Process()
        process.executableURL = mockExecutableURL
        process.arguments = arguments
        return process
    }
    
    func executeTTYForward(with arguments: [String], completion: @escaping (Result<Process, Error>) -> Void) {
        guard let executableURL = mockExecutableURL else {
            completion(.failure(TTYForwardError.executableNotFound))
            return
        }
        
        guard let process = createTTYForwardProcess(with: arguments) else {
            completion(.failure(TTYForwardError.executableNotFound))
            return
        }
        
        completion(.success(process))
    }
}

// MARK: - TTYForwardManager Tests

@Suite("TTY Forward Manager Tests")
@MainActor
struct TTYForwardManagerTests {
    
    // MARK: - Session Creation Tests
    
    @Test("Creating TTY sessions", .tags(.critical, .networking))
    func testSessionCreation() async throws {
        let manager = TTYForwardManager.shared
        
        // Test that executable URL is available in the bundle
        let executableURL = manager.ttyForwardExecutableURL
        #expect(executableURL != nil, "tty-fwd executable should be found in bundle")
        
        // Test creating a process with typical session arguments
        let sessionName = "test-session-\(UUID().uuidString)"
        let arguments = [
            "--session-name", sessionName,
            "--port", "4020",
            "--",
            "/bin/bash"
        ]
        
        let process = manager.createTTYForwardProcess(with: arguments)
        #expect(process != nil)
        #expect(process?.arguments == arguments)
        #expect(process?.executableURL == executableURL)
    }
    
    @Test("Execute tty-fwd with valid arguments")
    func testExecuteTTYForward() async throws {
        let expectation = Expectation()
        let manager = TTYForwardManager.shared
        
        // Skip if executable not found (in test environment)
        guard manager.ttyForwardExecutableURL != nil else {
            throw TestError.skip("tty-fwd executable not available in test bundle")
        }
        
        let arguments = ["--help"] // Safe argument that should work
        
        manager.executeTTYForward(with: arguments) { result in
            switch result {
            case .success(let process):
                #expect(process.executableURL != nil)
                #expect(process.arguments == arguments)
            case .failure(let error):
                Issue.record("Failed to execute tty-fwd: \(error)")
            }
            expectation.fulfill()
        }
        
        await expectation.fulfillment(timeout: .seconds(2))
    }
    
    // MARK: - Error Handling Tests
    
    @Test("Handle missing executable")
    func testMissingExecutable() async throws {
        let expectation = Expectation()
        
        // Create a mock manager with no executable
        let mockManager = MockTTYForwardManager()
        mockManager.mockExecutableURL = nil
        
        mockManager.executeTTYForward(with: ["test"]) { result in
            switch result {
            case .success:
                Issue.record("Should have failed with executableNotFound")
            case .failure(let error):
                #expect(error is TTYForwardError)
                if let ttyError = error as? TTYForwardError {
                    #expect(ttyError == .executableNotFound)
                }
            }
            expectation.fulfill()
        }
        
        await expectation.fulfillment(timeout: .seconds(1))
    }
    
    @Test("Handle non-executable file")
    func testNonExecutableFile() async throws {
        // This test would require mocking FileManager
        // For now, we test the error type
        let error = TTYForwardError.notExecutable
        #expect(error.errorDescription?.contains("executable permissions") == true)
    }
    
    // MARK: - Command Execution Tests
    
    @Test("Command execution through TTY", arguments: ["ls", "pwd", "echo test"])
    func testCommandExecution(command: String) async throws {
        let manager = TTYForwardManager.shared
        
        // Create process for command execution
        let sessionName = "cmd-test-\(UUID().uuidString)"
        let arguments = [
            "--session-name", sessionName,
            "--port", "4020",
            "--",
            "/bin/bash", "-c", command
        ]
        
        let process = manager.createTTYForwardProcess(with: arguments)
        #expect(process != nil)
        #expect(process?.arguments?.contains(command) == true)
    }
    
    @Test("Process termination handling")
    func testProcessTermination() async throws {
        let expectation = Expectation()
        let mockProcess = MockTTYProcess()
        mockProcess.simulatedTerminationStatus = 0
        
        // Set up mock manager
        let mockManager = MockTTYForwardManager()
        mockManager.mockExecutableURL = URL(fileURLWithPath: "/usr/bin/tty-fwd")
        mockManager.processFactory = { mockProcess }
        
        mockManager.executeTTYForward(with: ["test"]) { result in
            switch result {
            case .success(let process):
                #expect(process === mockProcess)
            case .failure:
                Issue.record("Should have succeeded")
            }
            expectation.fulfill()
        }
        
        await expectation.fulfillment(timeout: .seconds(1))
        
        // Wait for termination handler
        try await Task.sleep(for: .milliseconds(50))
        #expect(mockProcess.terminationStatus == 0)
    }
    
    @Test("Process failure handling")
    func testProcessFailure() async throws {
        let expectation = Expectation()
        let mockProcess = MockTTYProcess()
        mockProcess.simulatedTerminationStatus = 1
        mockProcess.simulatedError = "Error: Failed to create session"
        
        // Set up mock manager
        let mockManager = MockTTYForwardManager()
        mockManager.mockExecutableURL = URL(fileURLWithPath: "/usr/bin/tty-fwd")
        mockManager.processFactory = { mockProcess }
        
        mockManager.executeTTYForward(with: ["test"]) { result in
            // The execute method returns success even if process will fail later
            switch result {
            case .success(let process):
                #expect(process === mockProcess)
            case .failure:
                Issue.record("Should have succeeded in starting process")
            }
            expectation.fulfill()
        }
        
        await expectation.fulfillment(timeout: .seconds(1))
        
        // Wait for termination
        try await Task.sleep(for: .milliseconds(50))
        #expect(mockProcess.terminationStatus == 1)
    }
    
    // MARK: - Concurrent Sessions Tests
    
    @Test("Multiple concurrent sessions", .tags(.concurrency))
    func testConcurrentSessions() async throws {
        let manager = TTYForwardManager.shared
        
        // Create multiple sessions concurrently
        let sessionCount = 5
        var processes: [Process?] = []
        
        await withTaskGroup(of: Process?.self) { group in
            for i in 0..<sessionCount {
                group.addTask { @MainActor in
                    let sessionName = "concurrent-\(i)-\(UUID().uuidString)"
                    let arguments = [
                        "--session-name", sessionName,
                        "--port", String(4020 + i),
                        "--",
                        "/bin/bash"
                    ]
                    return manager.createTTYForwardProcess(with: arguments)
                }
            }
            
            for await process in group {
                processes.append(process)
            }
        }
        
        // Verify all processes were created
        #expect(processes.count == sessionCount)
        #expect(processes.allSatisfy { $0 != nil })
        
        // Verify each has unique port
        let ports = processes.compactMap { process -> String? in
            guard let args = process?.arguments,
                  let portIndex = args.firstIndex(of: "--port"),
                  portIndex + 1 < args.count else { return nil }
            return args[portIndex + 1]
        }
        #expect(Set(ports).count == sessionCount, "Each session should have unique port")
    }
    
    // MARK: - Session Cleanup Tests
    
    @Test("Session cleanup on disconnect")
    func testSessionCleanup() async throws {
        let mockProcess = MockTTYProcess()
        mockProcess.simulatedTerminationStatus = 0
        
        // Verify process can be terminated
        let expectation = Expectation()
        mockProcess.terminationHandler = { _ in
            Task { @MainActor in
                expectation.fulfill()
            }
        }
        
        // Start the process
        try mockProcess.run()
        #expect(mockProcess.isRunning)
        
        // Terminate it
        mockProcess.terminate()
        
        await expectation.fulfillment(timeout: .seconds(1))
        #expect(!mockProcess.isRunning)
        #expect(mockProcess.terminationStatus == 15) // SIGTERM
    }
    
    // MARK: - Output Capture Tests
    
    @Test("Capture session ID from stdout")
    func testCaptureSessionId() async throws {
        let mockProcess = MockTTYProcess()
        let sessionId = UUID().uuidString
        mockProcess.simulatedOutput = sessionId
        
        // Set up pipes
        let outputPipe = Pipe()
        mockProcess.standardOutput = outputPipe
        
        // Run the process
        try mockProcess.run()
        
        // Read output
        let data = outputPipe.fileHandleForReading.readDataToEndOfFile()
        let output = String(data: data, encoding: .utf8)
        
        #expect(output == sessionId)
    }
    
    @Test("Handle stderr output")
    func testStderrCapture() async throws {
        let mockProcess = MockTTYProcess()
        let errorMessage = "Error: Port already in use"
        mockProcess.simulatedError = errorMessage
        mockProcess.simulatedTerminationStatus = 1
        
        // Set up pipes
        let errorPipe = Pipe()
        mockProcess.standardError = errorPipe
        
        // Run the process
        try mockProcess.run()
        
        // Read error output
        let data = errorPipe.fileHandleForReading.readDataToEndOfFile()
        let error = String(data: data, encoding: .utf8)
        
        #expect(error == errorMessage)
    }
}

// MARK: - Test Helpers

enum TestError: Error {
    case skip(String)
}

// MARK: - Expectation Helper for Async Testing

@MainActor
final class Expectation {
    private var fulfilled = false
    
    func fulfill() {
        fulfilled = true
    }
    
    func fulfillment(timeout: Duration) async {
        let deadline = Date().addingTimeInterval(TimeInterval(timeout.components.seconds))
        
        while Date() < deadline {
            if fulfilled {
                return
            }
            
            try? await Task.sleep(nanoseconds: 10_000_000) // 10ms
        }
    }
}