import Foundation
import Testing
@testable import VibeTunnel

@Suite("APIClient Tests", .tags(.critical, .networking), .disabled("Needs URL session mocking setup"))
struct APIClientTests {
    let baseURL = URL(string: "http://localhost:8888")!
    var mockSession: URLSession!

    init() {
        // Set up mock URLSession
        let configuration = URLSessionConfiguration.mockConfiguration
        self.mockSession = URLSession(configuration: configuration)
    }

    // MARK: - Session Management Tests

    @Test("Get sessions returns parsed sessions")
    @MainActor
    func testGetSessions() async throws {
        // Arrange
        MockURLProtocol.requestHandler = { request in
            #expect(request.url?.path == "/api/sessions")
            #expect(request.httpMethod == "GET")

            let data = TestFixtures.sessionsJSON.data(using: .utf8)!
            return MockURLProtocol.successResponse(for: request.url!, data: data)
        }

        // Act
        let client = self.createTestClient()
        let sessions = try await client.getSessions()

        // Assert
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
        MockURLProtocol.requestHandler = { request in
            let data = "[]".data(using: .utf8)!
            return MockURLProtocol.successResponse(for: request.url!, data: data)
        }

        // Act
        let client = self.createTestClient()
        let sessions = try await client.getSessions()

        // Assert
        #expect(sessions.isEmpty)
    }

    @Test("Get sessions handles network error", .tags(.networking))
    @MainActor
    func getSessionsNetworkError() async throws {
        // Arrange
        MockURLProtocol.requestHandler = { _ in
            throw URLError(.notConnectedToInternet)
        }

        // Act & Assert
        let client = self.createTestClient()
        do {
            _ = try await client.getSessions()
            Issue.record("Expected network error")
        } catch let error as APIError {
            guard case .networkError = error else {
                Issue.record("Expected network error, got \(error)")
                return
            }
        } catch {
            Issue.record("Unexpected error type: \(error)")
        }
    }

    @Test("Create session sends correct request")
    @MainActor
    func testCreateSession() async throws {
        // Arrange
        let sessionData = SessionCreateData(
            command: "/bin/bash",
            workingDir: "/Users/test",
            name: "Test Session",
            cols: 80,
            rows: 24)

        MockURLProtocol.requestHandler = { request in
            #expect(request.url?.path == "/api/sessions")
            #expect(request.httpMethod == "POST")
            #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")

            // Verify request body
            if let body = request.httpBody,
               let decoded = try? JSONDecoder().decode(SessionCreateData.self, from: body)
            {
                #expect(decoded.command == ["/bin/bash"])
                #expect(decoded.workingDir == "/Users/test")
                #expect(decoded.name == "Test Session")
                #expect(decoded.cols == 80)
                #expect(decoded.rows == 24)
            } else {
                Issue.record("Failed to decode request body")
            }

            let responseData = TestFixtures.createSessionJSON.data(using: .utf8)!
            return MockURLProtocol.successResponse(for: request.url!, data: responseData)
        }

        // Act
        let client = self.createTestClient()
        let sessionId = try await client.createSession(sessionData)

        // Assert
        #expect(sessionId == "new-session-789")
    }

    @Test("Kill session sends DELETE request")
    @MainActor
    func testKillSession() async throws {
        // Arrange
        let sessionId = "test-session-123"

        MockURLProtocol.requestHandler = { request in
            #expect(request.url?.path == "/api/sessions/\(sessionId)")
            #expect(request.httpMethod == "DELETE")

            return MockURLProtocol.successResponse(for: request.url!, statusCode: 204)
        }

        // Act & Assert (should not throw)
        let client = self.createTestClient()
        try await client.killSession(sessionId)
    }

    @Test("Send input posts correct data")
    @MainActor
    func testSendInput() async throws {
        // Arrange
        let sessionId = "test-session-123"
        let inputText = "ls -la\n"

        MockURLProtocol.requestHandler = { request in
            #expect(request.url?.path == "/api/sessions/\(sessionId)/input")
            #expect(request.httpMethod == "POST")

            struct InputPayload: Decodable {
                let data: String
            }

            if let body = request.httpBody,
               let decoded = try? JSONDecoder().decode(InputPayload.self, from: body)
            {
                #expect(decoded.data == inputText)
            } else {
                Issue.record("Failed to decode input request body")
            }

            return MockURLProtocol.successResponse(for: request.url!, statusCode: 204)
        }

        // Act & Assert (should not throw)
        let client = self.createTestClient()
        try await client.sendInput(sessionId: sessionId, text: inputText)
    }

    @Test("Resize terminal sends correct dimensions")
    @MainActor
    func testResizeTerminal() async throws {
        // Arrange
        let sessionId = "test-session-123"
        let cols = 120
        let rows = 40

        MockURLProtocol.requestHandler = { request in
            #expect(request.url?.path == "/api/sessions/\(sessionId)/resize")
            #expect(request.httpMethod == "POST")

            struct ResizePayload: Decodable {
                let cols: Int
                let rows: Int
            }

            if let body = request.httpBody,
               let decoded = try? JSONDecoder().decode(ResizePayload.self, from: body)
            {
                #expect(decoded.cols == cols)
                #expect(decoded.rows == rows)
            } else {
                Issue.record("Failed to decode resize request body")
            }

            return MockURLProtocol.successResponse(for: request.url!, statusCode: 204)
        }

        // Act & Assert (should not throw)
        let client = self.createTestClient()
        try await client.resizeTerminal(sessionId: sessionId, cols: cols, rows: rows)
    }

    // MARK: - Error Handling Tests

    @Test("Handles 404 error correctly")
    @MainActor
    func handle404Error() async throws {
        // Arrange
        MockURLProtocol.requestHandler = { request in
            _ = TestFixtures.errorResponseJSON.data(using: .utf8)!
            return MockURLProtocol.errorResponse(
                for: request.url!,
                statusCode: 404,
                message: "Session not found")
        }

        // Act & Assert
        let client = self.createTestClient()
        do {
            _ = try await client.getSession("nonexistent")
            Issue.record("Expected error to be thrown")
        } catch let error as APIError {
            guard case let .serverError(code, message) = error else {
                Issue.record("Expected server error, got \(error)")
                return
            }
            #expect(code == 404)
            #expect(message == "Session not found")
        } catch {
            Issue.record("Unexpected error type: \(error)")
        }
    }

    @Test("Handles 401 unauthorized error")
    @MainActor
    func handle401Error() async throws {
        // Arrange
        MockURLProtocol.requestHandler = { request in
            MockURLProtocol.errorResponse(for: request.url!, statusCode: 401)
        }

        // Act & Assert
        let client = self.createTestClient()
        do {
            _ = try await client.getSessions()
            Issue.record("Expected error to be thrown")
        } catch let error as APIError {
            guard case let .serverError(code, _) = error else {
                Issue.record("Expected server error, got \(error)")
                return
            }
            #expect(code == 401)
        } catch {
            Issue.record("Unexpected error type: \(error)")
        }
    }

    @Test("Handles invalid JSON response")
    @MainActor
    func handleInvalidJSON() async throws {
        // Arrange
        MockURLProtocol.requestHandler = { request in
            let invalidData = "not json".data(using: .utf8)!
            return MockURLProtocol.successResponse(for: request.url!, data: invalidData)
        }

        // Act & Assert
        let client = self.createTestClient()
        do {
            _ = try await client.getSessions()
            Issue.record("Expected decoding error")
        } catch let error as APIError {
            guard case .decodingError = error else {
                Issue.record("Expected decoding error, got \(error)")
                return
            }
        } catch {
            Issue.record("Unexpected error type: \(error)")
        }
    }

    @Test("Handles connection timeout")
    @MainActor
    func connectionTimeout() async throws {
        // Arrange
        MockURLProtocol.requestHandler = { _ in
            throw URLError(.timedOut)
        }

        // Act & Assert
        let client = self.createTestClient()
        do {
            _ = try await client.getSessions()
            Issue.record("Expected network error")
        } catch let error as APIError {
            guard case .networkError = error else {
                Issue.record("Expected network error, got \(error)")
                return
            }
        } catch {
            Issue.record("Unexpected error type: \(error)")
        }
    }

    // MARK: - Health Check Tests

    @Test("Health check returns true for 200 response")
    @MainActor
    func healthCheckSuccess() async throws {
        // Arrange
        MockURLProtocol.requestHandler = { request in
            #expect(request.url?.path == "/api/health")
            return MockURLProtocol.successResponse(for: request.url!)
        }

        // Act
        let client = self.createTestClient()
        let isHealthy = try await client.checkHealth()

        // Assert
        #expect(isHealthy == true)
    }

    @Test("Health check returns false for error response")
    @MainActor
    func healthCheckFailure() async throws {
        // Arrange
        MockURLProtocol.requestHandler = { request in
            MockURLProtocol.errorResponse(for: request.url!, statusCode: 500)
        }

        // Act
        let client = self.createTestClient()
        let isHealthy = try await client.checkHealth()

        // Assert
        #expect(isHealthy == false)
    }

    // MARK: - Helper Methods

    @MainActor
    private func createTestClient() -> APIClient {
        // Create a test client with our mock session
        // Note: This requires modifying APIClient to accept a custom URLSession
        // For now, we'll use the shared instance and rely on MockURLProtocol
        APIClient.shared
    }
}
