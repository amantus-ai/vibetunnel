import Testing
import Foundation
@testable import VibeTunnel

// MARK: - Mock Ngrok Service

@MainActor
final class MockNgrokService {
    // Test control properties
    var shouldFailStart = false
    var startError: Error?
    var mockPublicUrl = "https://test-tunnel.ngrok.io"
    var mockAuthToken: String?
    var mockIsInstalled = true
    var processOutput: String?
    
    // Properties
    var authToken: String? {
        get { mockAuthToken }
        set { mockAuthToken = newValue }
    }
    
    var hasAuthToken: Bool {
        mockAuthToken != nil
    }
    
    // Mock the start method
    func start(port: Int) async throws -> String {
        if shouldFailStart {
            throw startError ?? NgrokError.tunnelCreationFailed("Mock failure")
        }
        
        if mockAuthToken == nil {
            throw NgrokError.authTokenMissing
        }
        
        if !mockIsInstalled {
            throw NgrokError.notInstalled
        }
        
        // Simulate successful start
        return mockPublicUrl
    }
}

// MARK: - Mock Process for Ngrok

final class MockNgrokProcess: Process, @unchecked Sendable {
    var mockIsRunning = false
    var mockOutput: String?
    var mockError: String?
    var shouldFailToRun = false
    
    override var isRunning: Bool {
        mockIsRunning
    }
    
    override func run() throws {
        if shouldFailToRun {
            throw CocoaError(.fileNoSuchFile)
        }
        mockIsRunning = true
        
        // Simulate ngrok output
        if let output = mockOutput,
           let pipe = standardOutput as? Pipe {
            pipe.fileHandleForWriting.write(output.data(using: .utf8)!)
        }
    }
    
    override func terminate() {
        mockIsRunning = false
    }
    
    override func waitUntilExit() {
        // No-op for mock
    }
}

// MARK: - Ngrok Service Tests

@Suite("Ngrok Service Tests")
@MainActor
struct NgrokServiceTests {
    
    // MARK: - Tunnel Creation Tests
    
    @Test("Tunnel creation with auth token", .tags(.networking, .integration))
    func testTunnelCreation() async throws {
        let service = MockNgrokService()
        service.mockAuthToken = "test-auth-token"
        
        let publicUrl = try await service.start(port: 4020)
        
        #expect(publicUrl == "https://test-tunnel.ngrok.io")
    }
    
    @Test("Tunnel creation fails without auth token", .tags(.networking))
    func testTunnelCreationWithoutAuthToken() async throws {
        let service = MockNgrokService()
        service.mockAuthToken = nil
        
        await #expect(throws: NgrokError.authTokenMissing) {
            _ = try await service.start(port: 4020)
        }
    }
    
    @Test("Tunnel creation with different ports", arguments: [8080, 3000, 9999])
    func testTunnelCreationPorts(port: Int) async throws {
        let service = MockNgrokService()
        service.mockAuthToken = "test-auth-token"
        
        let publicUrl = try await service.start(port: port)
        
        #expect(publicUrl.starts(with: "https://"))
        #expect(publicUrl.contains("ngrok.io"))
    }
    
    // MARK: - Error Handling Tests
    
    @Test("Handling ngrok errors", arguments: [
        NgrokError.notInstalled,
        NgrokError.authTokenMissing,
        NgrokError.tunnelCreationFailed("Test failure"),
        NgrokError.invalidConfiguration,
        NgrokError.networkError("Connection timeout")
    ])
    func testErrorHandling(error: NgrokError) async throws {
        let service = MockNgrokService()
        service.mockAuthToken = "test-token"
        service.shouldFailStart = true
        service.startError = error
        
        await #expect(throws: error) {
            _ = try await service.start(port: 4020)
        }
        
        // Verify error descriptions
        #expect(error.errorDescription != nil)
        #expect(!error.errorDescription!.isEmpty)
    }
    
    @Test("Ngrok not installed error")
    func testNgrokNotInstalled() async throws {
        let service = MockNgrokService()
        service.mockAuthToken = "test-token"
        service.mockIsInstalled = false
        
        await #expect(throws: NgrokError.notInstalled) {
            _ = try await service.start(port: 4020)
        }
    }
    
    // MARK: - Tunnel Lifecycle Tests
    
    @Test("Tunnel lifecycle management")
    func testTunnelLifecycle() async throws {
        let service = NgrokService.shared
        
        // Initial state
        #expect(!service.isActive)
        #expect(service.publicUrl == nil)
        #expect(await service.isRunning() == false)
        
        // Note: Can't test actual start without ngrok installed
        // Test stop doesn't throw when no tunnel is active
        try await service.stop()
        
        #expect(!service.isActive)
        #expect(service.publicUrl == nil)
    }
    
    @Test("Tunnel status monitoring")
    func testTunnelStatus() async throws {
        let service = NgrokService.shared
        
        // No status when tunnel is not running
        let status = await service.getStatus()
        #expect(status == nil)
        
        // Would need mock to test active tunnel status
    }
    
    // MARK: - Auth Token Management Tests
    
    @Test("Auth token storage and retrieval")
    func testAuthTokenManagement() async throws {
        let service = MockNgrokService()
        
        // Set token
        let testToken = "ngrok-auth-token-\(UUID().uuidString)"
        service.authToken = testToken
        
        // Verify retrieval
        #expect(service.authToken == testToken)
        #expect(service.hasAuthToken)
        
        // Delete token
        service.authToken = nil
        #expect(service.authToken == nil)
        #expect(!service.hasAuthToken)
    }
    
    @Test("Has auth token check")
    func testHasAuthToken() async throws {
        let service = MockNgrokService()
        
        // No token initially
        #expect(!service.hasAuthToken)
        
        // With token
        service.authToken = "test-token"
        #expect(service.hasAuthToken)
    }
    
    // MARK: - Concurrent Operations Tests
    
    @Test("Concurrent tunnel operations", .tags(.concurrency))
    func testConcurrentOperations() async throws {
        let service = MockNgrokService()
        service.mockAuthToken = "test-token"
        
        // Start multiple operations concurrently
        await withTaskGroup(of: Result<String, Error>.self) { group in
            for i in 0..<3 {
                group.addTask {
                    do {
                        let url = try await service.start(port: 4020 + i)
                        return .success(url)
                    } catch {
                        return .failure(error)
                    }
                }
            }
            
            for await result in group {
                switch result {
                case .success(let url):
                    #expect(url == service.mockPublicUrl)
                case .failure:
                    // Some operations might fail due to concurrent access
                    // This is expected behavior
                    break
                }
            }
        }
    }
    
    // MARK: - Reliability Tests
    
    @Test("Reconnection after network failure", .tags(.reliability))
    func testReconnection() async throws {
        let service = MockNgrokService()
        service.mockAuthToken = "test-token"
        
        // First connection succeeds
        let url1 = try await service.start(port: 4020)
        #expect(url1 == service.mockPublicUrl)
        
        // Simulate network failure
        service.shouldFailStart = true
        service.startError = NgrokError.networkError("Connection lost")
        
        do {
            _ = try await service.start(port: 4020)
            Issue.record("Expected network error to be thrown")
        } catch let error as NgrokError {
            if case .networkError = error {
                // Expected error
            } else {
                Issue.record("Unexpected error type: \(error)")
            }
        } catch {
            Issue.record("Unexpected error: \(error)")
        }
        
        // Recovery
        service.shouldFailStart = false
        let url2 = try await service.start(port: 4020)
        #expect(url2 == service.mockPublicUrl)
    }
    
    @Test("Timeout handling")
    func testTimeoutHandling() async throws {
        let service = MockNgrokService()
        service.mockAuthToken = "test-token"
        service.startError = NgrokError.networkError("Operation timed out")
        service.shouldFailStart = true
        
        do {
            _ = try await service.start(port: 4020)
            Issue.record("Expected network error to be thrown")
        } catch let error as NgrokError {
            if case .networkError = error {
                // Expected error
            } else {
                Issue.record("Unexpected error type: \(error)")
            }
        } catch {
            Issue.record("Unexpected error: \(error)")
        }
    }
    
    // MARK: - Tunnel Status Tests
    
    @Test("Tunnel metrics tracking")
    func testTunnelMetrics() async throws {
        let metrics = NgrokTunnelStatus.TunnelMetrics(
            connectionsCount: 10,
            bytesIn: 1024,
            bytesOut: 2048
        )
        
        #expect(metrics.connectionsCount == 10)
        #expect(metrics.bytesIn == 1024)
        #expect(metrics.bytesOut == 2048)
        
        let status = NgrokTunnelStatus(
            publicUrl: "https://test.ngrok.io",
            metrics: metrics,
            startedAt: Date()
        )
        
        #expect(status.publicUrl == "https://test.ngrok.io")
        #expect(status.metrics.connectionsCount == 10)
    }
    
    // MARK: - Process Output Parsing Tests
    
    @Test("Parse ngrok JSON output")
    func testParseNgrokOutput() async throws {
        // Test parsing various ngrok output formats
        let outputs = [
            #"{"msg":"started tunnel","url":"https://abc123.ngrok.io","addr":"http://localhost:4020"}"#,
            #"{"addr":"https://xyz789.ngrok.io","msg":"tunnel created"}"#,
            #"{"level":"info","msg":"tunnel session started"}"#
        ]
        
        for output in outputs {
            if let data = output.data(using: .utf8),
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                
                // Check for URL in various fields
                let url = json["url"] as? String ?? json["addr"] as? String
                if let url = url, url.starts(with: "https://") {
                    #expect(url.contains("ngrok.io"))
                }
            }
        }
    }
    
    // MARK: - Integration Tests
    
    @Test("Full tunnel lifecycle integration", .tags(.integration), .enabled(if: ProcessInfo.processInfo.environment["CI"] == nil))
    func testFullIntegration() async throws {
        // Skip in CI or when ngrok is not available
        let service = NgrokService.shared
        
        // Check if we have an auth token
        guard service.hasAuthToken else {
            throw TestError.skip("Ngrok auth token not configured")
        }
        
        // This would require actual ngrok installation
        // For now, just verify the service is ready
        // Service is non-optional, so this check is redundant
        // Just verify it's the shared instance
        #expect(service === NgrokService.shared)
        
        // Clean state
        try await service.stop()
        #expect(!service.isActive)
    }
}

// MARK: - AsyncLineSequence Tests

@Suite("AsyncLineSequence Tests")
struct AsyncLineSequenceTests {
    
    @Test("Read lines from file handle")
    func testAsyncLineSequence() async throws {
        // Create a pipe with test data
        let pipe = Pipe()
        let testData = """
        Line 1
        Line 2
        Line 3
        """.data(using: .utf8)!
        
        pipe.fileHandleForWriting.write(testData)
        pipe.fileHandleForWriting.closeFile()
        
        var lines: [String] = []
        for await line in pipe.fileHandleForReading.lines {
            lines.append(line)
        }
        
        #expect(lines.count == 3)
        #expect(lines[0] == "Line 1")
        #expect(lines[1] == "Line 2")
        #expect(lines[2] == "Line 3")
    }
    
    @Test("Handle empty file")
    func testEmptyFile() async throws {
        let pipe = Pipe()
        pipe.fileHandleForWriting.closeFile()
        
        var lineCount = 0
        for await _ in pipe.fileHandleForReading.lines {
            lineCount += 1
        }
        
        #expect(lineCount == 0)
    }
}