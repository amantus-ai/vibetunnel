import Foundation
@testable import VibeTunnel

/// Centralized test fixtures and helper functions for consistent test data
enum TestFixtures {
    
    // MARK: - Buffer Data Generation
    
    /// Creates a valid binary buffer snapshot for testing
    static func bufferSnapshot(cols: Int, rows: Int, includeContent: Bool = true) -> Data {
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
        
        // Reserved
        var reserved = UInt32(0).littleEndian
        data.append(Data(bytes: &reserved, count: 4))
        
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
    
    // MARK: - Server Configurations
    
    static func testServerConfig(
        host: String = "localhost",
        port: Int = 8888,
        name: String? = nil,
        password: String? = nil
    ) -> ServerConfig {
        ServerConfig(host: host, port: port, name: name, password: password)
    }
    
    static func saveServerConfig(_ config: ServerConfig) {
        if let data = try? JSONEncoder().encode(config) {
            UserDefaults.standard.set(data, forKey: "savedServerConfig")
        }
    }
    
    // MARK: - Session Data
    
    static func testSession(
        id: String = UUID().uuidString,
        name: String = "Test Session",
        workingDir: String = "/tmp/test",
        isRunning: Bool = true
    ) -> Session {
        Session(
            id: id,
            pid: 12345,
            name: name,
            workingDir: workingDir,
            cols: 80,
            rows: 24,
            createdAt: Date(),
            lastActivity: Date(),
            isRunning: isRunning,
            exitCode: isRunning ? nil : 0
        )
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