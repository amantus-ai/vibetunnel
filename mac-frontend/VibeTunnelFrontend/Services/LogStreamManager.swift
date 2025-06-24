import Combine
import Foundation

@Observable
@MainActor
final class LogStreamManager {
    let serverURL: URL
    let authHeader: String?
    
    var logs: [LogEntry] = []
    var isConnected = false
    var error: Error?
    var logSize: String = ""
    
    private var eventSource: EventSource?
    private var logBuffer: [String] = []
    private var updateTimer: Timer?
    
    init(serverURL: URL, authHeader: String?) {
        self.serverURL = serverURL
        self.authHeader = authHeader
    }
    
    func connect() {
        let streamURL = serverURL.appendingPathComponent("api/logs/stream")
        
        eventSource = EventSource(url: streamURL, authHeader: authHeader)
        eventSource?.onMessage = { [weak self] message in
            Task { @MainActor in
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
        
        // Start update timer for batching
        updateTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.flushBuffer()
            }
        }
        
        // Load initial logs
        Task {
            await loadInitialLogs()
            await loadLogInfo()
        }
    }
    
    func disconnect() {
        updateTimer?.invalidate()
        updateTimer = nil
        eventSource?.disconnect()
        eventSource = nil
        isConnected = false
    }
    
    func clearLogs() async {
        do {
            let url = serverURL.appendingPathComponent("api/logs/clear")
            var request = URLRequest(url: url)
            request.httpMethod = "DELETE"
            if let authHeader {
                request.setValue(authHeader, forHTTPHeaderField: "Authorization")
            }
            
            let (_, response) = try await URLSession.shared.data(for: request)
            
            guard let httpResponse = response as? HTTPURLResponse,
                  httpResponse.statusCode == 200 else {
                throw URLError(.badServerResponse)
            }
            
            // Clear local logs
            logs.removeAll()
            logSize = "0 Bytes"
        } catch {
            self.error = error
        }
    }
    
    private func loadInitialLogs() async {
        do {
            let url = serverURL.appendingPathComponent("api/logs/raw")
            var request = URLRequest(url: url)
            if let authHeader {
                request.setValue(authHeader, forHTTPHeaderField: "Authorization")
            }
            
            let (data, response) = try await URLSession.shared.data(for: request)
            
            guard let httpResponse = response as? HTTPURLResponse,
                  httpResponse.statusCode == 200 else {
                throw URLError(.badServerResponse)
            }
            
            if let text = String(data: data, encoding: .utf8) {
                await MainActor.run {
                    parseLogs(from: text)
                }
            }
        } catch {
            await MainActor.run {
                self.error = error
            }
        }
    }
    
    private func loadLogInfo() async {
        do {
            let url = serverURL.appendingPathComponent("api/logs/info")
            var request = URLRequest(url: url)
            if let authHeader {
                request.setValue(authHeader, forHTTPHeaderField: "Authorization")
            }
            
            let (data, response) = try await URLSession.shared.data(for: request)
            
            guard let httpResponse = response as? HTTPURLResponse,
                  httpResponse.statusCode == 200 else {
                throw URLError(.badServerResponse)
            }
            
            if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let sizeHuman = json["sizeHuman"] as? String {
                await MainActor.run {
                    self.logSize = sizeHuman
                }
            }
        } catch {
            // Non-critical error, ignore
        }
    }
    
    private func parseLogs(from text: String) {
        let lines = text.components(separatedBy: .newlines)
        var currentLog: LogEntry?
        var parsedLogs: [LogEntry] = []
        
        for line in lines {
            guard !line.isEmpty else { continue }
            
            // Try to parse as new log entry
            if let newLog = LogEntry.parse(from: line) {
                if let log = currentLog {
                    parsedLogs.append(log)
                }
                currentLog = newLog
            } else if currentLog != nil {
                // Continuation line - append to current log's message
                currentLog = LogEntry(
                    timestamp: currentLog!.timestamp,
                    level: currentLog!.level,
                    module: currentLog!.module,
                    message: currentLog!.message + "\n" + line,
                    isClient: currentLog!.isClient
                )
            }
        }
        
        // Don't forget the last log
        if let log = currentLog {
            parsedLogs.append(log)
        }
        
        self.logs = parsedLogs
    }
    
    private func handleMessage(_ message: String) {
        // SSE messages come as "data: <content>"
        if message.hasPrefix("data: ") {
            let content = String(message.dropFirst(6))
            logBuffer.append(content)
        }
    }
    
    private func handleError(_ error: Error) {
        DispatchQueue.main.async {
            self.error = error
            self.isConnected = false
        }
    }
    
    private func flushBuffer() {
        guard !logBuffer.isEmpty else { return }
        
        let newLines = logBuffer
        logBuffer.removeAll()
        
        // Parse new log entries
        for line in newLines {
            if let log = LogEntry.parse(from: line) {
                logs.append(log)
            }
        }
        
        // Keep only last 10000 logs
        if logs.count > 10000 {
            logs = Array(logs.suffix(10000))
        }
    }
}