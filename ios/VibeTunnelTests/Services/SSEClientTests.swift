import Foundation
import Testing
@testable import VibeTunnel

// MARK: - Mock Delegate

@MainActor
class MockSSEClientDelegate: SSEClientDelegate {
    var receivedEvents: [SSEClient.SSEEvent] = []
    var lastClient: SSEClient?
    
    nonisolated func sseClient(_ client: SSEClient, didReceiveEvent event: SSEClient.SSEEvent) {
        Task { @MainActor in
            lastClient = client
            receivedEvents.append(event)
        }
    }
    
    func reset() {
        receivedEvents.removeAll()
        lastClient = nil
    }
}

@Suite("SSEClient Tests", .tags(.networking, .services))
struct SSEClientTests {

    @Test("SSE client initialization")
    @MainActor
    func sseClientInit() {
        let url = URL(string: "http://localhost:8888/api/sessions/test/stream")!
        let client = SSEClient(url: url, authenticationService: nil)

        // Test basic initialization
        #expect(client.delegate == nil)
    }

    @Test("SSE client delegate pattern")
    @MainActor
    func delegatePattern() {
        let url = URL(string: "http://localhost:8888/api/sessions/test/stream")!
        let client = SSEClient(url: url, authenticationService: nil)

        // Set up delegate
        let mockDelegate = MockSSEClientDelegate()
        client.delegate = mockDelegate

        #expect(client.delegate != nil)
    }
    
    @Test("SSE client with authentication service")
    @MainActor
    func clientWithAuth() {
        let url = URL(string: "http://localhost:8888/api/sessions/test/stream")!
        let authService = AuthenticationService(
            apiClient: APIClient.shared,
            serverConfig: TestFixtures.validServerConfig
        )
        let client = SSEClient(url: url, authenticationService: authService)

        #expect(client.delegate == nil)
    }

    @Test("SSE event enum cases", .disabled("SSEEvent is internal to SSEClient"))
    @MainActor
    func eventEnumCases() {
        // Test that we can reference the event types
        // Note: SSEEvent is internal to SSEClient, so this test validates the enum structure exists
        
        // This test is disabled because SSEEvent may not be publicly accessible
        // If needed, this would test the SSEClient.SSEEvent enum cases:
        // - .terminalOutput(timestamp: Double, type: String, data: String)
        // - .exit(exitCode: Int, sessionId: String)  
        // - .error(String)
    }

    @Test("SSE client start/stop lifecycle", .disabled("Requires network mocking"))
    @MainActor
    func startStopLifecycle() {
        let url = URL(string: "http://localhost:8888/api/sessions/test/stream")!
        let client = SSEClient(url: url, authenticationService: nil)
        
        // Test basic start/stop functionality
        // Note: These methods may trigger actual network requests, so test is disabled
        client.start()
        client.stop()
    }
}