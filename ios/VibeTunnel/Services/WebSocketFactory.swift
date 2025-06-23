import Foundation

/// Protocol for creating WebSocket instances
@MainActor
protocol WebSocketFactory {
    func createWebSocket() -> WebSocketProtocol
}

/// Default factory that creates real WebSocket instances
@MainActor
class DefaultWebSocketFactory: WebSocketFactory {
    func createWebSocket() -> WebSocketProtocol {
        URLSessionWebSocket()
    }
}
