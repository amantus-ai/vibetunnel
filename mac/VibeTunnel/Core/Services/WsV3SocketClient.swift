import Foundation
import OSLog

/// WebSocket v3 client for VibeTunnel.
///
/// Single connection used for:
/// - Global server events (`EVENT` frames; subscribe with empty sessionId)
/// - Session control (input/key/resize/kill)
@MainActor
final class WsV3SocketClient: NSObject {
    static let shared = WsV3SocketClient()

    private struct ConnectConfig: Equatable {
        let serverPort: String
        let authMode: String
        let token: String?
    }

    enum ConnectionState: Equatable {
        case disconnected
        case connecting
        case connected
    }

    // MARK: - WS v3 framing

    private nonisolated static let magic: UInt16 = 0x5654 // "VT" LE
    private nonisolated static let version: UInt8 = 3

    enum MessageType: UInt8 {
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

    struct SubscribeFlags: OptionSet {
        let rawValue: UInt32
        static let stdout = SubscribeFlags(rawValue: 1 << 0)
        static let snapshots = SubscribeFlags(rawValue: 1 << 1)
        static let events = SubscribeFlags(rawValue: 1 << 2)
    }

    struct Frame {
        let type: MessageType
        let sessionId: String
        let payload: Data
    }

    enum WsV3Error: Error {
        case invalidFrame
        case invalidMagic
        case unsupportedVersion
        case invalidUTF8
    }

    // MARK: - State

    private let logger = Logger(subsystem: BundleIdentifiers.main, category: "WsV3SocketClient")
    private var urlSession: URLSession?
    private var webSocketTask: URLSessionWebSocketTask?
    private var receiveTask: Task<Void, Never>?
    private var pingTask: Task<Void, Never>?
    private var reconnectTask: Task<Void, Never>?
    private var reconnectAttempt = 0
    private var lastConnectConfig: ConnectConfig?
    private var shouldReconnect = false

    private var pendingSends: [Data] = []
    private var wantsGlobalEvents = false

    private(set) var state: ConnectionState = .disconnected {
        didSet {
            if oldValue != self.state {
                self.onConnectionStateChange?(self.state)
            }
        }
    }

    var onConnectionStateChange: ((ConnectionState) -> Void)?
    var onServerEvent: ((ServerEvent, String) -> Void)?

    // MARK: - Public API

    func connect(serverPort: String, authMode: String, token: String?) {
        guard self.state != .connecting else { return }
        guard self.state != .connected else { return }

        if authMode != "none", token == nil {
            self.logger.error("WS v3 connect blocked: missing token in auth mode '\(authMode, privacy: .public)'")
            return
        }

        guard let request = self.makeRequest(serverPort: serverPort, token: token) else {
            self.logger.error("WS v3 connect failed: invalid URL")
            return
        }

        self.logger.info("Connecting WS v3: \(request.url?.absoluteString ?? "-", privacy: .public)")
        self.state = .connecting
        self.lastConnectConfig = ConnectConfig(serverPort: serverPort, authMode: authMode, token: token)
        self.shouldReconnect = true

        self.disconnectInternal(code: .goingAway)

        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 0
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: .main)
        self.urlSession = session

        let task = session.webSocketTask(with: request)
        self.webSocketTask = task
        task.resume()
    }

    func disconnect() {
        self.logger.info("Disconnecting WS v3")
        self.shouldReconnect = false
        self.lastConnectConfig = nil
        self.disconnectInternal(code: .goingAway)
        self.state = .disconnected
    }

    func subscribeGlobalEvents(
        snapshotMinIntervalMs: UInt32 = 0,
        snapshotMaxIntervalMs: UInt32 = 0)
    {
        self.wantsGlobalEvents = true

        let payload = Self.encodeSubscribePayload(
            flags: [.events],
            snapshotMinIntervalMs: snapshotMinIntervalMs,
            snapshotMaxIntervalMs: snapshotMaxIntervalMs)

        let frame = Self.encodeFrame(type: .subscribe, sessionId: "", payload: payload)
        self.send(frame)
    }

    func sendInputText(sessionId: String, text: String) {
        guard let payload = text.data(using: .utf8) else { return }
        self.send(Self.encodeFrame(type: .inputText, sessionId: sessionId, payload: payload))
    }

    func sendInputKey(sessionId: String, key: String) {
        guard let payload = key.data(using: .utf8) else { return }
        self.send(Self.encodeFrame(type: .inputKey, sessionId: sessionId, payload: payload))
    }

    func sendResize(sessionId: String, cols: UInt32, rows: UInt32) {
        var payload = Data()
        payload.appendLE(cols)
        payload.appendLE(rows)
        self.send(Self.encodeFrame(type: .resize, sessionId: sessionId, payload: payload))
    }

    func sendKill(sessionId: String, signal: String = "SIGTERM") {
        let payload = signal.data(using: .utf8) ?? Data()
        self.send(Self.encodeFrame(type: .kill, sessionId: sessionId, payload: payload))
    }

    func sendResetSize(sessionId: String) {
        self.send(Self.encodeFrame(type: .resetSize, sessionId: sessionId, payload: Data()))
    }

    // MARK: - Internals

    private func makeRequest(serverPort: String, token: String?) -> URLRequest? {
        var components = URLComponents()
        components.scheme = "ws"
        components.host = "localhost"
        components.port = Int(serverPort)
        components.path = APIEndpoints.ws

        if let token, !token.isEmpty {
            components.queryItems = [URLQueryItem(name: "token", value: token)]
        }

        guard let url = components.url else { return nil }

        var request = URLRequest(url: url)
        request.setValue("mac-app", forHTTPHeaderField: "X-VibeTunnel-Client")

        if let token, !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        return request
    }

    private func disconnectInternal(code: URLSessionWebSocketTask.CloseCode) {
        self.reconnectTask?.cancel()
        self.reconnectTask = nil

        self.pingTask?.cancel()
        self.pingTask = nil

        self.receiveTask?.cancel()
        self.receiveTask = nil

        self.webSocketTask?.cancel(with: code, reason: nil)
        self.webSocketTask = nil

        self.urlSession?.invalidateAndCancel()
        self.urlSession = nil
    }

    private func scheduleReconnect(serverPort: String, authMode: String, token: String?) {
        guard self.reconnectTask == nil else { return }

        self.reconnectAttempt += 1
        let delaySeconds = min(30.0, pow(2.0, Double(self.reconnectAttempt - 1)))
        self.logger.info("Scheduling WS v3 reconnect in \(delaySeconds, privacy: .public)s")

        self.reconnectTask = Task { [weak self] in
            guard let self else { return }
            try? await Task.sleep(nanoseconds: UInt64(delaySeconds * 1_000_000_000))
            await MainActor.run {
                self.reconnectTask = nil
                self.connect(serverPort: serverPort, authMode: authMode, token: token)
            }
        }
    }

    private func startPingLoop() {
        self.pingTask?.cancel()
        self.pingTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 30 * 1_000_000_000)
                if Task.isCancelled { return }
                self.send(Self.encodeFrame(type: .ping, sessionId: "", payload: Data()))
            }
        }
    }

    private func startReceiveLoop(serverPort: String, authMode: String, token: String?) {
        self.receiveTask?.cancel()
        self.receiveTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled, let task = await MainActor.run(body: { self.webSocketTask }) {
                do {
                    let message = try await task.receive()
                    await MainActor.run { self.handle(message) }
                } catch {
                    await MainActor.run {
                        self.logger.warning("WS v3 receive failed: \(String(describing: error), privacy: .public)")
                        self.state = .disconnected
                        self.disconnectInternal(code: .abnormalClosure)
                        self.scheduleReconnect(serverPort: serverPort, authMode: authMode, token: token)
                    }
                    return
                }
            }
        }
    }

    private func handle(_ message: URLSessionWebSocketTask.Message) {
        switch message {
        case let .data(data):
            guard let frame = try? Self.decodeFrame(data) else { return }
            switch frame.type {
            case .welcome:
                self.reconnectAttempt = 0
                self.state = .connected
                self.flushPendingSends()
                self.startPingLoop()
            case .event:
                self.handleEventFrame(frame)
            case .error:
                let msg = String(data: frame.payload, encoding: .utf8) ?? "Unknown error"
                self.logger.error("WS v3 server ERROR: \(msg, privacy: .public)")
            default:
                break
            }
        case .string:
            // v3 is binary framed; ignore.
            return
        @unknown default:
            return
        }
    }

    private func handleEventFrame(_ frame: Frame) {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        do {
            let event = try decoder.decode(ServerEvent.self, from: frame.payload)
            self.onServerEvent?(event, frame.sessionId)
        } catch {
            let text = String(data: frame.payload, encoding: .utf8) ?? "-"
            self.logger.warning("Failed to decode ServerEvent JSON: \(text.prefix(200), privacy: .public)")
        }
    }

    private func send(_ data: Data) {
        guard self.state == .connected, let task = self.webSocketTask else {
            self.pendingSends.append(data)
            return
        }

        Task {
            do {
                try await task.send(.data(data))
            } catch {
                await MainActor.run {
                    self.logger.warning("WS v3 send failed: \(String(describing: error), privacy: .public)")
                }
            }
        }
    }

    private func flushPendingSends() {
        guard self.state == .connected, let task = self.webSocketTask else { return }
        let frames = self.pendingSends
        self.pendingSends.removeAll(keepingCapacity: true)

        for data in frames {
            Task {
                do {
                    try await task.send(.data(data))
                } catch {
                    await MainActor.run {
                        self.logger.warning("WS v3 send failed (flush): \(String(describing: error), privacy: .public)")
                    }
                }
            }
        }
    }

    // MARK: - Encoding/Decoding

    nonisolated static func encodeSubscribePayload(
        flags: SubscribeFlags,
        snapshotMinIntervalMs: UInt32,
        snapshotMaxIntervalMs: UInt32) -> Data
    {
        var out = Data()
        out.appendLE(flags.rawValue)
        out.appendLE(snapshotMinIntervalMs)
        out.appendLE(snapshotMaxIntervalMs)
        return out
    }

    nonisolated static func encodeFrame(type: MessageType, sessionId: String, payload: Data) -> Data {
        let sessionIdData = sessionId.data(using: .utf8) ?? Data()

        var out = Data()
        out.appendLE(Self.magic)
        out.append(Self.version)
        out.append(type.rawValue)
        out.appendLE(UInt32(sessionIdData.count))
        out.append(sessionIdData)
        out.appendLE(UInt32(payload.count))
        out.append(payload)
        return out
    }

    nonisolated static func decodeFrame(_ data: Data) throws -> Frame {
        if data.count < 2 + 1 + 1 + 4 + 4 { throw WsV3Error.invalidFrame }

        var offset = 0
        let magic = data.readLEUInt16(at: &offset)
        if magic != Self.magic { throw WsV3Error.invalidMagic }

        let version = data.readUInt8(at: &offset)
        if version != Self.version { throw WsV3Error.unsupportedVersion }

        guard let type = MessageType(rawValue: data.readUInt8(at: &offset)) else {
            throw WsV3Error.invalidFrame
        }

        let sessionIdLen = Int(data.readLEUInt32(at: &offset))
        guard offset + sessionIdLen <= data.count else { throw WsV3Error.invalidFrame }
        let sessionIdData = data.subdata(in: offset..<offset + sessionIdLen)
        offset += sessionIdLen
        guard let sessionId = String(data: sessionIdData, encoding: .utf8) else { throw WsV3Error.invalidUTF8 }

        let payloadLen = Int(data.readLEUInt32(at: &offset))
        guard offset + payloadLen <= data.count else { throw WsV3Error.invalidFrame }
        let payload = data.subdata(in: offset..<offset + payloadLen)

        return Frame(type: type, sessionId: sessionId, payload: payload)
    }
}

// MARK: - URLSessionWebSocketDelegate

extension WsV3SocketClient: URLSessionWebSocketDelegate {
    nonisolated func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didOpenWithProtocol protocol: String?)
    {
        Task { @MainActor in
            self.logger.info("WS v3 opened")
            // Expect WELCOME next; keep state as connecting until then.
            guard let config = self.lastConnectConfig ?? self.inferServerManagerConfig() else { return }
            self.startReceiveLoop(
                serverPort: config.serverPort,
                authMode: config.authMode,
                token: config.token)
        }
    }

    nonisolated func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
        reason: Data?)
    {
        Task { @MainActor in
            self.logger.info("WS v3 closed: \(String(describing: closeCode), privacy: .public)")
            self.state = .disconnected
            if self.shouldReconnect, let config = self.lastConnectConfig {
                self.disconnectInternal(code: closeCode)
                self.scheduleReconnect(serverPort: config.serverPort, authMode: config.authMode, token: config.token)
            }
        }
    }

    @MainActor
    private func inferServerManagerConfig() -> ConnectConfig? {
        let serverManager = ServerManager.shared
        return ConnectConfig(
            serverPort: serverManager.port,
            authMode: serverManager.authMode,
            token: serverManager.localAuthToken)
    }
}

// MARK: - Data helpers

extension Data {
    fileprivate mutating func appendLE(_ value: some FixedWidthInteger) {
        var v = value.littleEndian
        Swift.withUnsafeBytes(of: &v) { self.append(contentsOf: $0) }
    }

    fileprivate mutating func append(_ byte: UInt8) {
        self.append(contentsOf: [byte])
    }

    fileprivate func readUInt8(at offset: inout Int) -> UInt8 {
        defer { offset += 1 }
        return self[self.startIndex.advanced(by: offset)]
    }

    fileprivate func readLEUInt16(at offset: inout Int) -> UInt16 {
        let i0 = self.startIndex.advanced(by: offset)
        let i1 = self.startIndex.advanced(by: offset + 1)
        offset += 2
        return UInt16(self[i0]) | (UInt16(self[i1]) << 8)
    }

    fileprivate func readLEUInt32(at offset: inout Int) -> UInt32 {
        let i0 = UInt32(self[self.startIndex.advanced(by: offset)])
        let i1 = UInt32(self[self.startIndex.advanced(by: offset + 1)]) << 8
        let i2 = UInt32(self[self.startIndex.advanced(by: offset + 2)]) << 16
        let i3 = UInt32(self[self.startIndex.advanced(by: offset + 3)]) << 24
        offset += 4
        return i0 | i1 | i2 | i3
    }
}
