import Foundation
import OSLog

/// Manages a shared Unix socket connection for screen capture communication
/// This ensures only one connection is made to the server, avoiding conflicts
@MainActor
final class SharedUnixSocketManager {
    private let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "SharedUnixSocket")

    // MARK: - Singleton

    static let shared = SharedUnixSocketManager()

    // MARK: - Properties

    private var unixSocket: UnixSocketConnection?
    private var messageHandlers: [UUID: (Data) -> Void] = [:]
    private let handlersLock = NSLock()

    // MARK: - Initialization

    private init() {
        logger.info("🚀 SharedUnixSocketManager initialized")
    }

    // MARK: - Public Methods

    /// Get or create the shared Unix socket connection
    func getConnection() -> UnixSocketConnection {
        if let existingSocket = unixSocket {
            logger.debug("♻️ Reusing existing Unix socket connection (connected: \(existingSocket.isConnected))")
            return existingSocket
        }

        logger.info("🔧 Creating new shared Unix socket connection")
        let socket = UnixSocketConnection()

        // Set up message handler that distributes to all registered handlers
        socket.onMessage = { [weak self] data in
            Task { @MainActor [weak self] in
                self?.distributeMessage(data)
            }
        }

        unixSocket = socket
        return socket
    }

    /// Check if the shared connection is connected
    var isConnected: Bool {
        unixSocket?.isConnected ?? false
    }

    /// Register a message handler
    /// - Returns: Handler ID for later removal
    @discardableResult
    func addMessageHandler(_ handler: @escaping (Data) -> Void) -> UUID {
        let handlerID = UUID()
        handlersLock.lock()
        messageHandlers[handlerID] = handler
        handlersLock.unlock()
        logger.debug("➕ Added message handler: \(handlerID)")
        return handlerID
    }

    /// Remove a message handler
    func removeMessageHandler(_ handlerID: UUID) {
        handlersLock.lock()
        messageHandlers.removeValue(forKey: handlerID)
        handlersLock.unlock()
        logger.debug("➖ Removed message handler: \(handlerID)")
    }

    /// Disconnect and clean up
    func disconnect() {
        logger.info("🔌 Disconnecting shared Unix socket")
        unixSocket?.disconnect()
        unixSocket = nil

        handlersLock.lock()
        messageHandlers.removeAll()
        handlersLock.unlock()
    }

    // MARK: - Private Methods

    /// Distribute received messages to all registered handlers
    private func distributeMessage(_ data: Data) {
        handlersLock.lock()
        let handlers = messageHandlers.values
        handlersLock.unlock()

        logger.debug("📨 Distributing message to \(handlers.count) handlers")

        for handler in handlers {
            handler(data)
        }
    }
}
