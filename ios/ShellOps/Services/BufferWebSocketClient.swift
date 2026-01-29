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
    // WebSocket v3 framing
    private static let v3Magic: UInt16 = 0x5654 // "VT" LE
    private static let v3Version: UInt8 = 0x03

    private enum V3Type: UInt8 {
        case hello = 1
        case welcome = 2

        case subscribe = 10
        case unsubscribe = 11

        case stdout = 20
        case snapshotVT = 21
        case event = 22
        case error = 23

        case inputText = 30
        case inputKey = 31
        case resize = 32
        case kill = 33
        case resetSize = 34

        case ping = 40
        case pong = 41
    }

    private enum V3SubscribeFlags: UInt32 {
        case stdout = 1
        case snapshots = 2
        case events = 4
    }

    private struct V3Frame {
        let type: UInt8
        let sessionId: String
        let payload: Data
    }

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
        // Use connectionURL to get the best URL (HTTPS when available)
        return serverConfig.connectionURL()
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
        guard !self.isConnecting else {
            self.logger.warning("Already connecting, ignoring connect() call")
            return
        }
        guard !self.isConnected else {
            self.logger.warning("Already connected, ignoring connect() call")
            return
        }
        guard let baseURL else {
            self.connectionError = WebSocketError.invalidURL
            return
        }

        self.isConnecting = true
        self.connectionError = nil

        // Convert HTTP URL to WebSocket URL
        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)
        components?.scheme = baseURL.scheme == "https" ? "wss" : "ws"
        components?.path = "/ws"

        // Add authentication token as query parameter (not header)
        if let token = authenticationService?.getTokenForQuery() {
            components?.queryItems = [URLQueryItem(name: "token", value: token)]
        }

        guard let wsURL = components?.url else {
            self.connectionError = WebSocketError.invalidURL
            self.isConnecting = false
            return
        }

        self.logger.info("Connecting to \(wsURL)")

        // Disconnect existing WebSocket if any
        self.webSocket?.disconnect(with: .goingAway, reason: nil)

        // Create new WebSocket
        self.webSocket = self.webSocketFactory.createWebSocket()
        self.webSocket?.delegate = self

        // Build headers
        var headers: [String: String] = [:]

        // Add authentication header from authentication service
        if let authHeaders = authenticationService?.getAuthHeader() {
            headers.merge(authHeaders) { _, new in new }
        }

        // Connect
        Task {
            do {
                try await self.webSocket?.connect(to: wsURL, with: headers)
            } catch {
                self.logger.error("Connection failed: \(error)")
                self.connectionError = error
                self.isConnecting = false
                self.scheduleReconnect()
            }
        }
    }

    private func handleMessage(_ message: WebSocketMessage) {
        switch message {
        case let .data(data):
            self.handleBinaryMessage(data)

        case let .string(text):
            self.handleTextMessage(text)
        }
    }

    private func handleTextMessage(_ text: String) {
        // v3 is binary-framed. Keep logging for debugging only.
        self.logger.debug("Received text WS message (ignored): \(text.prefix(80))")
    }

    private func handleBinaryMessage(_ data: Data) {
        guard let frame = self.decodeV3Frame(data) else {
            self.logger.debug("Failed to decode v3 frame (\(data.count) bytes)")
            return
        }

        guard let type = V3Type(rawValue: frame.type) else {
            self.logger.debug("Unknown v3 message type: \(frame.type)")
            return
        }

        let sessionId = frame.sessionId
        let payload = frame.payload

        switch type {
        case .snapshotVT:
            if let event = decodeTerminalEvent(from: payload),
               let handler = subscriptions[sessionId]
            {
                handler(event)
            }

        case .event:
            self.handleV3Event(sessionId: sessionId, payload: payload)

        case .stdout:
            // Optional: map to output events if needed later.
            if let text = String(data: payload, encoding: .utf8),
               let handler = subscriptions[sessionId]
            {
                handler(.output(timestamp: Date().timeIntervalSince1970, data: text))
            }

        case .error:
            let message = String(data: payload, encoding: .utf8) ?? "Unknown error"
            self.logger.warning("Server error: \(message)")
            if let handler = subscriptions[sessionId] {
                handler(.alert(title: "Server Error", message: message))
            }

        default:
            break
        }
    }

    private func handleV3Event(sessionId: String, payload: Data) {
        guard let handler = subscriptions[sessionId] else { return }
        struct V3Event: Decodable {
            let kind: String
            let exitCode: Int?
        }

        guard let event = try? JSONDecoder().decode(V3Event.self, from: payload) else {
            return
        }

        if event.kind == "exit" {
            handler(.exit(code: event.exitCode ?? 0))
        }
    }

    private func decodeTerminalEvent(from data: Data) -> TerminalWebSocketEvent? {
        // This is binary buffer data, not JSON
        // Decode the binary terminal buffer
        guard let bufferSnapshot = decodeBinaryBuffer(data) else {
            self.logger.debug("Failed to decode binary buffer")
            return nil
        }

        self.logger.verbose("Decoded buffer: \(bufferSnapshot.cols)x\(bufferSnapshot.rows)")

        // Return buffer update event
        return .bufferUpdate(snapshot: bufferSnapshot)
    }

    private func decodeBinaryBuffer(_ data: Data) -> BufferSnapshot? {
        var offset = 0

        // Read header
        guard data.count >= 32 else {
            self.logger.debug("Buffer too small for header: \(data.count) bytes (need 32)")
            return nil
        }

        // Magic bytes "VT" (0x5654 in little endian)
        let magic = data.withUnsafeBytes { bytes in
            bytes.loadUnaligned(fromByteOffset: offset, as: UInt16.self).littleEndian
        }
        offset += 2

        guard magic == 0x5654 else {
            self.logger.warning("Invalid magic bytes: \(String(format: "0x%04X", magic)), expected 0x5654")
            return nil
        }

        // Version
        let version = data[offset]
        offset += 1

        guard version == 0x01 else {
            self.logger.warning("Unsupported version: 0x\(String(format: "%02X", version)), expected 0x01")
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
            self.logger.debug("Insufficient data for header fields")
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
        guard cols > 0 && cols <= 1000 && rows > 0 && rows <= 1000 else {
            self.logger.warning("Invalid dimensions: \(cols)x\(rows)")
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
            self.logger.debug(
                "Warning: cursor position out of bounds: (\(cursorX),\(cursorY)) for \(cols)x\(rows)")
        }

        // Decode cells
        var cells: [[BufferCell]] = []
        var totalRows = 0

        while offset < data.count, totalRows < Int(rows) {
            guard offset < data.count else {
                self.logger.debug("Unexpected end of data at offset \(offset)")
                break
            }

            let marker = data[offset]
            offset += 1

            if marker == 0xFE {
                // Empty row(s)
                guard offset < data.count else {
                    self.logger.debug("Missing count byte for empty rows")
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
                    self.logger.debug("Insufficient data for cell count")
                    break
                }

                let cellCount = data.withUnsafeBytes { bytes in
                    bytes.loadUnaligned(fromByteOffset: offset, as: UInt16.self).littleEndian
                }
                offset += 2

                // Validate cell count
                guard cellCount <= cols * 2 else { // Allow for wide chars
                    self.logger.debug("Invalid cell count: \(cellCount) for \(cols) columns")
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
                            self.logger.verbose("Warning: row \(totalRows) exceeds column count at cell \(i)")
                            break
                        }
                    } else {
                        self.logger.debug("Failed to decode cell \(i) in row \(totalRows) at offset \(offset)")
                        // Log the type byte for debugging
                        if offset < data.count {
                            let typeByte = data[offset]
                            self.logger.verbose("Type byte: 0x\(String(format: "%02X", typeByte))")
                            self.logger
                                .verbose(
                                    "Bits: hasExt=\((typeByte & 0x80) != 0), isUni=\((typeByte & 0x40) != 0), hasFg=\((typeByte & 0x20) != 0), hasBg=\((typeByte & 0x10) != 0), charType=\(typeByte & 0x03)")
                        }
                        break
                    }
                }

                cells.append(rowCells)
                totalRows += 1
            } else {
                self.logger.debug(
                    "Unknown row marker: 0x\(String(format: "%02X", marker)) at offset \(offset - 1)")
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
                self.logger.verbose("Context bytes: \(contextBytes)")
                // Skip this byte and try to continue parsing
                break
            }
        }

        // Fill missing rows with empty rows if needed
        while cells.count < Int(rows) {
            cells.append([BufferCell(char: " ", width: 1, fg: nil, bg: nil, attributes: nil)])
        }

        self.logger.verbose("Successfully decoded buffer: \(cols)x\(rows), \(cells.count) rows")

        return BufferSnapshot(
            cols: Int(cols),
            rows: Int(rows),
            viewportY: Int(viewportY),
            cursorX: Int(cursorX),
            cursorY: Int(cursorY),
            cells: cells)
    }

    private func decodeCell(_ data: Data, offset: Int) -> (BufferCell, Int)? {
        guard offset < data.count else {
            self.logger.debug("Cell decode failed: offset \(offset) beyond data size \(data.count)")
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
        var width = 1

        if charType == 0x00 {
            // Simple space
            char = " "
        } else if isUnicode {
            // Unicode character
            // Read character length first
            guard currentOffset < data.count else {
                self.logger.debug("Unicode char decode failed: missing length byte")
                return nil
            }
            let charLen = Int(data[currentOffset])
            currentOffset += 1

            guard currentOffset + charLen <= data.count else {
                self.logger.debug("Unicode char decode failed: insufficient data for char length \(charLen)")
                return nil
            }

            let charData = data.subdata(in: currentOffset..<(currentOffset + charLen))
            char = String(data: charData, encoding: .utf8) ?? "?"
            currentOffset += charLen

            // Calculate display width for Unicode characters
            width = self.calculateDisplayWidth(for: char)
        } else {
            // ASCII character
            guard currentOffset < data.count else {
                self.logger.debug("ASCII char decode failed: missing char byte")
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
                self.logger.debug("Extended data decode failed: missing attributes byte")
                return nil
            }
            attributes = Int(data[currentOffset])
            currentOffset += 1

            // Read foreground color
            if hasFg {
                if isRgbFg {
                    // RGB color (3 bytes)
                    guard currentOffset + 3 <= data.count else {
                        self.logger.debug("RGB foreground decode failed: insufficient data")
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
                        self.logger.debug("Palette foreground decode failed: missing color byte")
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
                        self.logger.debug("RGB background decode failed: insufficient data")
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
                        self.logger.debug("Palette background decode failed: missing color byte")
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
                try? await self.sendV3Subscribe(sessionId: sessionId)
            }
        }
    }

    private func subscribe(to sessionId: String) async throws {
        try await self.sendV3Subscribe(sessionId: sessionId)
    }

    func unsubscribe(from sessionId: String) {
        Task { @MainActor [weak self] in
            guard let self else { return }

            // Remove the handler
            self.subscriptions.removeValue(forKey: sessionId)

            // Send unsubscribe message immediately if connected
            if self.isConnected {
                try? await self.sendV3Unsubscribe(sessionId: sessionId)
            }
        }
    }

    private func sendV3Subscribe(sessionId: String) async throws {
        let flags: UInt32 = V3SubscribeFlags.snapshots.rawValue | V3SubscribeFlags.events.rawValue
        var payload = Data(count: 12)
        payload.withUnsafeMutableBytes { bytes in
            bytes.storeBytes(of: flags.littleEndian, toByteOffset: 0, as: UInt32.self)
            bytes.storeBytes(of: UInt32(0).littleEndian, toByteOffset: 4, as: UInt32.self)
            bytes.storeBytes(of: UInt32(0).littleEndian, toByteOffset: 8, as: UInt32.self)
        }
        try await self.sendV3Frame(type: .subscribe, sessionId: sessionId, payload: payload)
    }

    private func sendV3Unsubscribe(sessionId: String) async throws {
        try await self.sendV3Frame(type: .unsubscribe, sessionId: sessionId, payload: Data())
    }

    func sendInput(sessionId: String, text: String) async -> Bool {
        guard let webSocket else {
            return false
        }

        guard let payload = text.data(using: .utf8) else { return false }
        do {
            let frame = try self.encodeV3Frame(type: .inputText, sessionId: sessionId, payload: payload)
            try await webSocket.send(.data(frame))
            return true
        } catch {
            self.logger.error("Failed to send input over v3 socket: \(error)")
            return false
        }
    }

    func resize(sessionId: String, cols: Int, rows: Int) async -> Bool {
        guard let webSocket else { return false }
        var payload = Data(count: 8)
        payload.withUnsafeMutableBytes { bytes in
            bytes.storeBytes(of: UInt32(cols).littleEndian, toByteOffset: 0, as: UInt32.self)
            bytes.storeBytes(of: UInt32(rows).littleEndian, toByteOffset: 4, as: UInt32.self)
        }
        do {
            let frame = try self.encodeV3Frame(type: .resize, sessionId: sessionId, payload: payload)
            try await webSocket.send(.data(frame))
            return true
        } catch {
            self.logger.error("Failed to send resize over v3 socket: \(error)")
            return false
        }
    }

    private func sendV3Frame(type: V3Type, sessionId: String, payload: Data) async throws {
        guard let webSocket else { throw WebSocketError.connectionFailed }
        let frame = try self.encodeV3Frame(type: type, sessionId: sessionId, payload: payload)
        try await webSocket.send(.data(frame))
    }

    private func encodeV3Frame(type: V3Type, sessionId: String, payload: Data) throws -> Data {
        guard let sessionIdData = sessionId.data(using: .utf8) else { throw WebSocketError.invalidData }
        var out = Data()

        var magicLE = Self.v3Magic.littleEndian
        out.append(Data(bytes: &magicLE, count: 2))
        out.append(Self.v3Version)
        out.append(type.rawValue)

        var sessionLenLE = UInt32(sessionIdData.count).littleEndian
        out.append(Data(bytes: &sessionLenLE, count: 4))
        out.append(sessionIdData)

        var payloadLenLE = UInt32(payload.count).littleEndian
        out.append(Data(bytes: &payloadLenLE, count: 4))
        out.append(payload)

        return out
    }

    private func decodeV3Frame(_ data: Data) -> V3Frame? {
        guard data.count >= 2 + 1 + 1 + 4 + 4 else { return nil }
        var offset = 0

        let magic = data.withUnsafeBytes { bytes in
            bytes.loadUnaligned(fromByteOffset: offset, as: UInt16.self).littleEndian
        }
        offset += 2
        guard magic == Self.v3Magic else { return nil }

        let version = data[offset]
        offset += 1
        guard version == Self.v3Version else { return nil }

        let type = data[offset]
        offset += 1

        let sessionLen = data.withUnsafeBytes { bytes in
            bytes.loadUnaligned(fromByteOffset: offset, as: UInt32.self).littleEndian
        }
        offset += 4

        guard data.count >= offset + Int(sessionLen) + 4 else { return nil }
        let sessionIdData = data.subdata(in: offset..<(offset + Int(sessionLen)))
        offset += Int(sessionLen)
        guard let sessionId = String(data: sessionIdData, encoding: .utf8) else { return nil }

        let payloadLen = data.withUnsafeBytes { bytes in
            bytes.loadUnaligned(fromByteOffset: offset, as: UInt32.self).littleEndian
        }
        offset += 4

        guard data.count >= offset + Int(payloadLen) else { return nil }
        let payload = data.subdata(in: offset..<(offset + Int(payloadLen)))
        return V3Frame(type: type, sessionId: sessionId, payload: payload)
    }

    private func sendPing() async throws {
        guard let webSocket else {
            throw WebSocketError.connectionFailed
        }
        try await webSocket.sendPing()
    }

    private func startPingTask() {
        self.stopPingTask()

        self.pingTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 30_000_000_000) // 30 seconds
                if !Task.isCancelled {
                    try? await self?.sendPing()
                }
            }
        }
    }

    private func stopPingTask() {
        self.pingTask?.cancel()
        self.pingTask = nil
    }

    private func handleDisconnection() {
        self.isConnected = false
        self.webSocket = nil
        self.stopPingTask()
        self.scheduleReconnect()
    }

    private func scheduleReconnect() {
        guard self.reconnectTask == nil else { return }

        let delay = min(pow(2.0, Double(reconnectAttempts)), 30.0)
        self.reconnectAttempts += 1

        self.logger.info("Reconnecting in \(delay)s (attempt \(self.reconnectAttempts))")

        self.reconnectTask = Task { @MainActor [weak self] in
            let nanoseconds = UInt64(delay * 1_000_000_000)
            try? await Task.sleep(nanoseconds: nanoseconds)

            if !Task.isCancelled {
                self?.reconnectTask = nil
                self?.connect()
            }
        }
    }

    func disconnect() {
        self.reconnectTask?.cancel()
        self.reconnectTask = nil
        self.stopPingTask()

        self.webSocket?.disconnect(with: .goingAway, reason: nil)
        self.webSocket = nil

        self.subscriptions.removeAll()
        self.isConnected = false
    }

    deinit {
        // Tasks will be cancelled automatically when the object is deallocated
        // WebSocket cleanup happens in disconnect()
    }
}

// MARK: - WebSocketDelegate

extension BufferWebSocketClient: WebSocketDelegate {
    func webSocketDidConnect(_ webSocket: WebSocketProtocol) {
        self.logger.info("Connected")
        self.isConnected = true
        self.isConnecting = false
        self.reconnectAttempts = 0
        self.startPingTask()

        // Re-subscribe to all sessions that have handlers
        Task { @MainActor [weak self] in
            guard let self else { return }

            let sessionIds = Array(self.subscriptions.keys)
            for sessionId in sessionIds {
                try? await self.sendV3Subscribe(sessionId: sessionId)
            }
        }
    }

    func webSocket(_ webSocket: WebSocketProtocol, didReceiveMessage message: WebSocketMessage) {
        self.handleMessage(message)
    }

    func webSocket(_ webSocket: WebSocketProtocol, didFailWithError error: Error) {
        self.logger.error("Error: \(error)")
        self.connectionError = error
        self.handleDisconnection()
    }

    func webSocketDidDisconnect(
        _ webSocket: WebSocketProtocol,
        closeCode: URLSessionWebSocketTask.CloseCode,
        reason: Data?)
    {
        self.logger.info("Disconnected with code: \(closeCode)")
        self.handleDisconnection()
    }
}
