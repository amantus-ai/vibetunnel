import Foundation
@testable import VibeTunnel

/// Centralized test fixtures and helper functions for consistent test data
enum TestFixtures {
    
    // MARK: - Server Configurations
    
    static let validServerConfig = ServerConfig(
        host: "localhost",
        port: 8_888,
        name: nil
    )

    static let sslServerConfig = ServerConfig(
        host: "example.com",
        port: 443,
        name: "Test Server"
    )
    
    static func testServerConfig(
        host: String = "localhost",
        port: Int = 8888,
        name: String? = nil,
        password: String? = nil
    ) -> ServerConfig {
        ServerConfig(host: host, port: port, name: name)
    }

    static func saveServerConfig(_ config: ServerConfig) {
        if let data = try? JSONEncoder().encode(config) {
            UserDefaults.standard.set(data, forKey: "savedServerConfig")
        }
    }
    
    // MARK: - Session Data

    static let validSession = Session(
        id: "test-session-123",
        command: ["/bin/bash"],
        workingDir: "/Users/test",
        name: "Test Session",
        status: .running,
        exitCode: nil,
        startedAt: "2024-01-01T10:00:00Z",
        lastModified: "2024-01-01T10:05:00Z",
        pid: 12_345,
        width: 80,
        height: 24,
        waiting: false,
        source: nil,
        remoteId: nil,
        remoteName: nil,
        remoteUrl: nil
    )

    static let exitedSession = Session(
        id: "exited-session-456",
        command: ["/usr/bin/echo"],
        workingDir: "/tmp",
        name: "Exited Session",
        status: .exited,
        exitCode: 0,
        startedAt: "2024-01-01T09:00:00Z",
        lastModified: "2024-01-01T09:00:05Z",
        pid: nil,
        width: 80,
        height: 24,
        waiting: false,
        source: nil,
        remoteId: nil,
        remoteName: nil,
        remoteUrl: nil
    )
    
    static func testSession(
        id: String = UUID().uuidString,
        name: String = "Test Session",
        workingDir: String = "/tmp/test",
        isRunning: Bool = true
    ) -> Session {
        Session(
            id: id,
            command: ["/bin/bash"],
            workingDir: workingDir,
            name: name,
            status: isRunning ? .running : .exited,
            exitCode: isRunning ? nil : 0,
            startedAt: ISO8601DateFormatter().string(from: Date()),
            lastModified: ISO8601DateFormatter().string(from: Date()),
            pid: isRunning ? 12345 : nil,
            width: 80,
            height: 24,
            waiting: false,
            source: nil,
            remoteId: nil,
            remoteName: nil,
            remoteUrl: nil
        )
    }

    // MARK: - JSON Fixtures

    static let sessionsJSON = """
    [
        {
            "id": "test-session-123",
            "command": ["/bin/bash"],
            "workingDir": "/Users/test",
            "name": "Test Session",
            "status": "running",
            "startedAt": "2024-01-01T10:00:00Z",
            "lastModified": "2024-01-01T10:05:00Z",
            "pid": 12345,
            "width": 80,
            "height": 24,
            "waiting": false
        },
        {
            "id": "exited-session-456",
            "command": ["/usr/bin/echo"],
            "workingDir": "/tmp",
            "name": "Exited Session",
            "status": "exited",
            "exitCode": 0,
            "startedAt": "2024-01-01T09:00:00Z",
            "lastModified": "2024-01-01T09:00:05Z",
            "width": 80,
            "height": 24,
            "waiting": false
        }
    ]
    """

    static let createSessionJSON = """
    {
        "sessionId": "new-session-789"
    }
    """

    static let errorResponseJSON = """
    {
        "error": "Session not found",
        "code": 404
    }
    """
    
    // MARK: - Buffer Data Generation
    
    /// Creates a valid binary buffer snapshot for testing
    static func bufferSnapshot(cols: Int = 80, rows: Int = 24, includeContent: Bool = true) -> Data {
        var data = Data()
        
        // Magic bytes "VT" (0x5654 in little endian)
        var magic: UInt16 = 0x5654
        data.append(Data(bytes: &magic, count: 2))
        
        // Version
        data.append(0x01)
        
        // Flags (no bell)
        data.append(0x00)
        
        // Dimensions
        var colsLE = UInt32(cols).littleEndian
        var rowsLE = UInt32(rows).littleEndian
        data.append(Data(bytes: &colsLE, count: 4))
        data.append(Data(bytes: &rowsLE, count: 4))
        
        // Viewport Y
        var viewportY = Int32(0).littleEndian
        data.append(Data(bytes: &viewportY, count: 4))
        
        // Cursor position
        var cursorX = Int32(0).littleEndian
        var cursorY = Int32(0).littleEndian
        data.append(Data(bytes: &cursorX, count: 4))
        data.append(Data(bytes: &cursorY, count: 4))
        
        // Reserved (need 4 more bytes to reach 32-byte header)
        var reserved1 = UInt32(0).littleEndian
        data.append(Data(bytes: &reserved1, count: 4))
        
        // Additional reserved to reach 32-byte header
        var reserved2 = UInt32(0).littleEndian
        data.append(Data(bytes: &reserved2, count: 4))
        
        if includeContent {
            // Add some empty rows
            data.append(0xFE) // Empty rows marker
            data.append(UInt8(min(rows, 255))) // Number of empty rows
        }
        
        return data
    }
    
    /// Creates a WebSocket message wrapper for buffer data
    static func wrappedBufferMessage(sessionId: String, bufferData: Data) -> Data {
        var messageData = Data()
        
        // Magic byte for buffer message
        messageData.append(0xBF)
        
        // Session ID length (4 bytes, little endian)
        let sessionIdData = sessionId.data(using: .utf8)!
        var sessionIdLength = UInt32(sessionIdData.count).littleEndian
        messageData.append(Data(bytes: &sessionIdLength, count: 4))
        
        // Session ID
        messageData.append(sessionIdData)
        
        // Buffer data
        messageData.append(bufferData)
        
        return messageData
    }
    
    // MARK: - Terminal Events
    
    static func terminalEvent(type: String, data: Any? = nil) -> String {
        var event: [String: Any] = ["type": type]
        if let data = data {
            event["data"] = data
        }
        
        if let jsonData = try? JSONSerialization.data(withJSONObject: event),
           let jsonString = String(data: jsonData, encoding: .utf8) {
            return jsonString
        }
        
        return "{\"type\":\"\(type)\"}"
    }
}