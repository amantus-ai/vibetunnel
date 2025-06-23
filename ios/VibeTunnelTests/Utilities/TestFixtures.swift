import Foundation
@testable import VibeTunnel

enum TestFixtures {
    static let validServerConfig = ServerConfig(
        host: "localhost",
        port: 8_888,
        name: nil,
        password: nil
    )

    static let sslServerConfig = ServerConfig(
        host: "example.com",
        port: 443,
        name: "Test Server",
        password: "testpass"
    )

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

    static func saveServerConfig(_ config: ServerConfig) {
        // Mock implementation for tests
        // In real tests, this would save to UserDefaults or similar
    }
    
    static func wrappedBufferMessage(sessionId: String, bufferData: Data) -> Data {
        var data = Data()
        
        // Magic byte for wrapped message
        data.append(0xB1)
        
        // Session ID length and content
        let sessionIdData = sessionId.data(using: .utf8)!
        data.append(contentsOf: withUnsafeBytes(of: Int32(sessionIdData.count).littleEndian) { Array($0) })
        data.append(sessionIdData)
        
        // Buffer data
        data.append(bufferData)
        
        return data
    }
    
    static func terminalEvent(type: String) -> String {
        """
        {
            "type": "\(type)",
            "timestamp": "\(ISO8601DateFormatter().string(from: Date()))"
        }
        """
    }
    
    static func bufferSnapshot(cols: Int = 80, rows: Int = 24) -> Data {
        var data = Data()

        // Magic byte
        data.append(0xBF)

        // Header (5 Int32 values)
        data.append(contentsOf: withUnsafeBytes(of: Int32(cols).littleEndian) { Array($0) })
        data.append(contentsOf: withUnsafeBytes(of: Int32(rows).littleEndian) { Array($0) })
        data.append(contentsOf: withUnsafeBytes(of: Int32(0).littleEndian) { Array($0) }) // viewportY
        data.append(contentsOf: withUnsafeBytes(of: Int32(10).littleEndian) { Array($0) }) // cursorX
        data.append(contentsOf: withUnsafeBytes(of: Int32(5).littleEndian) { Array($0) }) // cursorY

        // Add some sample cells
        for row in 0..<rows {
            for col in 0..<cols {
                // char (UTF-8 encoded)
                let char = (row == 0 && col < 5) ? "Hello".utf8.dropFirst(col).first ?? 32 : 32
                data.append(char)

                // width (1 byte)
                data.append(1)

                // fg color (4 bytes, optional - using 0xFFFFFFFF for none)
                data.append(contentsOf: [0xFF, 0xFF, 0xFF, 0xFF])

                // bg color (4 bytes, optional - using 0xFFFFFFFF for none)
                data.append(contentsOf: [0xFF, 0xFF, 0xFF, 0xFF])

                // attributes (4 bytes, optional - using 0 for none)
                data.append(contentsOf: [0, 0, 0, 0])
            }
        }

        return data
    }
}
