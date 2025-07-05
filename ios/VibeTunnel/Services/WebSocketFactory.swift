import Foundation

/// Protocol for creating WebSocket instances.
/// Enables dependency injection and testing of WebSocket functionality.
@MainActor
protocol WebSocketFactory {
    func createWebSocket() -> WebSocketProtocol
}

/// Default factory that creates real WebSocket instances.
/// Creates URLSessionWebSocket instances for production use.
@MainActor
class DefaultWebSocketFactory: WebSocketFactory {
    func createWebSocket() -> WebSocketProtocol {
        URLSessionWebSocket()
    }
}
