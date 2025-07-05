import Foundation

/// Terminal event types that match the server's output.
/// Represents various events that can occur during terminal interaction.
enum TerminalWebSocketEvent {
    case header(width: Int, height: Int)
    case output(timestamp: Double, data: String)
    case resize(timestamp: Double, dimensions: String)
    case exit(code: Int)
    case bufferUpdate(snapshot: BufferSnapshot)
    case bell
    case alert(title: String?, message: String)
}

/// Binary buffer snapshot data.
/// Contains the complete terminal buffer state including cells, cursor position, and viewport.
struct BufferSnapshot {
    let cols: Int
    let rows: Int
    let viewportY: Int
    let cursorX: Int
    let cursorY: Int
    let cells: [[BufferCell]]
}

/// Individual cell data.
/// Represents a single character cell in the terminal with its styling attributes.
struct BufferCell {
    let char: String
    let width: Int
    let fg: Int?
    let bg: Int?
    let attributes: Int?
}

/// Errors that can occur during WebSocket operations.
enum WebSocketError: Error {
    case invalidURL
    case connectionFailed
    case invalidData
    case invalidMagicByte
}

/// WebSocket client for real-time terminal buffer streaming.
///
/// BufferWebSocketClient establishes a WebSocket connection to the server
/// to receive terminal output and events in real-time. It handles automatic
/// reconnection, binary message parsing, and event distribution to subscribers.
@MainActor
@Observable
class BufferWebSocketClient: NSObject {
    static let shared = BufferWebSocketClient()

    private let logger = Logger(category: "BufferWebSocket")
    /// Magic byte for binary messages
    private static let bufferMagicByte: UInt8 = 0xBF

    private var webSocket: WebSocketProtocol?
    private let webSocketFactory: WebSocketFactory
    private var subscriptions = [String: (TerminalWebSocketEvent) -> Void]()
    private var reconnectTask: Task<Void, Never>?
    private var reconnectAttempts = 0
    private var isConnecting = false
    private var pingTask: Task<Void, Never>?
    private(set) var authenticationService: AuthenticationService?

    // Observable properties
    private(set) var isConnected = false
    private(set) var connectionError: Error?

    private var baseURL: URL? {
        guard let config = UserDefaults.standard.data(forKey: "savedServerConfig"),
              let serverConfig = try? JSONDecoder().decode(ServerConfig.self, from: config)
        else {
            return nil
        }
        return serverConfig.baseURL
    }

    init(webSocketFactory: WebSocketFactory = DefaultWebSocketFactory()) {
        self.webSocketFactory = webSocketFactory
        super.init()
    }

    /// Set the authentication service for WebSocket connections
    func setAuthenticationService(_ authService: AuthenticationService) {
        self.authenticationService = authService
    }

    func connect() {
        guard !isConnecting else {
            logger.warning("Already connecting, ignoring connect() call")
            return
        }
        guard !isConnected else {
            logger.warning("Already connected, ignoring connect() call")
            return
        }
        guard let baseURL else {
            connectionError = WebSocketError.invalidURL
            return
        }

        isConnecting = true
        connectionError = nil

        // Convert HTTP URL to WebSocket URL
        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)
        components?.scheme = baseURL.scheme == "https" ? "wss" : "ws"
        components?.path = "/buffers"

        // Add authentication token as query parameter (not header)
        if let token = authenticationService?.getTokenForQuery() {
            components?.queryItems = [URLQueryItem(name: "token", value: token)]
        }

        guard let wsURL = components?.url else {
            connectionError = WebSocketError.invalidURL
            isConnecting = false
            return
        }

        logger.info("Connecting to \(wsURL)")

        // Disconnect existing WebSocket if any
        webSocket?.disconnect(with: .goingAway, reason: nil)

        // Create new WebSocket
        webSocket = webSocketFactory.createWebSocket()
        webSocket?.delegate = self

        // Build headers
        var headers: [String: String] = [:]

        // Add authentication header from authentication service
        if let authHeaders = authenticationService?.getAuthHeader() {
            headers.merge(authHeaders) { _, new in new }
        }

        // Connect
        Task {
            do {
                try await webSocket?.connect(to: wsURL, with: headers)
            } catch {
                logger.error("Connection failed: \(error)")
                connectionError = error
                isConnecting = false
                scheduleReconnect()
            }
        }
    }

    private func handleMessage(_ message: WebSocketMessage) {
        switch message {
        case .data(let data):
            handleBinaryMessage(data)

        case .string(let text):
            handleTextMessage(text)
        }
    }

    private func handleTextMessage(_ text: String) {
        guard let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            return
        }

        if let type = json["type"] as? String {
            switch type {
            case "ping":
                // Respond with pong
                Task {
                    try? await sendMessage(["type": "pong"])
                }

            case "error":
                if let message = json["message"] as? String {
                    logger.warning("Server error: \(message)")
                }

            default:
                logger.debug("Unknown message type: \(type)")
            }
        }
    }

    private func handleBinaryMessage(_ data: Data) {
        logger.verbose("Received binary message: \(data.count) bytes")

        guard data.count > 5 else {
            logger.debug("Binary message too short")
            return
        }

        var offset = 0

        // Check magic byte
        let magic = data[offset]
        offset += 1

        guard magic == Self.bufferMagicByte else {
            logger.warning("Invalid magic byte: \(String(format: "0x%02X", magic))")
            return
        }

        // Read session ID length (4 bytes, little endian)
        let sessionIdLength = data.withUnsafeBytes { bytes in
            bytes.loadUnaligned(fromByteOffset: offset, as: UInt32.self).littleEndian
        }
        offset += 4

        // Read session ID
        guard data.count >= offset + Int(sessionIdLength) else {
            logger.debug("Not enough data for session ID")
            return
        }
        let sessionIdData = data.subdata(in: offset..<(offset + Int(sessionIdLength)))
        guard let sessionId = String(data: sessionIdData, encoding: .utf8) else {
            logger.warning("Failed to decode session ID")
            return
        }
        logger.verbose("Session ID: \(sessionId)")
        offset += Int(sessionIdLength)

        // Remaining data is the message payload
        let messageData = data.subdata(in: offset..<data.count)
        logger.verbose("Message payload: \(messageData.count) bytes")

        // Decode terminal event
        if let event = decodeTerminalEvent(from: messageData),
           let handler = subscriptions[sessionId]
        {
            logger.verbose("Dispatching event to handler")
            handler(event)
        } else {
            logger.debug("No handler for session ID: \(sessionId)")
        }
    }

    private func decodeTerminalEvent(from data: Data) -> TerminalWebSocketEvent? {
        // This is binary buffer data, not JSON
        // Decode the binary terminal buffer
        guard let bufferSnapshot = decodeBinaryBuffer(data) else {
            logger.debug("Failed to decode binary buffer")
            return nil
        }

        logger.verbose("Decoded buffer: \(bufferSnapshot.cols)x\(bufferSnapshot.rows)")

        // Return buffer update event
        return .bufferUpdate(snapshot: bufferSnapshot)
    }

    private func decodeBinaryBuffer(_ data: Data) -> BufferSnapshot? {
        var offset = 0

        // Read header
        guard data.count >= 32 else {
            logger.debug("Buffer too small for header: \(data.count) bytes (need 32)")
            return nil
        }

        // Magic bytes "VT" (0x5654 in little endian)
        let magic = data.withUnsafeBytes { bytes in
            bytes.loadUnaligned(fromByteOffset: offset, as: UInt16.self).littleEndian
        }
        offset += 2

        guard magic == 0x5654 else {
            logger.warning("Invalid magic bytes: \(String(format: "0x%04X", magic)), expected 0x5654")
            return nil
        }

        // Version
        let version = data[offset]
        offset += 1

        guard version == 0x01 else {
            logger.warning("Unsupported version: 0x\(String(format: "%02X", version)), expected 0x01")
            return nil
        }

        // Flags
        let flags = data[offset]
        offset += 1

        // Check for bell flag
        let hasBell = (flags & 0x01) != 0
        if hasBell {
            // Send bell event separately
            if let handler = subscriptions.values.first {
                handler(.bell)
            }
        }

        // Dimensions and cursor - validate before reading
        guard offset + 20 <= data.count else {
            logger.debug("Insufficient data for header fields")
            return nil
        }

        let cols = data.withUnsafeBytes { bytes in
            bytes.loadUnaligned(fromByteOffset: offset, as: UInt32.self).littleEndian
        }
        offset += 4

        let rows = data.withUnsafeBytes { bytes in
            bytes.loadUnaligned(fromByteOffset: offset, as: UInt32.self).littleEndian
        }
        offset += 4

        // Validate dimensions
        guard cols > 0 && cols <= 1_000 && rows > 0 && rows <= 1_000 else {
            logger.warning("Invalid dimensions: \(cols)x\(rows)")
            return nil
        }

        let viewportY = data.withUnsafeBytes { bytes in
            bytes.loadUnaligned(fromByteOffset: offset, as: Int32.self).littleEndian
        }
        offset += 4

        let cursorX = data.withUnsafeBytes { bytes in
            bytes.loadUnaligned(fromByteOffset: offset, as: Int32.self).littleEndian
        }
        offset += 4

        let cursorY = data.withUnsafeBytes { bytes in
            bytes.loadUnaligned(fromByteOffset: offset, as: Int32.self).littleEndian
        }
        offset += 4

        // Skip reserved
        offset += 4

        // Validate cursor position
        if cursorX < 0 || cursorX > Int32(cols) || cursorY < 0 || cursorY > Int32(rows) {
            logger.debug(
                "Warning: cursor position out of bounds: (\(cursorX),\(cursorY)) for \(cols)x\(rows)"
            )
        }

        // Decode cells
        var cells: [[BufferCell]] = []
        var totalRows = 0

        while offset < data.count && totalRows < Int(rows) {
            guard offset < data.count else {
                logger.debug("Unexpected end of data at offset \(offset)")
                break
            }

            let marker = data[offset]
            offset += 1

            if marker == 0xFE {
                // Empty row(s)
                guard offset < data.count else {
                    logger.debug("Missing count byte for empty rows")
                    break
                }

                let count = Int(data[offset])
                offset += 1

                // Create empty rows efficiently
                // Single space cell that represents the entire empty row
                let emptyRow = [BufferCell(char: "", width: 0, fg: nil, bg: nil, attributes: nil)]
                for _ in 0..<min(count, Int(rows) - totalRows) {
                    cells.append(emptyRow)
                    totalRows += 1
                }
            } else if marker == 0xFD {
                // Row with content
                guard offset + 2 <= data.count else {
                    logger.debug("Insufficient data for cell count")
                    break
                }

                let cellCount = data.withUnsafeBytes { bytes in
                    bytes.loadUnaligned(fromByteOffset: offset, as: UInt16.self).littleEndian
                }
                offset += 2

                // Validate cell count
                guard cellCount <= cols * 2 else { // Allow for wide chars
                    logger.debug("Invalid cell count: \(cellCount) for \(cols) columns")
                    break
                }

                var rowCells: [BufferCell] = []
                var colIndex = 0

                for i in 0..<cellCount {
                    if let (cell, newOffset) = decodeCell(data, offset: offset) {
                        rowCells.append(cell)
                        offset = newOffset
                        colIndex += cell.width

                        // Stop if we exceed column count
                        if colIndex > Int(cols) {
                            logger.verbose("Warning: row \(totalRows) exceeds column count at cell \(i)")
                            break
                        }
                    } else {
                        logger.debug("Failed to decode cell \(i) in row \(totalRows) at offset \(offset)")
                        // Log the type byte for debugging
                        if offset < data.count {
                            let typeByte = data[offset]
                            logger.verbose("Type byte: 0x\(String(format: "%02X", typeByte))")
                            logger
                                .verbose(
                                    "Bits: hasExt=\((typeByte & 0x80) != 0), isUni=\((typeByte & 0x40) != 0), hasFg=\((typeByte & 0x20) != 0), hasBg=\((typeByte & 0x10) != 0), charType=\(typeByte & 0x03)"
                                )
                        }
                        break
                    }
                }

                cells.append(rowCells)
                totalRows += 1
            } else {
                logger.debug(
                    "Unknown row marker: 0x\(String(format: "%02X", marker)) at offset \(offset - 1)"
                )
                // Log surrounding bytes for debugging
                let context = 10
                let start = max(0, offset - 1 - context)
                let end = min(data.count, offset - 1 + context)
                var contextBytes = ""
                for i in start..<end {
                    if i == offset - 1 {
                        contextBytes += "[\(String(format: "%02X", data[i]))] "
                    } else {
                        contextBytes += "\(String(format: "%02X", data[i])) "
                    }
                }
                logger.verbose("Context bytes: \(contextBytes)")
                // Skip this byte and try to continue parsing
                break
            }
        }

        // Fill missing rows with empty rows if needed
        while cells.count < Int(rows) {
            cells.append([BufferCell(char: " ", width: 1, fg: nil, bg: nil, attributes: nil)])
        }

        logger.verbose("Successfully decoded buffer: \(cols)x\(rows), \(cells.count) rows")

        return BufferSnapshot(
            cols: Int(cols),
            rows: Int(rows),
            viewportY: Int(viewportY),
            cursorX: Int(cursorX),
            cursorY: Int(cursorY),
            cells: cells
        )
    }

    private func decodeCell(_ data: Data, offset: Int) -> (BufferCell, Int)? {
        guard offset < data.count else {
            logger.debug("Cell decode failed: offset \(offset) beyond data size \(data.count)")
            return nil
        }

        var currentOffset = offset
        let typeByte = data[currentOffset]
        currentOffset += 1

        // Simple space optimization
        if typeByte == 0x00 {
            return (BufferCell(char: " ", width: 1, fg: nil, bg: nil, attributes: nil), currentOffset)
        }

        // Decode type byte
        let hasExtended = (typeByte & 0x80) != 0
        let isUnicode = (typeByte & 0x40) != 0
        let hasFg = (typeByte & 0x20) != 0
        let hasBg = (typeByte & 0x10) != 0
        let isRgbFg = (typeByte & 0x08) != 0
        let isRgbBg = (typeByte & 0x04) != 0
        let charType = typeByte & 0x03

        // Read character
        var char: String
        var width: Int = 1

        if charType == 0x00 {
            // Simple space
            char = " "
        } else if isUnicode {
            // Unicode character
            // Read character length first
            guard currentOffset < data.count else {
                logger.debug("Unicode char decode failed: missing length byte")
                return nil
            }
            let charLen = Int(data[currentOffset])
            currentOffset += 1

            guard currentOffset + charLen <= data.count else {
                logger.debug("Unicode char decode failed: insufficient data for char length \(charLen)")
                return nil
            }

            let charData = data.subdata(in: currentOffset..<(currentOffset + charLen))
            char = String(data: charData, encoding: .utf8) ?? "?"
            currentOffset += charLen

            // Calculate display width for Unicode characters
            width = calculateDisplayWidth(for: char)
        } else {
            // ASCII character
            guard currentOffset < data.count else {
                logger.debug("ASCII char decode failed: missing char byte")
                return nil
            }
            let charCode = data[currentOffset]
            currentOffset += 1

            if charCode < 32 || charCode > 126 {
                // Control character or extended ASCII
                char = charCode == 0 ? " " : "?"
            } else {
                char = String(Character(UnicodeScalar(charCode)))
            }
        }

        // Read extended data if present
        var fg: Int?
        var bg: Int?
        var attributes: Int?

        if hasExtended {
            // Read attributes byte
            guard currentOffset < data.count else {
                logger.debug("Extended data decode failed: missing attributes byte")
                return nil
            }
            attributes = Int(data[currentOffset])
            currentOffset += 1

            // Read foreground color
            if hasFg {
                if isRgbFg {
                    // RGB color (3 bytes)
                    guard currentOffset + 3 <= data.count else {
                        logger.debug("RGB foreground decode failed: insufficient data")
                        return nil
                    }
                    let red = Int(data[currentOffset])
                    let green = Int(data[currentOffset + 1])
                    let blue = Int(data[currentOffset + 2])
                    fg = (red << 16) | (green << 8) | blue | 0xFF00_0000 // Add alpha for RGB
                    currentOffset += 3
                } else {
                    // Palette color (1 byte)
                    guard currentOffset < data.count else {
                        logger.debug("Palette foreground decode failed: missing color byte")
                        return nil
                    }
                    fg = Int(data[currentOffset])
                    currentOffset += 1
                }
            }

            // Read background color
            if hasBg {
                if isRgbBg {
                    // RGB color (3 bytes)
                    guard currentOffset + 3 <= data.count else {
                        logger.debug("RGB background decode failed: insufficient data")
                        return nil
                    }
                    let red = Int(data[currentOffset])
                    let green = Int(data[currentOffset + 1])
                    let blue = Int(data[currentOffset + 2])
                    bg = (red << 16) | (green << 8) | blue | 0xFF00_0000 // Add alpha for RGB
                    currentOffset += 3
                } else {
                    // Palette color (1 byte)
                    guard currentOffset < data.count else {
                        logger.debug("Palette background decode failed: missing color byte")
                        return nil
                    }
                    bg = Int(data[currentOffset])
                    currentOffset += 1
                }
            }
        }

        return (BufferCell(char: char, width: width, fg: fg, bg: bg, attributes: attributes), currentOffset)
    }

    /// Calculate display width for Unicode characters
    /// Wide characters (CJK, emoji) typically take 2 columns
    private func calculateDisplayWidth(for string: String) -> Int {
        guard let scalar = string.unicodeScalars.first else { return 1 }

        // Check for emoji and other wide characters
        if scalar.properties.isEmoji {
            return 2
        }

        // Check for East Asian wide characters
        let value = scalar.value

        // CJK ranges
        if (0x1100...0x115F).contains(value) || // Hangul Jamo
            (0x2E80...0x9FFF).contains(value) || // CJK
            (0xA960...0xA97F).contains(value) || // Hangul Jamo Extended-A
            (0xAC00...0xD7AF).contains(value) || // Hangul Syllables
            (0xF900...0xFAFF).contains(value) || // CJK Compatibility Ideographs
            (0xFE30...0xFE6F).contains(value) || // CJK Compatibility Forms
            (0xFF00...0xFF60).contains(value) || // Fullwidth Forms
            (0xFFE0...0xFFE6).contains(value) || // Fullwidth Forms
            (0x20000...0x2FFFD).contains(value) || // CJK Extension B-F
            (0x30000...0x3FFFD).contains(value)
        { // CJK Extension G
            return 2
        }

        // Zero-width characters
        if (0x200B...0x200F).contains(value) || // Zero-width spaces
            (0xFE00...0xFE0F).contains(value) || // Variation selectors
            scalar.properties.isJoinControl
        {
            return 0
        }

        return 1
    }

    func subscribe(to sessionId: String, handler: @escaping (TerminalWebSocketEvent) -> Void) {
        Task { @MainActor [weak self] in
            guard let self else { return }

            // Store the handler
            self.subscriptions[sessionId] = handler

            // Send subscription message immediately if connected
            if self.isConnected {
                try? await self.sendMessage(["type": "subscribe", "sessionId": sessionId])
            }
        }
    }

    private func subscribe(to sessionId: String) async throws {
        try await sendMessage(["type": "subscribe", "sessionId": sessionId])
    }

    func unsubscribe(from sessionId: String) {
        Task { @MainActor [weak self] in
            guard let self else { return }

            // Remove the handler
            self.subscriptions.removeValue(forKey: sessionId)

            // Send unsubscribe message immediately if connected
            if self.isConnected {
                try? await self.sendMessage(["type": "unsubscribe", "sessionId": sessionId])
            }
        }
    }

    private func sendMessage(_ message: [String: Any]) async throws {
        guard let webSocket else {
            throw WebSocketError.connectionFailed
        }

        let data = try JSONSerialization.data(withJSONObject: message)
        guard let string = String(data: data, encoding: .utf8) else {
            throw WebSocketError.invalidData
        }

        try await webSocket.send(.string(string))
    }

    private func sendPing() async throws {
        guard let webSocket else {
            throw WebSocketError.connectionFailed
        }
        try await webSocket.sendPing()
    }

    private func startPingTask() {
        stopPingTask()

        pingTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 30_000_000_000) // 30 seconds
                if !Task.isCancelled {
                    try? await self?.sendPing()
                }
            }
        }
    }

    private func stopPingTask() {
        pingTask?.cancel()
        pingTask = nil
    }

    private func handleDisconnection() {
        isConnected = false
        webSocket = nil
        stopPingTask()
        scheduleReconnect()
    }

    private func scheduleReconnect() {
        guard reconnectTask == nil else { return }

        let delay = min(pow(2.0, Double(reconnectAttempts)), 30.0)
        reconnectAttempts += 1

        logger.info("Reconnecting in \(delay)s (attempt \(reconnectAttempts))")

        reconnectTask = Task { @MainActor [weak self] in
            let nanoseconds = UInt64(delay * 1_000_000_000)
            try? await Task.sleep(nanoseconds: nanoseconds)

            if !Task.isCancelled {
                self?.reconnectTask = nil
                self?.connect()
            }
        }
    }

    func disconnect() {
        reconnectTask?.cancel()
        reconnectTask = nil
        stopPingTask()

        webSocket?.disconnect(with: .goingAway, reason: nil)
        webSocket = nil

        subscriptions.removeAll()
        isConnected = false
    }

    deinit {
        // Tasks will be cancelled automatically when the object is deallocated
        // WebSocket cleanup happens in disconnect()
    }
}

// MARK: - WebSocketDelegate

extension BufferWebSocketClient: WebSocketDelegate {
    func webSocketDidConnect(_ webSocket: WebSocketProtocol) {
        logger.info("Connected")
        isConnected = true
        isConnecting = false
        reconnectAttempts = 0
        startPingTask()

        // Re-subscribe to all sessions that have handlers
        Task { @MainActor [weak self] in
            guard let self else { return }

            let sessionIds = Array(self.subscriptions.keys)
            for sessionId in sessionIds {
                try? await self.sendMessage(["type": "subscribe", "sessionId": sessionId])
            }
        }
    }

    func webSocket(_ webSocket: WebSocketProtocol, didReceiveMessage message: WebSocketMessage) {
        handleMessage(message)
    }

    func webSocket(_ webSocket: WebSocketProtocol, didFailWithError error: Error) {
        logger.error("Error: \(error)")
        connectionError = error
        handleDisconnection()
    }

    func webSocketDidDisconnect(
        _ webSocket: WebSocketProtocol,
        closeCode: URLSessionWebSocketTask.CloseCode,
        reason: Data?
    ) {
        logger.info("Disconnected with code: \(closeCode)")
        handleDisconnection()
    }
}
