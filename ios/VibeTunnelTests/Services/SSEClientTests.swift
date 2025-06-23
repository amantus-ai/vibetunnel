import Foundation
import Testing
@testable import VibeTunnel

@Suite("SSEClient Tests", .tags(.networking, .services))
struct SSEClientTests {

    @Test("SSE client initialization")
    @MainActor
    func sseClientInit() {
        let url = URL(string: "http://localhost:8888/api/sessions/test/stream")!
        let client = SSEClient(url: url, sessionId: "test-session")

        #expect(client.url == url)
        #expect(client.sessionId == "test-session")
        #expect(client.isConnected == false)
        #expect(client.lastEventId == nil)
        #expect(client.reconnectTime == 3000)
    }

    @Test("Connection with headers")
    @MainActor
    func connectionHeaders() async throws {
        let url = URL(string: "http://localhost:8888/api/sessions/test/stream")!
        let client = SSEClient(url: url, sessionId: "test-session")

        // Create mock session
        let mockSession = MockURLSession()
        client.urlSession = mockSession

        // Connect with auth header
        let headers = ["Authorization": "Bearer test-token"]
        Task {
            await client.connect(headers: headers)
        }

        // Give it a moment to start
        try? await Task.sleep(nanoseconds: 100_000_000)

        // Verify request was made with headers
        #expect(mockSession.lastRequest?.value(forHTTPHeaderField: "Authorization") == "Bearer test-token")
        #expect(mockSession.lastRequest?.value(forHTTPHeaderField: "Accept") == "text/event-stream")
        #expect(mockSession.lastRequest?.value(forHTTPHeaderField: "Cache-Control") == "no-cache")

        // Clean up
        client.disconnect()
    }

    @Test("Event parsing - data event")
    @MainActor
    func eventParsingData() async {
        let url = URL(string: "http://localhost:8888/test")!
        let client = SSEClient(url: url, sessionId: "test")

        var receivedEvents: [SSEEvent] = []

        // Set up event handler
        client.onEvent = { event in
            receivedEvents.append(event)
        }

        // Simulate receiving SSE data
        let sseData = """
        data: {"type":"output","data":"Hello World"}

        """

        client.processSSEData(sseData)

        // Verify event was parsed correctly
        #expect(receivedEvents.count == 1)
        #expect(receivedEvents[0].data == "{\"type\":\"output\",\"data\":\"Hello World\"}")
        #expect(receivedEvents[0].event == nil)
        #expect(receivedEvents[0].id == nil)
    }

    @Test("Event parsing - named event with ID")
    @MainActor
    func eventParsingNamedWithId() async {
        let url = URL(string: "http://localhost:8888/test")!
        let client = SSEClient(url: url, sessionId: "test")

        var receivedEvents: [SSEEvent] = []

        client.onEvent = { event in
            receivedEvents.append(event)
        }

        let sseData = """
        event: terminal-update
        id: 12345
        data: {"cols":80,"rows":24}

        """

        client.processSSEData(sseData)

        #expect(receivedEvents.count == 1)
        #expect(receivedEvents[0].event == "terminal-update")
        #expect(receivedEvents[0].id == "12345")
        #expect(receivedEvents[0].data == "{\"cols\":80,\"rows\":24}")
        #expect(client.lastEventId == "12345")
    }

    @Test("Event parsing - multiline data")
    @MainActor
    func eventParsingMultiline() async {
        let url = URL(string: "http://localhost:8888/test")!
        let client = SSEClient(url: url, sessionId: "test")

        var receivedEvents: [SSEEvent] = []

        client.onEvent = { event in
            receivedEvents.append(event)
        }

        let sseData = """
        data: line1
        data: line2
        data: line3

        """

        client.processSSEData(sseData)

        #expect(receivedEvents.count == 1)
        #expect(receivedEvents[0].data == "line1\nline2\nline3")
    }

    @Test("Event parsing - comment handling")
    @MainActor
    func eventParsingComments() async {
        let url = URL(string: "http://localhost:8888/test")!
        let client = SSEClient(url: url, sessionId: "test")

        var receivedEvents: [SSEEvent] = []

        client.onEvent = { event in
            receivedEvents.append(event)
        }

        let sseData = """
        : This is a comment
        data: actual data
        : Another comment

        """

        client.processSSEData(sseData)

        // Comments should be ignored
        #expect(receivedEvents.count == 1)
        #expect(receivedEvents[0].data == "actual data")
    }

    @Test("Retry time parsing")
    @MainActor
    func retryTimeParsing() async {
        let url = URL(string: "http://localhost:8888/test")!
        let client = SSEClient(url: url, sessionId: "test")

        let sseData = """
        retry: 5000
        data: test

        """

        client.processSSEData(sseData)

        #expect(client.reconnectTime == 5000)
    }

    @Test("Connection state changes")
    @MainActor
    func connectionStateChanges() async {
        let url = URL(string: "http://localhost:8888/test")!
        let client = SSEClient(url: url, sessionId: "test")

        var stateChanges: [(Bool, Error?)] = []

        client.onConnectionStateChange = { isConnected, error in
            stateChanges.append((isConnected, error))
        }

        // Mock successful connection
        client.isConnected = true
        client.onConnectionStateChange?(true, nil)

        // Mock disconnection with error
        let error = URLError(.networkConnectionLost)
        client.isConnected = false
        client.onConnectionStateChange?(false, error)

        #expect(stateChanges.count == 2)
        #expect(stateChanges[0].0 == true)
        #expect(stateChanges[0].1 == nil)
        #expect(stateChanges[1].0 == false)
        #expect(stateChanges[1].1 != nil)
    }

    @Test("Disconnect cleanup")
    @MainActor
    func disconnectCleanup() async {
        let url = URL(string: "http://localhost:8888/test")!
        let client = SSEClient(url: url, sessionId: "test")

        // Set connected state
        client.isConnected = true

        // Disconnect
        client.disconnect()

        #expect(client.isConnected == false)
        #expect(client.dataTask == nil)
    }

    @Test("Multiple event types")
    @MainActor
    func multipleEventTypes() async {
        let url = URL(string: "http://localhost:8888/test")!
        let client = SSEClient(url: url, sessionId: "test")

        var receivedEvents: [SSEEvent] = []

        client.onEvent = { event in
            receivedEvents.append(event)
        }

        let sseData = """
        event: output
        data: Terminal output here

        event: resize
        data: {"cols":100,"rows":40}

        event: exit
        data: {"code":0}

        """

        client.processSSEData(sseData)

        #expect(receivedEvents.count == 3)
        #expect(receivedEvents[0].event == "output")
        #expect(receivedEvents[1].event == "resize")
        #expect(receivedEvents[2].event == "exit")
    }
}

// MARK: - Mock URLSession for testing

class MockURLSession: URLSession {
    var lastRequest: URLRequest?
    var mockDataTask = MockURLSessionDataTask()

    override func dataTask(with request: URLRequest) -> URLSessionDataTask {
        lastRequest = request
        return mockDataTask
    }
}

class MockURLSessionDataTask: URLSessionDataTask {
    private var _state = URLSessionTask.State.suspended

    override var state: URLSessionTask.State {
        return _state
    }

    override func resume() {
        _state = .running
    }

    override func cancel() {
        _state = .canceling
    }
}
