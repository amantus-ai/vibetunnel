import Foundation

final class SSEClient: NSObject, @unchecked Sendable {
    private var eventSource: URLSessionDataTask?
    private var session: URLSession?
    private var streamContinuation: AsyncStream<TerminalEvent>.Continuation?
    
    override init() {
        super.init()
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = TimeInterval.infinity
        configuration.timeoutIntervalForResource = TimeInterval.infinity
        self.session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    }
    
    func connect(to url: URL) -> AsyncStream<TerminalEvent> {
        disconnect()
        
        return AsyncStream { continuation in
            self.streamContinuation = continuation
            
            var request = URLRequest(url: url)
            request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
            request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
            request.timeoutInterval = TimeInterval.infinity
            
            self.eventSource = self.session?.dataTask(with: request)
            self.eventSource?.resume()
            
            continuation.onTermination = { @Sendable _ in
                self.disconnect()
            }
        }
    }
    
    func disconnect() {
        eventSource?.cancel()
        eventSource = nil
        streamContinuation?.finish()
        streamContinuation = nil
    }
    
    private var dataBuffer = Data()
    
    private func processSSEData(_ data: Data) {
        dataBuffer.append(data)
        
        // Process complete lines
        while let newlineRange = dataBuffer.range(of: Data("\n".utf8)) {
            let lineData = dataBuffer.subdata(in: 0..<newlineRange.lowerBound)
            dataBuffer.removeSubrange(0..<newlineRange.upperBound)
            
            guard let line = String(data: lineData, encoding: .utf8) else { continue }
            processSSELine(line)
        }
    }
    
    private func processSSELine(_ line: String) {
        let trimmedLine = line.trimmingCharacters(in: .whitespacesAndNewlines)
        
        // Skip empty lines and comments
        if trimmedLine.isEmpty || trimmedLine.hasPrefix(":") {
            return
        }
        
        // Handle event data
        if trimmedLine.hasPrefix("data: ") {
            let data = String(trimmedLine.dropFirst(6))
            
            // Parse terminal event
            if let event = TerminalEvent(from: data) {
                streamContinuation?.yield(event)
            }
        }
        // Handle special events
        else if trimmedLine.hasPrefix("event: ") {
            let eventType = String(trimmedLine.dropFirst(7))
            handleSpecialEvent(eventType)
        }
    }
    
    private func handleSpecialEvent(_ eventType: String) {
        switch eventType {
        case "exit", "end":
            streamContinuation?.finish()
        case "error":
            // Could parse error data if needed
            streamContinuation?.finish()
        default:
            break
        }
    }
}

// MARK: - URLSessionDataDelegate

extension SSEClient: URLSessionDataDelegate {
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        processSSEData(data)
    }
    
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error = error {
            print("SSE connection error: \(error)")
        }
        streamContinuation?.finish()
    }
    
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            completionHandler(.cancel)
            return
        }
        completionHandler(.allow)
    }
}