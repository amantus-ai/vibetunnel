import Foundation
import OSLog

/// Manages a shared Unix socket connection for control communication
/// This handles all control messages between the Mac app and the server
@MainActor
final class SharedUnixSocketManager {
    private let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "SharedUnixSocket")

    // MARK: - Singleton

    static let shared = SharedUnixSocketManager()

    // MARK: - Properties

    private var unixSocket: UnixSocketConnection?
    private var controlHandlers: [ControlProtocol.Category: (ControlProtocol.ControlMessage) async -> ControlProtocol
        .ControlMessage?
    ] = [:]
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

    /// Disconnect and clean up
    func disconnect() {
        logger.info("🔌 Disconnecting shared Unix socket")
        unixSocket?.disconnect()
        unixSocket = nil

        handlersLock.lock()
        controlHandlers.removeAll()
        handlersLock.unlock()
    }

    // MARK: - Private Methods

    /// Process received messages as control protocol messages
    private func distributeMessage(_ data: Data) {
        // Parse as control message
        if let controlMessage = try? ControlProtocol.decode(data) {
            logger.debug("📨 Control message: \(controlMessage.category.rawValue):\(controlMessage.action)")

            // Handle control messages
            Task { @MainActor in
                await handleControlMessage(controlMessage)
            }
        } else {
            logger.warning("📨 Received message that is not a valid control message")
            if let str = String(data: data, encoding: .utf8) {
                logger.debug("Raw message: \(str)")
            }
        }
    }

    /// Handle control protocol messages
    private func handleControlMessage(_ message: ControlProtocol.ControlMessage) async {
        guard let handler = controlHandlers[message.category] else {
            logger.warning("No handler for category: \(message.category.rawValue)")

            // Send error response if this was a request
            if message.type == .request {
                let response = ControlProtocol.createResponse(
                    to: message,
                    error: "No handler for category: \(message.category.rawValue)"
                )
                sendControlMessage(response)
            }
            return
        }

        // Process message with handler
        if let response = await handler(message) {
            sendControlMessage(response)
        }
    }

    /// Send a control message
    func sendControlMessage(_ message: ControlProtocol.ControlMessage) {
        guard let socket = unixSocket else {
            logger.warning("No socket available to send control message")
            return
        }

        Task {
            do {
                try await socket.send(message)
            } catch {
                logger.error("Failed to send control message: \(error)")
            }
        }
    }

    /// Register a control message handler for a specific category
    func registerControlHandler(
        for category: ControlProtocol.Category,
        handler: @escaping @Sendable (ControlProtocol.ControlMessage) async -> ControlProtocol.ControlMessage?
    ) {
        handlersLock.lock()
        controlHandlers[category] = handler
        handlersLock.unlock()
        logger.info("✅ Registered control handler for category: \(category.rawValue)")
    }

    /// Unregister a control handler
    func unregisterControlHandler(for category: ControlProtocol.Category) {
        handlersLock.lock()
        controlHandlers.removeValue(forKey: category)
        handlersLock.unlock()
        logger.info("❌ Unregistered control handler for category: \(category.rawValue)")
    }
}
