import XCTest
@testable import VibeTunnel

final class TunnelSessionTests: XCTestCase {
    
    // MARK: - TunnelSession Tests
    
    func testTunnelSessionInitialization() {
        let session = TunnelSession()
        
        XCTAssertNotNil(session.id)
        XCTAssertTrue(session.isActive)
        XCTAssertNil(session.processID)
        XCTAssertEqual(session.createdAt.timeIntervalSince1970, session.lastActivity.timeIntervalSince1970, accuracy: 1.0)
    }
    
    func testTunnelSessionWithProcessID() {
        let processID: Int32 = 12345
        let session = TunnelSession(processID: processID)
        
        XCTAssertEqual(session.processID, processID)
        XCTAssertTrue(session.isActive)
    }
    
    func testTunnelSessionUpdateActivity() {
        var session = TunnelSession()
        let originalActivity = session.lastActivity
        
        // Wait a bit to ensure time difference
        Thread.sleep(forTimeInterval: 0.1)
        
        session.updateActivity()
        
        XCTAssertGreaterThan(session.lastActivity.timeIntervalSince1970, originalActivity.timeIntervalSince1970)
    }
    
    func testTunnelSessionCodableRoundTrip() throws {
        let originalSession = TunnelSession(processID: 67890)
        originalSession.updateActivity()
        
        let encoder = JSONEncoder()
        let decoder = JSONDecoder()
        
        let data = try encoder.encode(originalSession)
        let decodedSession = try decoder.decode(TunnelSession.self, from: data)
        
        XCTAssertEqual(originalSession.id, decodedSession.id)
        XCTAssertEqual(originalSession.processID, decodedSession.processID)
        XCTAssertEqual(originalSession.isActive, decodedSession.isActive)
        XCTAssertEqual(originalSession.createdAt.timeIntervalSince1970, decodedSession.createdAt.timeIntervalSince1970, accuracy: 1.0)
        XCTAssertEqual(originalSession.lastActivity.timeIntervalSince1970, decodedSession.lastActivity.timeIntervalSince1970, accuracy: 1.0)
    }
    
    func testTunnelSessionIdentifiable() {
        let session = TunnelSession()
        
        // Test that it conforms to Identifiable
        let id: UUID = session.id
        XCTAssertNotNil(id)
    }
    
    // MARK: - CreateSessionRequest Tests
    
    func testCreateSessionRequestInitialization() {
        let request = CreateSessionRequest()
        
        XCTAssertNil(request.workingDirectory)
        XCTAssertNil(request.environment)
        XCTAssertNil(request.shell)
    }
    
    func testCreateSessionRequestWithAllFields() {
        let workingDirectory = "/path/to/working/dir"
        let environment = ["PATH": "/usr/bin", "HOME": "/home/user"]
        let shell = "/bin/zsh"
        
        let request = CreateSessionRequest(
            workingDirectory: workingDirectory,
            environment: environment,
            shell: shell
        )
        
        XCTAssertEqual(request.workingDirectory, workingDirectory)
        XCTAssertEqual(request.environment, environment)
        XCTAssertEqual(request.shell, shell)
    }
    
    func testCreateSessionRequestCodableRoundTrip() throws {
        let originalRequest = CreateSessionRequest(
            workingDirectory: "/test/dir",
            environment: ["TEST": "value"],
            shell: "/bin/bash"
        )
        
        let encoder = JSONEncoder()
        let decoder = JSONDecoder()
        
        let data = try encoder.encode(originalRequest)
        let decodedRequest = try decoder.decode(CreateSessionRequest.self, from: data)
        
        XCTAssertEqual(originalRequest.workingDirectory, decodedRequest.workingDirectory)
        XCTAssertEqual(originalRequest.environment, decodedRequest.environment)
        XCTAssertEqual(originalRequest.shell, decodedRequest.shell)
    }
    
    func testCreateSessionRequestWithEmptyEnvironment() throws {
        let request = CreateSessionRequest(environment: [:])
        
        let data = try JSONEncoder().encode(request)
        let decoded = try JSONDecoder().decode(CreateSessionRequest.self, from: data)
        
        XCTAssertEqual(decoded.environment, [:])
    }
    
    // MARK: - CreateSessionResponse Tests
    
    func testCreateSessionResponseInitialization() {
        let sessionId = "test-session-123"
        let createdAt = Date()
        
        let response = CreateSessionResponse(sessionId: sessionId, createdAt: createdAt)
        
        XCTAssertEqual(response.sessionId, sessionId)
        XCTAssertEqual(response.createdAt, createdAt)
    }
    
    func testCreateSessionResponseCodableRoundTrip() throws {
        let originalResponse = CreateSessionResponse(
            sessionId: "response-test-456",
            createdAt: Date()
        )
        
        let encoder = JSONEncoder()
        let decoder = JSONDecoder()
        
        let data = try encoder.encode(originalResponse)
        let decodedResponse = try decoder.decode(CreateSessionResponse.self, from: data)
        
        XCTAssertEqual(originalResponse.sessionId, decodedResponse.sessionId)
        XCTAssertEqual(originalResponse.createdAt.timeIntervalSince1970, decodedResponse.createdAt.timeIntervalSince1970, accuracy: 1.0)
    }
    
    // MARK: - Edge Cases
    
    func testTunnelSessionWithSpecialCharacters() throws {
        let session = TunnelSession()
        
        let data = try JSONEncoder().encode(session)
        let jsonString = String(data: data, encoding: .utf8)!
        
        // Verify JSON contains expected fields
        XCTAssertTrue(jsonString.contains("id"))
        XCTAssertTrue(jsonString.contains("createdAt"))
        XCTAssertTrue(jsonString.contains("lastActivity"))
        XCTAssertTrue(jsonString.contains("processID"))
        XCTAssertTrue(jsonString.contains("isActive"))
    }
    
    func testCreateSessionRequestWithSpecialCharacters() throws {
        let request = CreateSessionRequest(
            workingDirectory: "/path/with spaces/and\"quotes\"",
            environment: ["PATH": "/usr/bin:/usr/local/bin", "HOME": "/home/user with spaces"],
            shell: "/bin/bash -l"
        )
        
        let data = try JSONEncoder().encode(request)
        let decoded = try JSONDecoder().decode(CreateSessionRequest.self, from: data)
        
        XCTAssertEqual(decoded.workingDirectory, "/path/with spaces/and\"quotes\"")
        XCTAssertEqual(decoded.environment?["PATH"], "/usr/bin:/usr/local/bin")
        XCTAssertEqual(decoded.environment?["HOME"], "/home/user with spaces")
        XCTAssertEqual(decoded.shell, "/bin/bash -l")
    }
    
    // MARK: - Performance Tests
    
    func testTunnelSessionEncodingPerformance() throws {
        let session = TunnelSession(processID: 12345)
        
        measure {
            for _ in 0..<1000 {
                _ = try? JSONEncoder().encode(session)
            }
        }
    }
    
    func testTunnelSessionDecodingPerformance() throws {
        let session = TunnelSession()
        let data = try JSONEncoder().encode(session)
        
        measure {
            for _ in 0..<1000 {
                _ = try? JSONDecoder().decode(TunnelSession.self, from: data)
            }
        }
    }
    
    func testCreateSessionRequestEncodingPerformance() throws {
        let request = CreateSessionRequest(
            workingDirectory: "/test/dir",
            environment: ["VAR1": "value1", "VAR2": "value2"],
            shell: "/bin/zsh"
        )
        
        measure {
            for _ in 0..<1000 {
                _ = try? JSONEncoder().encode(request)
            }
        }
    }
} 