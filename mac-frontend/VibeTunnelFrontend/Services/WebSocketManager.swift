import Combine
import Foundation

@MainActor
final class WebSocketManager: NSObject {
    private var webSocketTask: URLSessionWebSocketTask?
    private var session: URLSession!
    
    let sessionId: String
    let serverURL: URL
    let authHeader: String?
    
    @Published var isConnected = false
    @Published var error: Error?
    
    var onMessage: ((Data) -> Void)?
    var onTextMessage: ((String) -> Void)?
    
    init(sessionId: String, serverURL: URL, authHeader: String?) {
        self.sessionId = sessionId
        self.serverURL = serverURL
        self.authHeader = authHeader
        super.init()
        
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = .infinity
        configuration.timeoutIntervalForResource = .infinity
        self.session = URLSession(configuration: configuration, delegate: self, delegateQueue: .main)
    }
    
    func connect() {
        // Convert HTTP URL to WebSocket URL
        var components = URLComponents(url: serverURL, resolvingAgainstBaseURL: false)!
        components.scheme = components.scheme == "https" ? "wss" : "ws"
        components.path = "/buffers"
        
        guard let wsURL = components.url else {
            self.error = URLError(.badURL)
            return
        }
        
        var request = URLRequest(url: wsURL)
        if let authHeader = authHeader {
            request.setValue(authHeader, forHTTPHeaderField: "Authorization")
        }
        
        webSocketTask = session.webSocketTask(with: request)
        webSocketTask?.resume()
        
        isConnected = true
        
        // Send subscribe message for this session
        let subscribeMessage = ["type": "subscribe", "sessionId": sessionId]
        if let data = try? JSONSerialization.data(withJSONObject: subscribeMessage),
           let text = String(data: data, encoding: .utf8) {
            send(text: text)
        }
        
        // Start receiving messages
        receiveMessage()
    }
    
    func disconnect() {
        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketTask = nil
        isConnected = false
    }
    
    func send(data: Data) {
        webSocketTask?.send(.data(data)) { [weak self] error in
            if let error = error {
                Task { @MainActor in
                    self?.handleError(error)
                }
            }
        }
    }
    
    func send(text: String) {
        webSocketTask?.send(.string(text)) { [weak self] error in
            if let error = error {
                Task { @MainActor in
                    self?.handleError(error)
                }
            }
        }
    }
    
    private func receiveMessage() {
        webSocketTask?.receive { [weak self] result in
            Task { @MainActor in
                guard let self = self else { return }
                
                switch result {
                case .success(let message):
                    switch message {
                    case .data(let data):
                        self.onMessage?(data)
                    case .string(let text):
                        self.onTextMessage?(text)
                    @unknown default:
                        break
                    }
                    
                    // Continue receiving messages
                    self.receiveMessage()
                    
                case .failure(let error):
                    self.handleError(error)
                }
            }
        }
    }
    
    private func handleError(_ error: Error) {
        self.error = error
        self.isConnected = false
        
        // Attempt to reconnect after a delay
        Task {
            try? await Task.sleep(nanoseconds: 2_000_000_000) // 2 seconds
            if !self.isConnected {
                self.connect()
            }
        }
    }
}

extension WebSocketManager: URLSessionWebSocketDelegate {
    nonisolated func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        Task { @MainActor in
            self.isConnected = true
        }
    }
    
    nonisolated func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        Task { @MainActor in
            self.isConnected = false
        }
    }
}