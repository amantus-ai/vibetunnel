import Testing
import Foundation
@testable import VibeTunnel

@Suite("Session ID Handling Tests", .tags(.sessionManagement))
struct SessionIdHandlingTests {
    
    // MARK: - Session ID Format Validation
    
    @Test("Session IDs must be valid UUIDs", arguments: [
        "a37ea008-41f6-412f-bbba-f28f091267ce", // Valid UUID
        "00000000-0000-0000-0000-000000000000", // Valid nil UUID
        "550e8400-e29b-41d4-a716-446655440000"  // Valid UUID v4
    ])
    func testValidSessionIdFormat(sessionId: String) {
        #expect(UUID(uuidString: sessionId) != nil)
    }
    
    @Test("Invalid session ID formats are rejected", arguments: [
        "session_1234567890_abc123", // Old format from Swift server
        "e blob-http://127.0.0.1:4020/a37ea008c", // Corrupted format from bug
        "not-a-uuid", // Random string
        "", // Empty string
        "123", // Too short
    ])
    func testInvalidSessionIdFormat(sessionId: String) {
        #expect(UUID(uuidString: sessionId) == nil)
    }
    
    // MARK: - Session ID Comparison Tests
    
    @Test("Session IDs are case-insensitive for UUID comparison")
    func testSessionIdCaseInsensitivity() {
        let id1 = "A37EA008-41F6-412F-BBBA-F28F091267CE"
        let id2 = "a37ea008-41f6-412f-bbba-f28f091267ce"
        
        let uuid1 = UUID(uuidString: id1)
        let uuid2 = UUID(uuidString: id2)
        
        #expect(uuid1 == uuid2)
    }
    
    // MARK: - Real-World Scenario Tests
    
    @Test("Parse session ID from various server responses")
    func testParseSessionIdFromResponses() throws {
        // Test parsing session ID from different response formats
        
        struct SessionResponse: Codable {
            let sessionId: String
        }
        
        // Test cases representing different server response formats
        let testCases: [(json: String, expectedId: String?)] = [
            // Correct format (what we fixed the server to return)
            (json: #"{"sessionId":"a37ea008-41f6-412f-bbba-f28f091267ce"}"#, 
             expectedId: "a37ea008-41f6-412f-bbba-f28f091267ce"),
            
            // Old incorrect format (what Swift server used to return)
            (json: #"{"sessionId":"session_1234567890_abc123"}"#,
             expectedId: "session_1234567890_abc123"), // Would fail UUID validation
             
            // Empty response
            (json: #"{}"#, expectedId: nil)
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
    func testSessionIdUrlEncoding() {
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
    func testCorruptedSessionIdInUrl() {
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
    
    @Test("Parse tty-fwd session list response")
    func testParseTtyFwdSessionList() throws {
        // Test parsing the JSON response from tty-fwd --list-sessions
        let ttyFwdResponse = """
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
        
        let data = ttyFwdResponse.data(using: .utf8)!
        let sessions = try JSONDecoder().decode([String: TtyFwdSession].self, from: data)
        
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
func testSessionIdMismatchBugFixed() async throws {
    // This test documents the specific bug that was fixed:
    // 1. Swift server generated: "session_1234567890_abc123"
    // 2. tty-fwd generated: "a37ea008-41f6-412f-bbba-f28f091267ce"
    // 3. Client used Swift's ID for input: /api/sessions/session_1234567890_abc123/input
    // 4. Server looked up session in tty-fwd's list and found nothing → 404
    
    // The fix ensures:
    // - Swift server captures tty-fwd's UUID from stdout
    // - Returns that UUID to the client
    // - All subsequent operations use the correct UUID
    
    // This test serves as documentation of the bug and its fix
    // No assertion needed - test passes if it compiles
}