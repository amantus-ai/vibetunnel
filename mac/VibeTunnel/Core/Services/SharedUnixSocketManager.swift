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
    private var controlHandlers: [ControlProtocol.Category: (Data) async -> Data?] = [:]

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

    /// Connect the shared socket
    func connect() {
        // This will lazily create the connection if it doesn't exist
        // and start the connection process with automatic reconnection.
        let socket = getConnection()
        socket.connect()
        logger.info("🔌 Shared Unix socket connection process started.")
    }

    /// Disconnect and clean up
    func disconnect() {
        logger.info("🔌 Disconnecting shared unix socket.")
        unixSocket?.disconnect()
        unixSocket = nil

        // Note: We intentionally do NOT clear controlHandlers here.
        // Handlers should persist across reconnections so that registered
        // services (like WebRTCManager) don't need to re-register.
        // Handlers are only cleared when the app shuts down.
    }

    // MARK: - Private Methods

    /// Process received messages as control protocol messages
    private func distributeMessage(_ data: Data) {
        logger.debug("📨 Distributing message of size \(data.count) bytes")

        // Log raw message for debugging
        if let str = String(data: data, encoding: .utf8) {
            logger.debug("📨 Raw message: \(str)")
        }

        // Parse category and action to route to correct handler
        do {
            // Quick decode to get routing info
            if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
               let categoryStr = json["category"] as? String,
               let action = json["action"] as? String,
               let category = ControlProtocol.Category(rawValue: categoryStr) {
                
                logger.info("📨 Control message received: \(category.rawValue):\(action)")
                
                // Handle control messages
                Task { @MainActor in
                    await handleControlMessage(category: category, data: data)
                }
            } else {
                logger.error("📨 Invalid control message format")
            }
        } catch {
            logger.error("📨 Failed to parse control message: \(error)")
            if let str = String(data: data, encoding: .utf8) {
                logger.error("📨 Failed message content: \(str)")
            }
        }
    }

    /// Handle control protocol messages
    private func handleControlMessage(category: ControlProtocol.Category, data: Data) async {
        // Log handler lookup for debugging
        logger.info("🔍 Looking for handler for category: \(category.rawValue)")

        // Get handler - no locking needed since we're on MainActor
        let availableHandlers = controlHandlers.keys.map(\.rawValue).joined(separator: ", ")
        logger.info("🔍 Available handlers: \(availableHandlers)")

        guard let handler = controlHandlers[category] else {
            logger.warning("No handler for category: \(category.rawValue)")
            // Could send error response here if needed
            return
        }

        logger.info("✅ Found handler for category: \(category.rawValue), processing message...")

        // Process message with handler
        if let responseData = await handler(data) {
            // Send response back
            guard let socket = unixSocket else {
                logger.warning("No socket available to send response")
                return
            }
            
            do {
                try await socket.sendRawData(responseData)
            } catch {
                logger.error("Failed to send response: \(error)")
            }
        }
    }

    /// Register a control message handler for a specific category
    func registerControlHandler(
        for category: ControlProtocol.Category,
        handler: @escaping @Sendable (Data) async -> Data?
    ) {
        controlHandlers[category] = handler
        logger.info("✅ Registered control handler for category: \(category.rawValue)")
    }

    /// Unregister a control handler
    func unregisterControlHandler(for category: ControlProtocol.Category) {
        controlHandlers.removeValue(forKey: category)
        logger.info("❌ Unregistered control handler for category: \(category.rawValue)")
    }
}
