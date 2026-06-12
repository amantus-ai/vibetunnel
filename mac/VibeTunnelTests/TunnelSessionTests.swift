import Foundation
import Testing
@testable import VibeTunnel

@Suite("TunnelSession & Related Types")
struct TunnelSessionTests {
    // MARK: - TunnelSession Logic Tests

    // Only testing actual logic, not property synthesis

    @Test
    func updateactivityUpdatesLastactivityTimestamp() async throws {
        var session = TunnelSession()
        let originalActivity = session.lastActivity

        // Use async sleep instead of Thread.sleep
        try await Task.sleep(for: .milliseconds(100))

        session.updateActivity()

        #expect(session.lastActivity > originalActivity)
    }

    @Test
    func tunnelsessionIsCodableWithAllFields() throws {
        var originalSession = TunnelSession(processID: 67890)
        originalSession.updateActivity()

        let data = try JSONEncoder().encode(originalSession)
        let decodedSession = try JSONDecoder().decode(TunnelSession.self, from: data)

        #expect(originalSession.id == decodedSession.id)
        #expect(originalSession.processID == decodedSession.processID)
        #expect(originalSession.isActive == decodedSession.isActive)
        // Using approximate comparison for dates due to encoding precision
        #expect(abs(originalSession.createdAt.timeIntervalSince(decodedSession.createdAt)) < 0.001)
        #expect(abs(originalSession.lastActivity.timeIntervalSince(decodedSession.lastActivity)) < 0.001)
    }

    // MARK: - CreateSessionRequest Tests

    // Testing optional field handling in Codable

    @Test
    func createsessionrequestEncodesDecodesWithAllOptionalFields() throws {
        let originalRequest = CreateSessionRequest(
            workingDirectory: "/test/dir",
            environment: ["TEST": "value", "PATH": "/usr/bin"],
            shell: "/bin/bash")

        let data = try JSONEncoder().encode(originalRequest)
        let decodedRequest = try JSONDecoder().decode(CreateSessionRequest.self, from: data)

        #expect(originalRequest.workingDirectory == decodedRequest.workingDirectory)
        #expect(originalRequest.environment == decodedRequest.environment)
        #expect(originalRequest.shell == decodedRequest.shell)
    }

    @Test
    func createsessionrequestHandlesEmptyAndNilValuesCorrectly() throws {
        // Test with empty environment (not nil)
        let requestWithEmpty = CreateSessionRequest(environment: [:])
        let data1 = try JSONEncoder().encode(requestWithEmpty)
        let decoded1 = try JSONDecoder().decode(CreateSessionRequest.self, from: data1)
        #expect(decoded1.environment == [:])

        // Test with all nils
        let requestWithNils = CreateSessionRequest()
        let data2 = try JSONEncoder().encode(requestWithNils)
        let decoded2 = try JSONDecoder().decode(CreateSessionRequest.self, from: data2)
        #expect(decoded2.workingDirectory == nil)
        #expect(decoded2.environment == nil)
        #expect(decoded2.shell == nil)
    }

    @Test
    func createsessionrequestHandlesSpecialCharactersInPathsAndEnvironment() throws {
        let request = CreateSessionRequest(
            workingDirectory: "/path/with spaces/and\"quotes\"",
            environment: ["PATH": "/usr/bin:/usr/local/bin", "HOME": "/home/user with spaces"],
            shell: "/bin/bash -l")

        let data = try JSONEncoder().encode(request)
        let decoded = try JSONDecoder().decode(CreateSessionRequest.self, from: data)

        #expect(decoded.workingDirectory == "/path/with spaces/and\"quotes\"")
        #expect(decoded.environment?["PATH"] == "/usr/bin:/usr/local/bin")
        #expect(decoded.environment?["HOME"] == "/home/user with spaces")
        #expect(decoded.shell == "/bin/bash -l")
    }

    // MARK: - CreateSessionResponse Tests

    @Test
    func createSessionResponseDecodesServerTimestampWithFractionalSeconds() throws {
        let data = Data(#"{"sessionId":"response-test-456","createdAt":"2026-06-12T06:04:18.721Z"}"#.utf8)
        let response = try JSONDecoder().decode(CreateSessionResponse.self, from: data)
        let expectedDate = try Date.ISO8601FormatStyle(includingFractionalSeconds: true)
            .parse("2026-06-12T06:04:18.721Z")

        #expect(response.sessionId == "response-test-456")
        #expect(response.createdAt == expectedDate)
    }

    @Test
    func createSessionResponseDecodesServerTimestampWithoutFractionalSeconds() throws {
        let data = Data(#"{"sessionId":"response-test-456","createdAt":"2026-06-12T06:04:18Z"}"#.utf8)
        let response = try JSONDecoder().decode(CreateSessionResponse.self, from: data)
        let expectedDate = try Date.ISO8601FormatStyle(includingFractionalSeconds: false)
            .parse("2026-06-12T06:04:18Z")

        #expect(response.createdAt == expectedDate)
    }

    @Test
    func createSessionResponseRejectsInvalidTimestamp() {
        let data = Data(#"{"sessionId":"response-test-456","createdAt":"not-a-date"}"#.utf8)

        #expect(throws: DecodingError.self) {
            try JSONDecoder().decode(CreateSessionResponse.self, from: data)
        }
    }

    @Test
    func createSessionResponseEncodesServerTimestampFormat() throws {
        let date = try Date.ISO8601FormatStyle(includingFractionalSeconds: true)
            .parse("2026-06-12T06:04:18.721Z")
        let response = CreateSessionResponse(sessionId: "response-test-456", createdAt: date)
        let data = try JSONEncoder().encode(response)
        let payload = try #require(JSONSerialization.jsonObject(with: data) as? [String: String])
        let createdAtValue = try #require(payload["createdAt"])
        let encodedDate = try Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(createdAtValue)

        #expect(payload["sessionId"] == "response-test-456")
        #expect(createdAtValue.contains("."))
        #expect(abs(date.timeIntervalSince(encodedDate)) < 0.002)
    }
}
