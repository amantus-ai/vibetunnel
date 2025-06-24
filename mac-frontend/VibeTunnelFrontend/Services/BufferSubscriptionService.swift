import Foundation
import Combine

@MainActor
final class BufferSubscriptionService: NSObject {
    static let shared = BufferSubscriptionService()
    
    private var webSocketTask: URLSessionWebSocketTask?
    private var session: URLSession!
    private var serverURL: URL?
    private var authHeader: String?
    
    // Subscriptions
    private var subscriptions = [String: Set<HandlerWrapper>]()
    private var isConnecting = false
    private var reconnectTimer: Timer?
    private var reconnectAttempts = 0
    
    // Magic byte for binary messages
    private let BUFFER_MAGIC_BYTE: UInt8 = 0xBF
    
    private override init() {
        super.init()
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = .infinity
        configuration.timeoutIntervalForResource = .infinity
        self.session = URLSession(configuration: configuration, delegate: self, delegateQueue: .main)
    }
    
    func configure(serverURL: URL, authHeader: String?) {
        self.serverURL = serverURL
        self.authHeader = authHeader
        connect()
    }
    
    private func connect() {
        guard let serverURL = serverURL else { 
            print("BufferSubscriptionService: No server URL configured")
            return 
        }
        guard !isConnecting, webSocketTask?.state != .running else { 
            print("BufferSubscriptionService: Already connecting or connected")
            return 
        }
        
        isConnecting = true
        
        // Convert HTTP URL to WebSocket URL
        var components = URLComponents(url: serverURL, resolvingAgainstBaseURL: false)!
        components.scheme = components.scheme == "https" ? "wss" : "ws"
        components.path = "/buffers"
        
        guard let wsURL = components.url else {
            print("BufferSubscriptionService: Failed to create WebSocket URL")
            isConnecting = false
            return
        }
        
        print("BufferSubscriptionService: Connecting to \(wsURL)")
        
        var request = URLRequest(url: wsURL)
        if let authHeader = authHeader {
            request.setValue(authHeader, forHTTPHeaderField: "Authorization")
        }
        
        webSocketTask = session.webSocketTask(with: request)
        webSocketTask?.resume()
        
        // Start receiving messages
        receiveMessage()
    }
    
    private func receiveMessage() {
        webSocketTask?.receive { [weak self] result in
            Task { @MainActor in
                guard let self = self else { return }
                
                switch result {
                case .success(let message):
                    switch message {
                    case .data(let data):
                        self.handleBinaryMessage(data)
                    case .string(let text):
                        self.handleTextMessage(text)
                    @unknown default:
                        break
                    }
                    
                    // Continue receiving messages
                    self.receiveMessage()
                    
                case .failure(let error):
                    print("WebSocket error: \(error)")
                    self.handleDisconnection()
                }
            }
        }
    }
    
    private func handleTextMessage(_ text: String) {
        do {
            guard let data = text.data(using: .utf8),
                  let message = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let type = message["type"] as? String else {
                return
            }
            
            switch type {
            case "connected":
                isConnecting = false
                reconnectAttempts = 0
                // Re-subscribe to all sessions
                for sessionId in subscriptions.keys {
                    subscribe(to: sessionId)
                }
                
            case "ping":
                sendMessage(["type": "pong"])
                
            case "subscribed":
                if let sessionId = message["sessionId"] as? String {
                    print("Subscribed to session: \(sessionId)")
                }
                
            case "error":
                if let errorMessage = message["message"] as? String {
                    print("Server error: \(errorMessage)")
                }
                
            default:
                break
            }
        } catch {
            print("Failed to parse JSON message: \(error)")
        }
    }
    
    private func handleBinaryMessage(_ data: Data) {
        guard data.count > 5 else { return }
        
        var offset = 0
        
        // Check magic byte
        let magic = data[offset]
        offset += 1
        
        guard magic == BUFFER_MAGIC_BYTE else {
            print("Invalid magic byte: \(magic)")
            return
        }
        
        // Read session ID length (4 bytes, little endian)
        guard data.count >= offset + 4 else {
            print("BufferSubscriptionService: Insufficient data for session ID length")
            return
        }
        
        let sessionIdLength = UInt32(data[offset]) |
                            (UInt32(data[offset + 1]) << 8) |
                            (UInt32(data[offset + 2]) << 16) |
                            (UInt32(data[offset + 3]) << 24)
        offset += 4
        
        // Validate session ID length
        guard sessionIdLength > 0 && sessionIdLength < 1000 else {
            print("BufferSubscriptionService: Invalid session ID length: \(sessionIdLength)")
            return
        }
        
        // Read session ID
        guard data.count >= offset + Int(sessionIdLength) else {
            print("BufferSubscriptionService: Insufficient data for session ID")
            return
        }
        
        let sessionIdData = data.subdata(in: offset..<(offset + Int(sessionIdLength)))
        guard let sessionId = String(data: sessionIdData, encoding: .utf8) else {
            print("BufferSubscriptionService: Failed to decode session ID")
            return
        }
        offset += Int(sessionIdLength)
        
        // Remaining data is the buffer
        let bufferData = data.subdata(in: offset..<data.count)
        
        // Decode buffer
        do {
            let snapshot = try TerminalBufferDecoder.decode(from: bufferData)
            
            // Notify all handlers for this session
            if let handlers = subscriptions[sessionId] {
                for handlerWrapper in handlers {
                    handlerWrapper.handler(snapshot)
                }
            }
        } catch {
            print("Failed to decode buffer: \(error)")
        }
    }
    
    private func sendMessage(_ message: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: message),
              let string = String(data: data, encoding: .utf8) else {
            print("BufferSubscriptionService: Failed to serialize message")
            return
        }
        
        guard let task = webSocketTask, task.state == .running else {
            print("BufferSubscriptionService: WebSocket not running, queueing message")
            // Queue subscribe/unsubscribe messages for later
            if let type = message["type"] as? String,
               (type == "subscribe" || type == "unsubscribe") {
                // Will be re-sent when connection is established
            }
            return
        }
        
        task.send(.string(string)) { error in
            if let error = error {
                print("BufferSubscriptionService: Send error: \(error)")
            }
        }
    }
    
    private func subscribe(to sessionId: String) {
        sendMessage(["type": "subscribe", "sessionId": sessionId])
    }
    
    private func unsubscribe(from sessionId: String) {
        sendMessage(["type": "unsubscribe", "sessionId": sessionId])
    }
    
    func subscribe(sessionId: String, handler: @escaping (TerminalBufferSnapshot) -> Void) -> () -> Void {
        // Add handler to subscriptions
        if subscriptions[sessionId] == nil {
            subscriptions[sessionId] = Set()
            // Send subscribe message if connected
            if webSocketTask?.state == .running {
                subscribe(to: sessionId)
            }
        }
        
        // Store handler wrapper for removal
        let handlerWrapper = HandlerWrapper(handler: handler)
        subscriptions[sessionId]?.insert(handlerWrapper)
        
        // Return unsubscribe function
        return { [weak self] in
            Task { @MainActor in
                guard let self = self else { return }
                self.subscriptions[sessionId]?.remove(handlerWrapper)
                
                // If no more handlers, unsubscribe from session
                if self.subscriptions[sessionId]?.isEmpty == true {
                    self.subscriptions.removeValue(forKey: sessionId)
                    if self.webSocketTask?.state == .running {
                        self.unsubscribe(from: sessionId)
                    }
                }
            }
        }
    }
    
    private func handleDisconnection() {
        isConnecting = false
        webSocketTask = nil
        scheduleReconnect()
    }
    
    private func scheduleReconnect() {
        reconnectTimer?.invalidate()
        
        let delay = min(pow(2.0, Double(reconnectAttempts)), 30.0)
        reconnectAttempts += 1
        
        reconnectTimer = Timer.scheduledTimer(withTimeInterval: delay, repeats: false) { [weak self] _ in
            Task { @MainActor in
                self?.connect()
            }
        }
    }
    
    func disconnect() {
        reconnectTimer?.invalidate()
        reconnectTimer = nil
        
        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketTask = nil
        
        subscriptions.removeAll()
    }
}

// Handler wrapper to make closures hashable
private class HandlerWrapper: Hashable {
    let id = UUID()
    let handler: (TerminalBufferSnapshot) -> Void
    
    init(handler: @escaping (TerminalBufferSnapshot) -> Void) {
        self.handler = handler
    }
    
    static func == (lhs: HandlerWrapper, rhs: HandlerWrapper) -> Bool {
        lhs.id == rhs.id
    }
    
    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }
}

extension BufferSubscriptionService: URLSessionWebSocketDelegate {
    nonisolated func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        Task { @MainActor in
            print("WebSocket connected")
            self.isConnecting = false
            self.reconnectAttempts = 0
            
            // Re-subscribe to all sessions after connection is established
            for sessionId in self.subscriptions.keys {
                self.subscribe(to: sessionId)
            }
        }
    }
    
    nonisolated func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        Task { @MainActor in
            print("WebSocket disconnected")
            self.handleDisconnection()
        }
    }
}