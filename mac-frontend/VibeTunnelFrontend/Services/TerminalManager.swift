import Combine
import Foundation

@Observable
@MainActor
final class TerminalManager: NSObject {
    enum ConnectionMode {
        case sse
        case webSocket
    }
    
    let sessionId: String
    let serverURL: URL
    let authHeader: String?
    
    var terminalOutput = ""
    var isConnected = false
    var error: Error?
    var connectionMode: ConnectionMode = .sse
    var sessionExited = false
    var sessionExitCode: Int?
    
    // Terminal dimensions
    var terminalCols: Int = 0
    var terminalRows: Int = 0
    
    // Recording
    let recordingManager = TerminalRecordingManager()
    
    // Performance settings
    private let maxOutputSize = 500_000 // 500KB max terminal buffer
    private let truncateToSize = 400_000 // Truncate to 400KB when limit reached
    private let updateBatchSize = 10_000 // Max chars to append per update
    
    private var eventSource: EventSource?
    private var webSocketManager: WebSocketManager?
    private var outputBuffer = ""
    private var updateTimer: Timer?
    private let bufferQueue = DispatchQueue(label: "terminal.buffer", qos: .userInteractive)
    
    init(sessionId: String, serverURL: URL, authHeader: String?) {
        self.sessionId = sessionId
        self.serverURL = serverURL
        self.authHeader = authHeader
        super.init()
    }
    
    // Note: disconnect() should be called explicitly when done
    // Cannot call @MainActor methods from deinit
    
    func connect(preferWebSocket: Bool = false) {
        // First, load the initial snapshot
        Task {
            await loadInitialSnapshot()
        }
        
        if preferWebSocket {
            connectWebSocket()
        } else {
            connectSSE()
        }
    }
    
    private func loadInitialSnapshot() async {
        do {
            let snapshot = try await APIClient.shared.getTerminalSnapshot(
                serverURL: serverURL,
                authHeader: authHeader,
                sessionId: sessionId
            )
            
            await MainActor.run {
                print("[TerminalManager] Loaded initial snapshot with \(snapshot.count) characters")
                self.terminalOutput = snapshot
                self.outputBuffer = ""
            }
        } catch {
            print("[TerminalManager] Failed to load initial snapshot: \(error)")
            // Continue anyway, SSE will provide updates
        }
    }
    
    private func connectSSE() {
        connectionMode = .sse
        let streamURL = serverURL.appendingPathComponent("api/sessions/\(sessionId)/stream")
        
        eventSource = EventSource(url: streamURL, authHeader: authHeader)
        eventSource?.onMessage = { [weak self] message in
            Task { @MainActor in
                print("[TerminalManager] Received SSE message: \(message)")
                self?.handleMessage(message)
            }
        }
        eventSource?.onError = { [weak self] error in
            Task { @MainActor in
                self?.handleError(error)
            }
        }
        
        eventSource?.connect()
        isConnected = true
        startUpdateTimer()
    }
    
    private func connectWebSocket() {
        connectionMode = .webSocket
        webSocketManager = WebSocketManager(sessionId: sessionId, serverURL: serverURL, authHeader: authHeader)
        
        webSocketManager?.onMessage = { [weak self] data in
            // Handle binary terminal data
            if let text = String(data: data, encoding: .utf8) {
                self?.outputBuffer.append(text)
                // Record output if recording
                self?.recordingManager.recordOutput(text)
            }
        }
        
        webSocketManager?.onTextMessage = { [weak self] text in
            // Handle text messages (control messages)
            if text == "[CLEAR]" {
                self?.terminalOutput = ""
                self?.outputBuffer = ""
            } else if text.hasPrefix("[EXITED") {
                self?.sessionExited = true
                self?.isConnected = false
                
                // Try to parse exit code from "[EXITED:123]" format
                if text.hasPrefix("[EXITED:") && text.hasSuffix("]") {
                    let codeStr = text.dropFirst(8).dropLast(1)
                    self?.sessionExitCode = Int(codeStr)
                }
            } else {
                self?.outputBuffer.append(text)
                // Record output if recording
                self?.recordingManager.recordOutput(text)
            }
        }
        
        webSocketManager?.connect()
        isConnected = true
        startUpdateTimer()
    }
    
    private func startUpdateTimer() {
        // Start update timer for batching updates
        updateTimer = Timer.scheduledTimer(withTimeInterval: 0.016, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.flushBuffer()
            }
        }
    }
    
    func disconnect() {
        updateTimer?.invalidate()
        updateTimer = nil
        eventSource?.disconnect()
        eventSource = nil
        webSocketManager?.disconnect()
        webSocketManager = nil
        isConnected = false
        
        // Stop recording if active
        if recordingManager.isRecording {
            _ = recordingManager.stopRecording()
        }
    }
    
    // Recording methods
    func startRecording() {
        recordingManager.startRecording(sessionId: sessionId, cols: terminalCols, rows: terminalRows)
    }
    
    func stopRecording() -> URL? {
        return recordingManager.saveToDisk()
    }
    
    func exportRecordingToClipboard() -> Bool {
        return recordingManager.exportToClipboard()
    }
    
    func sendInput(_ input: String) {
        // Record input if recording
        recordingManager.recordInput(input)
        
        Task {
            do {
                try await APIClient.shared.sendInput(
                    serverURL: serverURL,
                    authHeader: authHeader,
                    sessionId: sessionId,
                    input: input
                )
            } catch {
                await MainActor.run {
                    self.error = error
                }
            }
        }
    }
    
    func resize(cols: Int, rows: Int) {
        // Update local dimensions
        terminalCols = cols
        terminalRows = rows
        
        // Record resize if recording
        recordingManager.recordResize(cols: cols, rows: rows)
        
        Task {
            do {
                try await APIClient.shared.resizeTerminal(
                    serverURL: serverURL,
                    authHeader: authHeader,
                    sessionId: sessionId,
                    cols: cols,
                    rows: rows
                )
            } catch {
                await MainActor.run {
                    self.error = error
                }
            }
        }
    }
    
    private func handleMessage(_ message: String) {
        // Messages come as "data: <content>"
        if message.hasPrefix("data: ") {
            let content = String(message.dropFirst(6))
            
            // Handle special messages
            if content == "[CLEAR]" {
                DispatchQueue.main.async {
                    self.terminalOutput = ""
                    self.outputBuffer = ""
                }
            } else if content.hasPrefix("[EXITED") {
                DispatchQueue.main.async {
                    self.sessionExited = true
                    self.isConnected = false
                    
                    // Try to parse exit code from "[EXITED:123]" format
                    if content.hasPrefix("[EXITED:") && content.hasSuffix("]") {
                        let codeStr = content.dropFirst(8).dropLast(1)
                        self.sessionExitCode = Int(codeStr)
                    }
                }
            } else {
                // Parse Asciinema v2 format: [timestamp, "o"/"i", data]
                if let data = content.data(using: .utf8),
                   let json = try? JSONSerialization.jsonObject(with: data) as? [Any],
                   json.count >= 3,
                   let eventType = json[1] as? String {
                    
                    switch eventType {
                    case "o": // Output
                        if let output = json[2] as? String {
                            print("[TerminalManager] Parsed output: \(output)")
                            outputBuffer.append(output)
                            // Record output if recording
                            recordingManager.recordOutput(output)
                        }
                    case "i": // Input (ignored for now)
                        break
                    case "exit": // Special exit event
                        if let exitCode = json[1] as? Int {
                            DispatchQueue.main.async {
                                self.sessionExited = true
                                self.isConnected = false
                                self.sessionExitCode = exitCode
                            }
                        }
                    default:
                        break
                    }
                } else {
                    // Fallback: treat as raw output if not valid JSON
                    outputBuffer.append(content)
                    recordingManager.recordOutput(content)
                }
            }
        }
    }
    
    private func handleError(_ error: Error) {
        DispatchQueue.main.async {
            self.error = error
            self.isConnected = false
        }
    }
    
    private func flushBuffer() {
        guard !outputBuffer.isEmpty else { return }
        
        let toAppend = outputBuffer
        outputBuffer = ""
        
        print("[TerminalManager] Flushing buffer with \(toAppend.count) characters")
        
        DispatchQueue.main.async {
            self.terminalOutput.append(toAppend)
            
            // Truncate if output exceeds max size
            if self.terminalOutput.count > self.maxOutputSize {
                // Find a good truncation point (newline boundary)
                let truncateAt = self.truncateToSize
                if let lastNewline = self.terminalOutput[..<self.terminalOutput.index(self.terminalOutput.startIndex, offsetBy: truncateAt)].lastIndex(of: "\n") {
                    self.terminalOutput.removeSubrange(..<self.terminalOutput.index(after: lastNewline))
                } else {
                    // No newline found, just truncate
                    self.terminalOutput = String(self.terminalOutput.suffix(self.truncateToSize))
                }
                
                // Add truncation notice
                self.terminalOutput = "[Terminal output truncated...]\n" + self.terminalOutput
            }
        }
    }
}

// Simple EventSource implementation for Server-Sent Events
final class EventSource: NSObject, @unchecked Sendable {
    private let url: URL
    private let authHeader: String?
    private var task: URLSessionDataTask?
    private var session: URLSession?
    private var buffer = Data()
    
    var onMessage: (@Sendable (String) -> Void)?
    var onError: (@Sendable (Error) -> Void)?
    
    init(url: URL, authHeader: String?) {
        self.url = url
        self.authHeader = authHeader
        super.init()
    }
    
    func connect() {
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = .infinity
        configuration.timeoutIntervalForResource = .infinity
        
        session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        
        var request = URLRequest(url: url)
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        
        if let authHeader {
            request.setValue(authHeader, forHTTPHeaderField: "Authorization")
        }
        
        task = session?.dataTask(with: request)
        task?.resume()
    }
    
    func disconnect() {
        task?.cancel()
        task = nil
        session?.invalidateAndCancel()
        session = nil
    }
    
    private func processBuffer() {
        guard !buffer.isEmpty else { return }
        
        // Convert buffer to string and split by double newline (SSE message separator)
        if let string = String(data: buffer, encoding: .utf8) {
            let messages = string.components(separatedBy: "\n\n")
            
            // Process complete messages (all but potentially the last one)
            for i in 0..<messages.count - 1 {
                processMessage(messages[i])
            }
            
            // Keep any incomplete message in buffer
            if let lastMessage = messages.last, !lastMessage.isEmpty {
                if string.hasSuffix("\n\n") {
                    // Last message is complete
                    processMessage(lastMessage)
                    buffer = Data()
                } else {
                    // Last message is incomplete, keep it in buffer
                    buffer = lastMessage.data(using: .utf8) ?? Data()
                }
            } else {
                buffer = Data()
            }
        }
    }
    
    private func processMessage(_ message: String) {
        let lines = message.components(separatedBy: "\n")
        for line in lines {
            if line.hasPrefix("data: ") {
                onMessage?(line)
            }
            // Ignore other SSE fields like "event:", "id:", "retry:" for now
        }
    }
}

// MARK: - URLSessionDataDelegate
extension EventSource: URLSessionDataDelegate {
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        buffer.append(data)
        processBuffer()
    }
    
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error = error {
            onError?(error)
        }
    }
}
