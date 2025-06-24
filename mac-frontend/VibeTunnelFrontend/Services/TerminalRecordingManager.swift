import Foundation
import Combine
import AppKit

/// Manages terminal session recording in asciinema format
@MainActor
final class TerminalRecordingManager: ObservableObject {
    struct RecordingHeader: Codable {
        let version: Int
        let width: Int
        let height: Int
        let timestamp: Int
        let env: [String: String]?
        
        init(width: Int, height: Int, timestamp: Int, env: [String: String]?) {
            self.version = 2
            self.width = width
            self.height = height
            self.timestamp = timestamp
            self.env = env
        }
    }
    
    struct RecordingEvent {
        let timestamp: TimeInterval
        let type: EventType
        let data: String
        
        enum EventType: String {
            case output = "o"
            case input = "i"
            case resize = "r"
        }
        
        var asJSON: String {
            let escapedData = data
                .replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "\"", with: "\\\"")
                .replacingOccurrences(of: "\n", with: "\\n")
                .replacingOccurrences(of: "\r", with: "\\r")
                .replacingOccurrences(of: "\t", with: "\\t")
            
            return "[\(timestamp), \"\(type.rawValue)\", \"\(escapedData)\"]"
        }
    }
    
    @Published private(set) var isRecording = false
    @Published private(set) var recordingDuration: TimeInterval = 0
    @Published private(set) var eventCount = 0
    
    private var sessionId: String?
    private var startTime: Date?
    private var events: [RecordingEvent] = []
    private var header: RecordingHeader?
    private var durationTimer: Timer?
    
    func startRecording(sessionId: String, cols: Int, rows: Int) {
        guard !isRecording else { return }
        
        self.sessionId = sessionId
        self.startTime = Date()
        self.isRecording = true
        self.events = []
        self.eventCount = 0
        self.recordingDuration = 0
        
        // Create header
        self.header = RecordingHeader(
            width: cols,
            height: rows,
            timestamp: Int(Date().timeIntervalSince1970),
            env: [
                "SHELL": ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/bash",
                "TERM": "xterm-256color"
            ]
        )
        
        // Start duration timer
        durationTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self = self, let startTime = self.startTime else { return }
                self.recordingDuration = Date().timeIntervalSince(startTime)
            }
        }
    }
    
    func stopRecording() -> String? {
        guard isRecording else { return nil }
        
        isRecording = false
        durationTimer?.invalidate()
        durationTimer = nil
        
        return generateCastFile()
    }
    
    func recordOutput(_ data: String) {
        guard isRecording, let startTime = startTime else { return }
        
        let timestamp = Date().timeIntervalSince(startTime)
        let event = RecordingEvent(timestamp: timestamp, type: .output, data: data)
        events.append(event)
        eventCount = events.count
    }
    
    func recordInput(_ data: String) {
        guard isRecording, let startTime = startTime else { return }
        
        let timestamp = Date().timeIntervalSince(startTime)
        let event = RecordingEvent(timestamp: timestamp, type: .input, data: data)
        events.append(event)
        eventCount = events.count
    }
    
    func recordResize(cols: Int, rows: Int) {
        guard isRecording, let startTime = startTime else { return }
        
        let timestamp = Date().timeIntervalSince(startTime)
        let resizeData = "\(cols)x\(rows)"
        let event = RecordingEvent(timestamp: timestamp, type: .resize, data: resizeData)
        events.append(event)
        eventCount = events.count
    }
    
    private func generateCastFile() -> String? {
        guard let header = header else { return nil }
        
        var lines: [String] = []
        
        // Add header
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        if let headerData = try? encoder.encode(header),
           let headerJSON = String(data: headerData, encoding: .utf8) {
            lines.append(headerJSON)
        }
        
        // Add events
        for event in events {
            lines.append(event.asJSON)
        }
        
        return lines.joined(separator: "\n")
    }
    
    func saveToDisk(fileName: String? = nil) -> URL? {
        guard let castContent = generateCastFile() else { return nil }
        
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd_HH-mm-ss"
        let timestamp = formatter.string(from: Date())
        
        let finalFileName = fileName ?? "terminal_recording_\(timestamp).cast"
        
        // Get documents directory
        let documentsURL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
        guard let saveURL = documentsURL?.appendingPathComponent(finalFileName) else { return nil }
        
        do {
            try castContent.write(to: saveURL, atomically: true, encoding: .utf8)
            return saveURL
        } catch {
            print("Failed to save recording: \(error)")
            return nil
        }
    }
    
    func exportToClipboard() -> Bool {
        guard let castContent = generateCastFile() else { return false }
        
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        return pasteboard.setString(castContent, forType: .string)
    }
}