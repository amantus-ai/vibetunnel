import Foundation
import Testing
@testable import VibeTunnel

@Suite("APIClient Mock Tests", .tags(.critical, .networking))
struct APIClientMockTests {
    // MARK: - Session Management Tests
    
    @Test("Get sessions returns parsed sessions")
    @MainActor
    func testGetSessions() async throws {
        // Arrange
        let mockClient = MockAPIClient()
        mockClient.sessionsToReturn = [
            TestFixtures.validSession,
            TestFixtures.exitedSession
        ]
        
        // Act
        let sessions = try await mockClient.getSessions()
        
        // Assert
        #expect(mockClient.getSessionsCalled == true)
        #expect(sessions.count == 2)
        #expect(sessions[0].id == "test-session-123")
        #expect(sessions[0].isRunning == true)
        #expect(sessions[1].id == "exited-session-456")
        #expect(sessions[1].isRunning == false)
    }
    
    @Test("Get sessions handles empty response")
    @MainActor
    func getSessionsEmpty() async throws {
        // Arrange
        let mockClient = MockAPIClient()
        mockClient.sessionsToReturn = []
        
        // Act
        let sessions = try await mockClient.getSessions()
        
        // Assert
        #expect(sessions.isEmpty)
    }
    
    @Test("Get sessions handles network error")
    @MainActor
    func getSessionsNetworkError() async throws {
        // Arrange
        let mockClient = MockAPIClient()
        mockClient.shouldThrowError = true
        mockClient.errorToThrow = APIError.networkError(URLError(.notConnectedToInternet))
        
        // Act & Assert
        do {
            _ = try await mockClient.getSessions()
            Issue.record("Expected network error")
        } catch let error as APIError {
            guard case .networkError = error else {
                Issue.record("Expected network error, got \(error)")
                return
            }
        }
    }
    
    @Test("Create session sends correct request")
    @MainActor
    func testCreateSession() async throws {
        // Arrange
        let mockClient = MockAPIClient()
        let sessionData = SessionCreateData(
            command: "/bin/bash",
            workingDir: "/Users/test",
            name: "Test Session",
            cols: 80,
            rows: 24
        )
        mockClient.sessionIdToReturn = "new-session-789"
        
        // Act
        let sessionId = try await mockClient.createSession(sessionData)
        
        // Assert
        #expect(mockClient.createSessionCalled == true)
        #expect(mockClient.lastCreateData?.command == ["/bin/bash"])
        #expect(mockClient.lastCreateData?.workingDir == "/Users/test")
        #expect(mockClient.lastCreateData?.name == "Test Session")
        #expect(sessionId == "new-session-789")
    }
    
    @Test("Send input to session")
    @MainActor
    func testSendInput() async throws {
        // Arrange
        let mockClient = MockAPIClient()
        
        // Act
        try await mockClient.sendInput(sessionId: "test-123", text: "ls -la\n")
        
        // Assert
        #expect(mockClient.sendInputCalled == true)
        #expect(mockClient.lastInputSessionId == "test-123")
        #expect(mockClient.lastInputText == "ls -la\n")
    }
    
    @Test("Kill session")
    @MainActor
    func testKillSession() async throws {
        // Arrange
        let mockClient = MockAPIClient()
        
        // Act
        try await mockClient.killSession("test-123")
        
        // Assert
        #expect(mockClient.killSessionCalled == true)
        #expect(mockClient.lastKilledSessionId == "test-123")
    }
    
    @Test("Resize terminal")
    @MainActor
    func testResizeTerminal() async throws {
        // Arrange
        let mockClient = MockAPIClient()
        
        // Act
        try await mockClient.resizeTerminal(sessionId: "test-123", cols: 120, rows: 40)
        
        // Assert
        #expect(mockClient.resizeTerminalCalled == true)
        #expect(mockClient.lastResizeSessionId == "test-123")
        #expect(mockClient.lastResizeCols == 120)
        #expect(mockClient.lastResizeRows == 40)
    }
    
    @Test("Health check returns true for success")
    @MainActor
    func healthCheckSuccess() async throws {
        // Arrange
        let mockClient = MockAPIClient()
        mockClient.healthResponse = .success(true)
        
        // Act
        let isHealthy = try await mockClient.checkHealth()
        
        // Assert
        #expect(mockClient.checkHealthCalled == true)
        #expect(isHealthy == true)
    }
    
    @Test("Health check returns false for failure")
    @MainActor
    func healthCheckFailure() async throws {
        // Arrange
        let mockClient = MockAPIClient()
        mockClient.healthResponse = .success(false)
        
        // Act
        let isHealthy = try await mockClient.checkHealth()
        
        // Assert
        #expect(isHealthy == false)
    }
    
    @Test("Handles 404 error")
    @MainActor
    func handle404Error() async throws {
        // Arrange
        let mockClient = MockAPIClient()
        mockClient.sessionResponse = .failure(APIError.serverError(404, "Session not found"))
        
        // Act & Assert
        do {
            _ = try await mockClient.getSession("nonexistent")
            Issue.record("Expected error to be thrown")
        } catch let error as APIError {
            guard case .serverError(let code, let message) = error else {
                Issue.record("Expected server error, got \(error)")
                return
            }
            #expect(code == 404)
            #expect(message == "Session not found")
        }
    }
    
    @Test("Handles 401 unauthorized error")
    @MainActor
    func handle401Error() async throws {
        // Arrange
        let mockClient = MockAPIClient()
        mockClient.sessionsResponse = .failure(APIError.serverError(401, nil))
        
        // Act & Assert
        do {
            _ = try await mockClient.getSessions()
            Issue.record("Expected error to be thrown")
        } catch let error as APIError {
            guard case .serverError(let code, _) = error else {
                Issue.record("Expected server error, got \(error)")
                return
            }
            #expect(code == 401)
        }
    }
    
    @Test("Handles invalid JSON response")
    @MainActor
    func handleInvalidJSON() async throws {
        // Arrange
        let mockClient = MockAPIClient()
        let decodingError = DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "Invalid JSON"))
        mockClient.sessionsResponse = .failure(APIError.decodingError(decodingError))
        
        // Act & Assert
        do {
            _ = try await mockClient.getSessions()
            Issue.record("Expected decoding error")
        } catch let error as APIError {
            guard case .decodingError = error else {
                Issue.record("Expected decoding error, got \(error)")
                return
            }
        }
    }
    
    @Test("Handles connection timeout")
    @MainActor
    func connectionTimeout() async throws {
        // Arrange
        let mockClient = MockAPIClient()
        mockClient.sessionsResponse = .failure(APIError.networkError(URLError(.timedOut)))
        
        // Act & Assert
        do {
            _ = try await mockClient.getSessions()
            Issue.record("Expected network error")
        } catch let error as APIError {
            guard case .networkError = error else {
                Issue.record("Expected network error, got \(error)")
                return
            }
        }
    }
}