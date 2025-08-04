import Foundation
import os.log

extension Data {
    var hexString: String {
        map { String(format: "%02hhx", $0) }.joined()
    }
}

/// Event received from an EventSource (Server-Sent Events) stream
struct Event {
    let id: String?
    let event: String?
    let data: String?
    let retry: Int?
}

/// A Swift implementation of the EventSource API for Server-Sent Events (SSE)
///
/// This class provides a way to receive server-sent events from a URL endpoint.
/// It handles automatic reconnection and follows the EventSource specification.
final class EventSource: NSObject {
    // MARK: - Properties

    private let url: URL
    private let headers: [String: String]
    private nonisolated(unsafe) var urlSession: URLSession?
    private nonisolated(unsafe) var dataTask: URLSessionDataTask?
    private let logger = Logger(subsystem: BundleIdentifiers.loggerSubsystem, category: "EventSource")

    // MARK: - Callbacks

    nonisolated(unsafe) var onOpen: (() -> Void)?
    nonisolated(unsafe) var onMessage: ((Event) -> Void)?
    nonisolated(unsafe) var onError: ((Error?) -> Void)?

    // MARK: - State

    private nonisolated(unsafe) var isConnected = false
    private nonisolated(unsafe) var buffer = ""
    private nonisolated(unsafe) var lastEventId: String?
    private nonisolated(unsafe) var reconnectTime: TimeInterval = 3.0

    // MARK: - Initialization

    init(url: URL, headers: [String: String] = [:]) {
        self.url = url
        self.headers = headers
        super.init()

        // Create a custom URLSession with streaming delegate
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 0 // No timeout for SSE
        configuration.timeoutIntervalForResource = 0
        // Disable automatic decompression for SSE streaming
        configuration.httpAdditionalHeaders = ["Accept-Encoding": "identity"]
        self.urlSession = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    }

    // MARK: - Connection Management

    func connect() {
        guard !isConnected else {
            logger.warning("Already connected, ignoring connect request")
            return
        }
        
        // Defensive check: ensure URL session is available
        guard let urlSession = self.urlSession else {
            logger.error("URLSession is not available for EventSource connection")
            DispatchQueue.main.async {
                self.onError?(URLError(.unknown))
            }
            return
        }

        var request = URLRequest(url: url)
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        request.timeoutInterval = 30.0 // Add timeout to prevent hanging connections

        // Add custom headers
        for (key, value) in headers {
            request.setValue(value, forHTTPHeaderField: key)
        }

        // Add last event ID if available
        if let lastEventId {
            request.setValue(lastEventId, forHTTPHeaderField: "Last-Event-ID")
        }

        logger.info("🔌 Connecting to EventSource: \(self.url)")
        logger.debug("Headers: \(request.allHTTPHeaderFields ?? [:])")

        dataTask = urlSession.dataTask(with: request)
        dataTask?.resume()

        logger.info("📡 EventSource dataTask started")
    }

    func disconnect() {
        isConnected = false
        dataTask?.cancel()
        dataTask = nil
        buffer = ""
        
        // Clean up URLSession if it exists
        urlSession?.invalidateAndCancel()
        urlSession = nil
        
        logger.debug("Disconnected from EventSource")
    }

    // MARK: - Event Parsing

    private func processBuffer() {
        logger.debug("🔄 Processing buffer with \(self.buffer.count) characters")
        let lines = buffer.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        var eventData: [String] = []
        var eventType: String?
        var eventId: String?
        var eventRetry: Int?

        for (index, line) in lines.enumerated() {
            // Check if this is the last line and it's not empty (incomplete line)
            if index == lines.count - 1 && !line.isEmpty && !buffer.hasSuffix("\n") {
                // Keep the incomplete line in the buffer
                buffer = line
                break
            }

            if line.isEmpty {
                // Empty line signals end of event
                if !eventData.isEmpty {
                    let data = eventData.joined(separator: "\n")
                    let event = Event(
                        id: eventId,
                        event: eventType,
                        data: data,
                        retry: eventRetry
                    )

                    // Update last event ID
                    if let id = eventId {
                        lastEventId = id
                    }

                    // Update reconnect time
                    if let retry = eventRetry {
                        reconnectTime = TimeInterval(retry) / 1_000.0
                    }

                    // Dispatch event
                    logger
                        .debug("🎯 Dispatching event - type: \(event.event ?? "default"), data: \(event.data ?? "none")")
                    
                    // Defensive check: only dispatch if we have a valid event
                    if !data.isEmpty {
                        DispatchQueue.main.async {
                            self.onMessage?(event)
                        }
                    }
                }

                // Reset for next event
                eventData = []
                eventType = nil
                eventId = nil
                eventRetry = nil
            } else if line.hasPrefix(":") {
                // Comment line, ignore
                continue
            } else if let colonIndex = line.firstIndex(of: ":") {
                let field = String(line[..<colonIndex])
                var value = String(line[line.index(after: colonIndex)...])

                // Remove leading space if present
                if value.hasPrefix(" ") {
                    value = String(value.dropFirst())
                }

                switch field {
                case "data":
                    eventData.append(value)
                case "event":
                    eventType = value
                case "id":
                    eventId = value
                case "retry":
                    eventRetry = Int(value)
                default:
                    // Ignore unknown fields
                    break
                }
            } else {
                // Line with no colon, treat entire line as field name with empty value
                if line == "data" {
                    eventData.append("")
                }
            }
        }

        // Clear buffer if we processed all complete lines
        if lines.last?.isEmpty ?? true || buffer.hasSuffix("\n") {
            buffer = ""
        }
    }
}

// MARK: - URLSessionDataDelegate

extension EventSource: URLSessionDataDelegate {
    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        logger.info("📥 URLSession didReceive response")

        guard let httpResponse = response as? HTTPURLResponse else {
            logger.error("Response is not HTTPURLResponse")
            completionHandler(.cancel)
            DispatchQueue.main.async {
                self.onError?(URLError(.badServerResponse))
            }
            return
        }

        logger.info("Response status: \(httpResponse.statusCode), headers: \(httpResponse.allHeaderFields)")

        if httpResponse.statusCode == 200 {
            // Verify content type is appropriate for SSE
            let contentType = httpResponse.value(forHTTPHeaderField: "Content-Type") ?? ""
            if !contentType.contains("text/event-stream") && !contentType.contains("text/plain") {
                logger.warning("Unexpected content type: \(contentType)")
            }
            
            isConnected = true
            logger.info("✅ EventSource connected successfully")
            DispatchQueue.main.async {
                self.onOpen?()
            }
            completionHandler(.allow)
        } else {
            logger.error("EventSource connection failed with status: \(httpResponse.statusCode)")
            completionHandler(.cancel)
            
            // Provide more specific error based on status code
            let error: URLError = switch httpResponse.statusCode {
            case 401, 403:
                URLError(.userAuthenticationRequired)
            case 404:
                URLError(.fileDoesNotExist)
            case 500...599:
                URLError(.badServerResponse)
            default:
                URLError(.httpTooManyRedirects)
            }
            
            DispatchQueue.main.async {
                self.onError?(error)
            }
        }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        logger.debug("📨 EventSource received \(data.count) bytes of data")
        
        // Defensive check: ensure we're still connected
        guard isConnected else {
            logger.warning("Received data while not connected, ignoring")
            return
        }
        
        // Defensive check: validate data size
        guard data.count > 0 else {
            logger.warning("Received empty data chunk")
            return
        }
        
        // Check for potential buffer overflow
        if buffer.count > 1_000_000 { // 1MB limit
            logger.error("Buffer overflow detected, clearing buffer")
            buffer = ""
        }

        // Check if data might be compressed
        if data.count > 2 {
            let header = [UInt8](data.prefix(2))
            if header[0] == 0x1F && header[1] == 0x8B {
                logger.error("❌ Received gzip compressed data! SSE should not be compressed.")
                DispatchQueue.main.async {
                    self.onError?(URLError(.cannotDecodeContentData))
                }
                return
            }
        }

        guard let text = String(data: data, encoding: .utf8) else {
            logger.error("Failed to decode data as UTF-8. First 20 bytes: \(data.prefix(20).hexString)")
            DispatchQueue.main.async {
                self.onError?(URLError(.cannotDecodeContentData))
            }
            return
        }

        logger.debug("📨 EventSource received text: \(text)")
        buffer += text
        processBuffer()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        isConnected = false

        if let error {
            logger.error("EventSource error: \(error)")
            
            // Provide user-friendly error context
            if let urlError = error as? URLError {
                switch urlError.code {
                case .cannotConnectToHost:
                    logger.info("💡 Cannot connect to server - server may not be running")
                case .timedOut:
                    logger.info("💡 Connection timed out - server may be overloaded")
                case .networkConnectionLost:
                    logger.info("💡 Network connection lost")
                case .cancelled:
                    logger.info("💡 Connection was cancelled")
                default:
                    logger.error("💡 Network error: \(urlError.localizedDescription)")
                }
            }
        } else {
            logger.info("EventSource connection completed without error")
        }

        DispatchQueue.main.async {
            self.onError?(error)
        }
    }
}

// MARK: - URLSessionDelegate

extension EventSource: URLSessionDelegate {
    func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        // Accept the server's certificate for localhost connections
        if challenge.protectionSpace.host == "localhost",
           let serverTrust = challenge.protectionSpace.serverTrust
        {
            let credential = URLCredential(trust: serverTrust)
            completionHandler(.useCredential, credential)
        } else {
            completionHandler(.performDefaultHandling, nil)
        }
    }
}
