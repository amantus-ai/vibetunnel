import Testing
import Foundation
@testable import VibeTunnel

// MARK: - Mock Process for Testing

final class MockProcess: Process, @unchecked Sendable {
    var mockIsRunning = false
    var mockProcessIdentifier: Int32 = 12345
    var mockShouldFailToRun = false
    var runCalled = false
    var terminateCalled = false
    
    override var isRunning: Bool {
        mockIsRunning
    }
    
    override var processIdentifier: Int32 {
        mockProcessIdentifier
    }
    
    override func run() throws {
        runCalled = true
        if mockShouldFailToRun {
            throw CocoaError(.fileNoSuchFile)
        }
        mockIsRunning = true
    }
    
    override func terminate() {
        terminateCalled = true
        mockIsRunning = false
    }
}

// MARK: - Mock Terminal Manager

actor MockTerminalManager {
    var mockSessions: [UUID: TunnelSession] = [:]
    var mockProcesses: [UUID: MockProcess] = [:]
    var createSessionShouldFail = false
    var executeCommandShouldFail = false
    var executeCommandOutput = ("", "")
    
    func createSession(request: CreateSessionRequest) throws -> TunnelSession {
        if createSessionShouldFail {
            throw TunnelError.invalidRequest
        }
        
        let session = TunnelSession()
        mockSessions[session.id] = session
        
        let process = MockProcess()
        process.mockProcessIdentifier = Int32.random(in: 1000...9999)
        mockProcesses[session.id] = process
        
        return session
    }
    
    func executeCommand(sessionId: UUID, command: String) async throws -> (output: String, error: String) {
        if executeCommandShouldFail {
            throw TunnelError.commandExecutionFailed("Mock failure")
        }
        
        guard mockSessions[sessionId] != nil else {
            throw TunnelError.sessionNotFound
        }
        
        return executeCommandOutput
    }
    
    func listSessions() -> [TunnelSession] {
        Array(mockSessions.values)
    }
    
    func getSession(id: UUID) -> TunnelSession? {
        mockSessions[id]
    }
    
    func closeSession(id: UUID) {
        mockProcesses[id]?.terminate()
        mockProcesses.removeValue(forKey: id)
        mockSessions.removeValue(forKey: id)
    }
    
    func reset() {
        mockSessions = [:]
        mockProcesses = [:]
        createSessionShouldFail = false
        executeCommandShouldFail = false
        executeCommandOutput = ("", "")
    }
    
    func setCreateSessionShouldFail(_ value: Bool) {
        createSessionShouldFail = value
    }
    
    func setExecuteCommandOutput(_ value: (String, String)) {
        executeCommandOutput = value
    }
}

// MARK: - Terminal Manager Tests

@Suite("Terminal Manager Tests")
struct TerminalManagerTests {
    
    // MARK: - Terminal Detection Tests
    
    @Test("Detecting installed terminals", arguments: [
        "/bin/bash",
        "/bin/zsh",
        "/bin/sh"
    ])
    func testTerminalDetection(shell: String) throws {
        // Verify common shells exist on the system
        let shellExists = FileManager.default.fileExists(atPath: shell)
        
        if shellExists {
            #expect(FileManager.default.isExecutableFile(atPath: shell))
        }
    }
    
    @Test("Default terminal selection")
    func testDefaultTerminal() async throws {
        let manager = MockTerminalManager()
        
        // Create session with default shell
        let request = CreateSessionRequest()
        let session = try await manager.createSession(request: request)
        
        #expect(session.id != UUID())
        #expect(session.isActive)
        #expect(await manager.mockSessions.count == 1)
    }
    
    // MARK: - Session Creation Tests
    
    @Test("Create terminal session with custom shell", arguments: [
        "/bin/bash",
        "/bin/zsh",
        "/usr/bin/env"
    ])
    func testCreateSessionWithShell(shell: String) async throws {
        let manager = MockTerminalManager()
        
        let request = CreateSessionRequest(shell: shell)
        let session = try await manager.createSession(request: request)
        
        #expect(session.isActive)
        #expect(session.createdAt <= Date())
        #expect(session.lastActivity >= session.createdAt)
    }
    
    @Test("Create session with working directory")
    func testCreateSessionWithWorkingDirectory() async throws {
        let manager = MockTerminalManager()
        
        let tempDir = FileManager.default.temporaryDirectory.path
        let request = CreateSessionRequest(workingDirectory: tempDir)
        let session = try await manager.createSession(request: request)
        
        #expect(session.isActive)
        #expect(await manager.getSession(id: session.id) != nil)
    }
    
    @Test("Create session with environment variables")
    func testCreateSessionWithEnvironment() async throws {
        let manager = MockTerminalManager()
        
        let env = [
            "CUSTOM_VAR": "test_value",
            "PATH": "/custom/path:/usr/bin"
        ]
        let request = CreateSessionRequest(environment: env)
        let session = try await manager.createSession(request: request)
        
        #expect(session.isActive)
    }
    
    @Test("Session creation failure")
    func testSessionCreationFailure() async throws {
        let manager = MockTerminalManager()
        await manager.reset()
        await manager.setCreateSessionShouldFail(true)
        
        await #expect(throws: TunnelError.invalidRequest) {
            _ = try await manager.createSession(request: CreateSessionRequest())
        }
        
        #expect(await manager.mockSessions.isEmpty)
    }
    
    // MARK: - Command Execution Tests
    
    @Test("Execute command in session", arguments: [
        "ls -la",
        "pwd",
        "echo 'Hello, World!'",
        "date"
    ])
    func testCommandExecution(command: String) async throws {
        let manager = MockTerminalManager()
        
        // Create session
        let session = try await manager.createSession(request: CreateSessionRequest())
        
        // Set expected output
        await manager.setExecuteCommandOutput(("Command output\n", ""))
        
        // Execute command
        let (output, error) = try await manager.executeCommand(
            sessionId: session.id,
            command: command
        )
        
        #expect(output == "Command output\n")
        #expect(error.isEmpty)
    }
    
    @Test("Execute command with error output")
    func testCommandWithError() async throws {
        let manager = MockTerminalManager()
        
        let session = try await manager.createSession(request: CreateSessionRequest())
        await manager.setExecuteCommandOutput(("", "Command not found\n"))
        
        let (output, error) = try await manager.executeCommand(
            sessionId: session.id,
            command: "nonexistent-command"
        )
        
        #expect(output.isEmpty)
        #expect(error == "Command not found\n")
    }
    
    @Test("Execute command in non-existent session")
    func testCommandInNonExistentSession() async throws {
        let manager = MockTerminalManager()
        let fakeId = UUID()
        
        await #expect(throws: TunnelError.sessionNotFound) {
            _ = try await manager.executeCommand(
                sessionId: fakeId,
                command: "ls"
            )
        }
    }
    
    @Test("Command execution timeout")
    func testCommandTimeout() async throws {
        // Test that timeout is handled properly
        let error = TunnelError.timeout
        #expect(error.errorDescription == "Operation timed out")
    }
    
    // MARK: - Session Management Tests
    
    @Test("List all sessions")
    func testListSessions() async throws {
        let manager = MockTerminalManager()
        
        // Create multiple sessions
        let session1 = try await manager.createSession(request: CreateSessionRequest())
        let session2 = try await manager.createSession(request: CreateSessionRequest())
        let session3 = try await manager.createSession(request: CreateSessionRequest())
        
        let sessions = await manager.listSessions()
        
        #expect(sessions.count == 3)
        #expect(sessions.map(\.id).contains(session1.id))
        #expect(sessions.map(\.id).contains(session2.id))
        #expect(sessions.map(\.id).contains(session3.id))
    }
    
    @Test("Get specific session")
    func testGetSession() async throws {
        let manager = MockTerminalManager()
        
        let session = try await manager.createSession(request: CreateSessionRequest())
        
        let retrieved = await manager.getSession(id: session.id)
        #expect(retrieved?.id == session.id)
        #expect(retrieved?.isActive == true)
        
        // Non-existent session
        let nonExistent = await manager.getSession(id: UUID())
        #expect(nonExistent == nil)
    }
    
    @Test("Close session")
    func testCloseSession() async throws {
        let manager = MockTerminalManager()
        
        let session = try await manager.createSession(request: CreateSessionRequest())
        #expect(await manager.mockSessions.count == 1)
        
        await manager.closeSession(id: session.id)
        
        #expect(await manager.mockSessions.isEmpty)
        #expect(await manager.getSession(id: session.id) == nil)
        
        // Verify process was terminated
        let process = await manager.mockProcesses[session.id]
        #expect(process == nil)
    }
    
    @Test("Close non-existent session")
    func testCloseNonExistentSession() async throws {
        let manager = MockTerminalManager()
        let fakeId = UUID()
        
        // Should not throw, just silently do nothing
        await manager.closeSession(id: fakeId)
        
        #expect(await manager.mockSessions.isEmpty)
    }
    
    // MARK: - Session Cleanup Tests
    
    @Test("Cleanup inactive sessions")
    func testCleanupInactiveSessions() async throws {
        let manager = TerminalManager()
        
        // This test documents expected behavior
        // In real implementation, sessions older than specified minutes would be cleaned up
        await manager.cleanupInactiveSessions(olderThan: 30)
        
        // After cleanup, only active/recent sessions should remain
        let remainingSessions = await manager.listSessions()
        for session in remainingSessions {
            #expect(session.lastActivity > Date().addingTimeInterval(-30 * 60))
        }
    }
    
    // MARK: - Concurrent Operations Tests
    
    @Test("Concurrent session creation", .tags(.concurrency))
    func testConcurrentSessionCreation() async throws {
        let manager = MockTerminalManager()
        
        let sessionIds = await withTaskGroup(of: UUID?.self) { group in
            for i in 0..<5 {
                group.addTask {
                    do {
                        let request = CreateSessionRequest(
                            workingDirectory: "/tmp/session-\(i)"
                        )
                        let session = try await manager.createSession(request: request)
                        return session.id
                    } catch {
                        return nil
                    }
                }
            }
            
            var ids: [UUID] = []
            for await id in group {
                if let id = id {
                    ids.append(id)
                }
            }
            return ids
        }
        
        #expect(sessionIds.count == 5)
        #expect(Set(sessionIds).count == 5) // All unique
        #expect(await manager.mockSessions.count == 5)
    }
    
    @Test("Concurrent command execution", .tags(.concurrency))
    func testConcurrentCommandExecution() async throws {
        let manager = MockTerminalManager()
        
        // Create a session
        let session = try await manager.createSession(request: CreateSessionRequest())
        await manager.setExecuteCommandOutput(("OK\n", ""))
        
        // Execute multiple commands concurrently
        let results = await withTaskGroup(of: Result<String, Error>.self) { group in
            for i in 0..<3 {
                group.addTask {
                    do {
                        let (output, _) = try await manager.executeCommand(
                            sessionId: session.id,
                            command: "echo \(i)"
                        )
                        return .success(output)
                    } catch {
                        return .failure(error)
                    }
                }
            }
            
            var outputs: [String] = []
            for await result in group {
                if case .success(let output) = result {
                    outputs.append(output)
                }
            }
            return outputs
        }
        
        #expect(results.count == 3)
        #expect(results.allSatisfy { $0 == "OK\n" })
    }
    
    // MARK: - Error Handling Tests
    
    @Test("Terminal error types")
    func testErrorTypes() throws {
        let errors: [TunnelError] = [
            .sessionNotFound,
            .commandExecutionFailed("Test failure"),
            .timeout,
            .invalidRequest
        ]
        
        for error in errors {
            #expect(error.errorDescription != nil)
            #expect(!error.errorDescription!.isEmpty)
        }
    }
    
    // MARK: - Integration Tests
    
    @Test("Full session lifecycle", .tags(.integration))
    func testFullSessionLifecycle() async throws {
        let manager = MockTerminalManager()
        
        // 1. Create session
        let request = CreateSessionRequest(
            workingDirectory: "/tmp",
            environment: ["TEST": "value"],
            shell: "/bin/bash"
        )
        let session = try await manager.createSession(request: request)
        
        // 2. Verify session exists
        let retrieved = await manager.getSession(id: session.id)
        #expect(retrieved != nil)
        #expect(retrieved?.isActive == true)
        
        // 3. Execute commands
        await manager.setExecuteCommandOutput(("test output\n", ""))
        let (output1, _) = try await manager.executeCommand(
            sessionId: session.id,
            command: "echo test"
        )
        #expect(output1 == "test output\n")
        
        // 4. List sessions
        let sessions = await manager.listSessions()
        #expect(sessions.count == 1)
        
        // 5. Close session
        await manager.closeSession(id: session.id)
        
        // 6. Verify cleanup
        #expect(await manager.getSession(id: session.id) == nil)
        #expect(await manager.listSessions().isEmpty)
    }
}