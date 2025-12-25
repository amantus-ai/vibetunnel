import Foundation
import Testing

@Suite("API Error Handling Tests", .tags(.critical, .networking))
struct APIErrorTests {
    // MARK: - Network Error Scenarios

    @Test("Network timeout error handling")
    func networkTimeout() {
        enum APIError: Error, Equatable {
            case networkError(URLError)
            case noServerConfigured

            var localizedDescription: String {
                switch self {
                case let .networkError(urlError):
                    switch urlError.code {
                    case .timedOut:
                        "Connection timed out"
                    case .notConnectedToInternet:
                        "No internet connection"
                    case .cannotFindHost:
                        "Cannot find server - check the address"
                    case .cannotConnectToHost:
                        "Cannot connect to server - is it running?"
                    case .networkConnectionLost:
                        "Network connection lost"
                    default:
                        urlError.localizedDescription
                    }
                case .noServerConfigured:
                    "No server configured"
                }
            }
        }

        let timeoutError = APIError.networkError(URLError(.timedOut))
        #expect(timeoutError.localizedDescription == "Connection timed out")

        let noInternetError = APIError.networkError(URLError(.notConnectedToInternet))
        #expect(noInternetError.localizedDescription == "No internet connection")

        let hostNotFoundError = APIError.networkError(URLError(.cannotFindHost))
        #expect(hostNotFoundError.localizedDescription == "Cannot find server - check the address")
    }

    @Test("HTTP status code error mapping")
    func hTTPStatusErrors() {
        struct ServerError {
            let code: Int
            let message: String?

            var description: String {
                if let message {
                    return message
                }
                switch self.code {
                case 400: return "Bad request - check your input"
                case 401: return "Unauthorized - authentication required"
                case 403: return "Forbidden - access denied"
                case 404: return "Not found - endpoint doesn't exist"
                case 409: return "Conflict - resource already exists"
                case 422: return "Unprocessable entity - validation failed"
                case 429: return "Too many requests - rate limit exceeded"
                case 500: return "Server error - internal server error"
                case 502: return "Bad gateway - server is down"
                case 503: return "Service unavailable"
                default: return "Server error: \(self.code)"
                }
            }
        }

        // Test common HTTP errors
        #expect(ServerError(code: 400, message: nil).description == "Bad request - check your input")
        #expect(ServerError(code: 401, message: nil).description == "Unauthorized - authentication required")
        #expect(ServerError(code: 404, message: nil).description == "Not found - endpoint doesn't exist")
        #expect(ServerError(code: 429, message: nil).description == "Too many requests - rate limit exceeded")
        #expect(ServerError(code: 500, message: nil).description == "Server error - internal server error")

        // Test custom error message takes precedence
        #expect(ServerError(code: 404, message: "Session not found").description == "Session not found")

        // Test unknown status code
        #expect(ServerError(code: 418, message: nil).description == "Server error: 418")
    }

    @Test("Error response body parsing")
    func errorResponseParsing() throws {
        // Standard error format
        struct ErrorResponse: Codable {
            let error: String?
            let message: String?
            let details: String?
            let code: String?
        }

        // Test various error response formats
        let errorFormats = [
            // Format 1: Simple error field
            """
            {"error": "Invalid session ID"}
            """,
            // Format 2: Message field
            """
            {"message": "Authentication failed", "code": "AUTH_FAILED"}
            """,
            // Format 3: Detailed error
            """
            {"error": "Validation error", "details": "Field 'command' is required"}
            """,
            // Format 4: All fields
            """
            {"error": "Request failed", "message": "Invalid input", "details": "Missing required fields", "code": "VALIDATION_ERROR"}
            """,
        ]

        for json in errorFormats {
            let data = json.data(using: .utf8)!
            let response = try JSONDecoder().decode(ErrorResponse.self, from: data)

            // Verify at least one error field is present
            let hasError = response.error != nil || response.message != nil || response.details != nil
            #expect(hasError == true)
        }
    }

    // MARK: - Decoding Error Scenarios

    @Test("Invalid JSON response handling")
    func invalidJSONResponse() {
        let invalidResponses = [
            "", // Empty response
            "not json", // Plain text
            "{invalid json}", // Malformed JSON
            "null", // Null response
            "undefined", // JavaScript undefined
            "<html>404 Not Found</html>", // HTML error page
        ]

        for response in invalidResponses {
            let data = response.data(using: .utf8) ?? Data()

            // Attempt to decode as array of sessions
            struct Session: Codable {
                let id: String
                let command: String
            }

            do {
                _ = try JSONDecoder().decode([Session].self, from: data)
                Issue.record("Should have thrown decoding error for: \(response)")
            } catch {
                // Expected to fail
                #expect(error is DecodingError)
            }
        }
    }

    @Test("Partial JSON response handling")
    func partialJSONResponse() throws {
        // Session with missing required fields
        let partialSession = """
        {
            "id": "test-123"
        }
        """

        struct Session: Codable {
            let id: String
            let command: String
            let workingDir: String
            let status: String
            let startedAt: String
        }

        let data = partialSession.data(using: .utf8)!

        #expect(throws: DecodingError.self) {
            try JSONDecoder().decode(Session.self, from: data)
        }
    }

    // MARK: - Request Validation

    @Test("Invalid request parameters")
    func invalidRequestParameters() {
        // Test session creation with invalid data
        struct SessionCreateRequest {
            let command: [String]
            let workingDir: String
            let cols: Int?
            let rows: Int?

            func validate() -> String? {
                if self.command.isEmpty {
                    return "Command cannot be empty"
                }
                if self.command.first?.isEmpty == true {
                    return "Command cannot be empty string"
                }
                if self.workingDir.isEmpty {
                    return "Working directory cannot be empty"
                }
                if let cols, cols <= 0 {
                    return "Terminal width must be positive"
                }
                if let rows, rows <= 0 {
                    return "Terminal height must be positive"
                }
                return nil
            }
        }

        // Test various invalid inputs
        let invalidRequests = [
            SessionCreateRequest(command: [], workingDir: "/tmp", cols: 80, rows: 24),
            SessionCreateRequest(command: [""], workingDir: "/tmp", cols: 80, rows: 24),
            SessionCreateRequest(command: ["bash"], workingDir: "", cols: 80, rows: 24),
            SessionCreateRequest(command: ["bash"], workingDir: "/tmp", cols: 0, rows: 24),
            SessionCreateRequest(command: ["bash"], workingDir: "/tmp", cols: 80, rows: -1),
        ]

        for request in invalidRequests {
            #expect(request.validate() != nil)
        }

        // Valid request should pass
        let validRequest = SessionCreateRequest(command: ["bash"], workingDir: "/tmp", cols: 80, rows: 24)
        #expect(validRequest.validate() == nil)
    }

    // MARK: - Connection State Errors

    @Test("No server configured error")
    func noServerConfiguredError() {
        enum APIError: Error {
            case noServerConfigured
            case invalidURL

            var localizedDescription: String {
                switch self {
                case .noServerConfigured:
                    "No server configured. Please connect to a server first."
                case .invalidURL:
                    "Invalid server URL"
                }
            }
        }

        let error = APIError.noServerConfigured
        #expect(error.localizedDescription.contains("No server configured"))
    }

    @Test("Empty response handling")
    func emptyResponseHandling() throws {
        // Some endpoints return 204 No Content
        let emptyData = Data()

        // For endpoints that should return data
        struct SessionListResponse: Codable {
            let sessions: [Session]

            struct Session: Codable {
                let id: String
            }
        }

        // Empty data should throw when expecting content
        #expect(throws: DecodingError.self) {
            try JSONDecoder().decode(SessionListResponse.self, from: emptyData)
        }

        // But empty array is valid
        let emptyArrayData = "[]".data(using: .utf8)!
        let sessions = try JSONDecoder().decode([SessionListResponse.Session].self, from: emptyArrayData)
        #expect(sessions.isEmpty)
    }

    // MARK: - Retry Logic

    @Test("Retry behavior for transient errors")
    func retryLogic() {
        struct RetryPolicy {
            let maxAttempts: Int
            let retryableErrors: Set<Int>

            func shouldRetry(attempt: Int, statusCode: Int) -> Bool {
                attempt < self.maxAttempts && self.retryableErrors.contains(statusCode)
            }

            func delayForAttempt(_ attempt: Int) -> TimeInterval {
                // Exponential backoff: 1s, 2s, 4s, 8s...
                pow(2.0, Double(attempt - 1))
            }
        }

        let policy = RetryPolicy(
            maxAttempts: 3,
            retryableErrors: [408, 429, 502, 503, 504], // Timeout, rate limit, gateway errors
        )

        // Should retry on retryable errors
        #expect(policy.shouldRetry(attempt: 1, statusCode: 503) == true)
        #expect(policy.shouldRetry(attempt: 2, statusCode: 429) == true)

        // Should not retry on non-retryable errors
        #expect(policy.shouldRetry(attempt: 1, statusCode: 404) == false)
        #expect(policy.shouldRetry(attempt: 1, statusCode: 401) == false)

        // Should stop after max attempts
        #expect(policy.shouldRetry(attempt: 3, statusCode: 503) == false)

        // Test backoff delays
        #expect(policy.delayForAttempt(1) == 1.0)
        #expect(policy.delayForAttempt(2) == 2.0)
        #expect(policy.delayForAttempt(3) == 4.0)
    }

    // MARK: - Edge Cases

    @Test("Unicode and special characters in errors")
    func unicodeErrorMessages() throws {
        let errorMessages = [
            "Error: File not found 文件未找到",
            "❌ Operation failed",
            "Error: Path contains invalid characters: /tmp/test-file",
            "Session 'test—session' not found", // em dash
            "Invalid input: 🚫",
        ]

        struct ErrorResponse: Codable {
            let error: String
        }

        for message in errorMessages {
            let json = """
            {"error": "\(message.replacingOccurrences(of: "\"", with: "\\\""))"}
            """

            let data = json.data(using: .utf8)!
            let response = try JSONDecoder().decode(ErrorResponse.self, from: data)
            #expect(response.error == message)
        }
    }

    @Test("Concurrent error handling")
    func concurrentErrors() async {
        // Simulate multiple concurrent API calls failing
        actor ErrorCollector {
            private var errors: [String] = []

            func addError(_ error: String) {
                self.errors.append(error)
            }

            func getErrors() -> [String] {
                self.errors
            }
        }

        let collector = ErrorCollector()

        // Simulate concurrent operations
        await withTaskGroup(of: Void.self) { group in
            for i in 1...5 {
                group.addTask {
                    // Simulate API call and error
                    let error = "Error from request \(i)"
                    await collector.addError(error)
                }
            }
        }

        let errors = await collector.getErrors()
        #expect(errors.count == 5)
    }
}
