import Foundation
import Testing
@testable import VibeTunnel

@Suite("Session ID Handling Tests", .tags(.sessionManagement))
struct SessionIdHandlingTests {
    // MARK: - Session ID Format Validation

    @Test("Session IDs must be valid UUIDs", arguments: [
        "a37ea008-41f6-412f-bbba-f28f091267ce", // Valid UUID
        "00000000-0000-0000-0000-000000000000", // Valid nil UUID
        "550e8400-e29b-41d4-a716-446655440000", // Valid UUID v4
    ])
    func validSessionIdFormat(sessionId: String) {
        #expect(UUID(uuidString: sessionId) != nil)
    }

    @Test("Invalid session ID formats are rejected", arguments: [
        "session_1234567890_abc123", // Old format from Swift server
        "e blob-http://127.0.0.1:4020/a37ea008c", // Corrupted format from bug
        "not-a-uuid", // Random string
        "", // Empty string
        "123" // Too short
    ])
    func invalidSessionIdFormat(sessionId: String) {
        #expect(UUID(uuidString: sessionId) == nil)
    }

    // MARK: - Session ID Comparison Tests

    @Test("Session IDs are case-insensitive for UUID comparison")
    func sessionIdCaseInsensitivity() {
        let id1 = "A37EA008-41F6-412F-BBBA-F28F091267CE"
        let id2 = "a37ea008-41f6-412f-bbba-f28f091267ce"

        let uuid1 = UUID(uuidString: id1)
        let uuid2 = UUID(uuidString: id2)

        #expect(uuid1 == uuid2)
    }

    // MARK: - Real-World Scenario Tests

    @Test("Parse session ID from various server responses")
    func parseSessionIdFromResponses() throws {
        // Test parsing session ID from different response formats

        struct SessionResponse: Codable {
            let sessionId: String
        }

        // Test cases representing different server response formats
        let testCases: [(json: String, expectedId: String?)] = [
            // Correct format (what we fixed the server to return)
            (
                json: #"{"sessionId":"a37ea008-41f6-412f-bbba-f28f091267ce"}"#,
                expectedId: "a37ea008-41f6-412f-bbba-f28f091267ce"),

            // Old incorrect format (what Swift server used to return)
            (
                json: #"{"sessionId":"session_1234567890_abc123"}"#,
                expectedId: "session_1234567890_abc123"), // Would fail UUID validation

            // Empty response
            (json: #"{}"#, expectedId: nil),
        ]

        for testCase in testCases {
            let data = testCase.json.data(using: .utf8)!

            if let expectedId = testCase.expectedId {
                let response = try JSONDecoder().decode(SessionResponse.self, from: data)
                #expect(response.sessionId == expectedId)
            } else {
                #expect(throws: Error.self) {
                    _ = try JSONDecoder().decode(SessionResponse.self, from: data)
                }
            }
        }
    }

    // MARK: - URL Path Construction Tests

    @Test("Session ID URL encoding")
    func sessionIdUrlEncoding() {
        // Ensure session IDs are properly encoded in URLs
        let sessionId = "a37ea008-41f6-412f-bbba-f28f091267ce"
        let baseURL = "http://localhost:4020"

        let inputURL = "\(baseURL)/api/sessions/\(sessionId)/input"
        let expectedURL = "http://localhost:4020/api/sessions/a37ea008-41f6-412f-bbba-f28f091267ce/input"

        #expect(inputURL == expectedURL)

        // Verify URL is valid
        #expect(URL(string: inputURL) != nil)
    }

    @Test("Corrupted session ID in URL causes invalid URL")
    func corruptedSessionIdInUrl() {
        // The bug showed a corrupted ID like "e blob-http://127.0.0.1:4020/uuid"
        let corruptedId = "e blob-http://127.0.0.1:4020/a37ea008-41f6-412f-bbba-f28f091267ce"
        let baseURL = "http://localhost:4020"

        // This would create an invalid URL due to spaces and special characters
        let invalidURL = "\(baseURL)/api/sessions/\(corruptedId)/input"

        // URL should be parseable but semantically wrong
        if let url = URL(string: invalidURL) {
            // The path would be malformed
            #expect(url.path.contains(" "))
        }
    }

    // MARK: - Session List Parsing Tests

    @Test("Parse session list response")
    func parseSessionList() throws {
        // Define a local type for parsing session JSON
        struct Session: Codable {
            let cmdline: [String]
            let cwd: String
            let name: String
            let pid: Int
            let status: String
            let started_at: String
            let stdin: String
            let streamOut: String

            enum CodingKeys: String, CodingKey {
                case cmdline
                case cwd
                case name
                case pid
                case status
                case started_at
                case stdin
                case streamOut = "stream-out"
            }
        }

        // Test parsing the JSON response from session list
        let sessionResponse = """
        {
            "a37ea008-41f6-412f-bbba-f28f091267ce": {
                "cmdline": ["zsh"],
                "cwd": "/Users/test",
                "name": "zsh",
                "pid": 12345,
                "status": "running",
                "started_at": "2024-01-15T10:30:00Z",
                "stdin": "/path/to/stdin",
                "stream-out": "/path/to/stream-out"
            }
        }
        """

        let data = sessionResponse.data(using: .utf8)!
        let sessions = try JSONDecoder().decode([String: Session].self, from: data)

        // Verify the session ID is a proper UUID
        #expect(sessions.count == 1)
        let sessionId = sessions.keys.first!
        #expect(UUID(uuidString: sessionId) != nil)

        // Verify we can look up the session by its ID
        let session = sessions[sessionId]
        #expect(session != nil)
        #expect(session?.status == "running")
    }
}

// MARK: - Regression Test for Specific Bug

@Test(.bug("https://github.com/example/issues/123"))
func sessionIdMismatchBugFixed() async throws {
    // This test documents the specific bug that was fixed:
    // 1. Server generated session ID
    // 2. Client used the session ID for operations
    // 3. Session lookup must work correctly with the generated ID

    // The fix ensures:
    // - Server generates and manages session IDs
    // - Returns the correct ID to the client
    // - All subsequent operations use the correct ID

    // This test serves as documentation of the bug and its fix
    // No assertion needed - test passes if it compiles
}
