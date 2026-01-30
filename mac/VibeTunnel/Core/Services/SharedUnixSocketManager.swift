import Foundation
import OSLog

/// Manages a shared Unix socket connection for control communication
/// This handles all control messages between the Mac app and the server
@MainActor
final class SharedUnixSocketManager {
    private let logger = Logger(subsystem: BundleIdentifiers.loggerSubsystem, category: "SharedUnixSocket")

    // MARK: - Singleton

    static let shared = SharedUnixSocketManager()

    // MARK: - Properties

    private var unixSocket: UnixSocketConnection?
    private var controlHandlers: [ControlProtocol.Category: (Data) async -> Data?] = [:]
    private var systemControlHandler: SystemControlHandler?

    // MARK: - Initialization

    private init() {
        self.logger.info("🚀 SharedUnixSocketManager initialized")
    }

    // MARK: - Notifications

    static let unixSocketReadyNotification = Notification.Name("unixSocketReady")

    // MARK: - Public Methods

    /// Get or create the shared Unix socket connection
    func getConnection() -> UnixSocketConnection {
        if let existingSocket = unixSocket {
            self.logger.debug("♻️ Reusing existing Unix socket connection (connected: \(existingSocket.isConnected))")
            return existingSocket
        }

        self.logger.info("🔧 Creating new shared Unix socket connection")
        let socket = UnixSocketConnection()

        // Set up message handler that distributes to all registered handlers
        socket.onMessage = { [weak self] data in
            Task { @MainActor [weak self] in
                self?.distributeMessage(data)
            }
        }

        // Set up state change handler to notify when socket is ready
        socket.onStateChange = { [weak self] state in
            Task { @MainActor [weak self] in
                self?.handleSocketStateChange(state)
            }
        }

        self.unixSocket = socket
        return socket
    }

    /// Handle socket state changes and notify when ready
    private func handleSocketStateChange(_ state: UnixSocketConnection.ConnectionState) {
        switch state {
        case .ready:
            self.logger.info("🚀 Unix socket is ready, posting notification")
            NotificationCenter.default.post(name: Self.unixSocketReadyNotification, object: nil)
        case let .failed(error):
            self.logger.error("❌ Unix socket connection failed: \(error)")
        case .cancelled:
            self.logger.info("🛑 Unix socket connection cancelled")
        case .preparing:
            self.logger.debug("🔄 Unix socket is preparing connection")
        case .setup:
            self.logger.debug("🔧 Unix socket is in setup state")
        case let .waiting(error):
            self.logger.warning("⏳ Unix socket is waiting: \(error)")
        }
    }

    /// Check if the shared connection is connected
    var isConnected: Bool {
        self.unixSocket?.isConnected ?? false
    }

    /// Connect the shared socket
    func connect() {
        // This will lazily create the connection if it doesn't exist
        // and start the connection process with automatic reconnection.
        let socket = self.getConnection()
        socket.connect()
        self.logger.info("🔌 Shared Unix socket connection process started.")
    }

    /// Disconnect and clean up
    func disconnect() {
        self.logger.info("🔌 Disconnecting shared unix socket.")
        self.unixSocket?.disconnect()
        self.unixSocket = nil

        // Note: We intentionally do NOT clear controlHandlers here.
        // Handlers should persist across reconnections so that registered
        // services (like WebRTCManager) don't need to re-register.
        // Handlers are only cleared when the app shuts down.
    }

    // MARK: - Private Methods

    /// Process received messages as control protocol messages
    private func distributeMessage(_ data: Data) {
        self.logger.debug("📨 Distributing message of size \(data.count) bytes")

        // Log raw message for debugging
        if let str = String(data: data, encoding: .utf8) {
            self.logger.debug("📨 Raw message: \(str)")
        }

        // Parse category and action to route to correct handler
        // Quick decode to get routing info
        if let json = JSONValue.decodeObject(from: data),
           let categoryStr = json["category"]?.string,
           let action = json["action"]?.string,
           let category = ControlProtocol.Category(rawValue: categoryStr)
        {
            self.logger.info("📨 Control message received: \(category.rawValue):\(action)")

            // Handle control messages
            Task { @MainActor in
                await self.handleControlMessage(category: category, data: data)
            }
        } else {
            self.logger.error("📨 Invalid control message format")
        }
    }

    /// Handle control protocol messages
    private func handleControlMessage(category: ControlProtocol.Category, data: Data) async {
        // Log handler lookup for debugging
        self.logger.info("🔍 Looking for handler for category: \(category.rawValue)")

        // Get handler - no locking needed since we're on MainActor
        let availableHandlers = self.controlHandlers.keys.map(\.rawValue).joined(separator: ", ")
        self.logger.info("🔍 Available handlers: \(availableHandlers)")

        // IMPORTANT: Error Response Handling
        // We explicitly send error responses for unhandled categories to prevent
        // clients from hanging indefinitely waiting for a reply.
        guard let handler = controlHandlers[category] else {
            self.logger.warning("No handler for category: \(category.rawValue)")

            // Send error response for unhandled categories
            if let errorResponse = createErrorResponse(
                for: data,
                category: category.rawValue,
                error: "No handler registered for category: \(category.rawValue)")
            {
                guard let socket = unixSocket else {
                    self.logger.warning("No socket available to send error response")
                    return
                }

                do {
                    try await socket.sendRawData(errorResponse)
                } catch {
                    self.logger.error("Failed to send error response: \(error)")
                }
            }
            return
        }

        self.logger.info("✅ Found handler for category: \(category.rawValue), processing message...")

        // Process message with handler
        if let responseData = await handler(data) {
            // Send response back
            guard let socket = unixSocket else {
                self.logger.warning("No socket available to send response")
                return
            }

            do {
                try await socket.sendRawData(responseData)
            } catch {
                self.logger.error("Failed to send response: \(error)")
            }
        }
    }

    /// Register a control message handler for a specific category
    func registerControlHandler(
        for category: ControlProtocol.Category,
        handler: @escaping @Sendable (Data) async -> Data?)
    {
        self.controlHandlers[category] = handler
        self.logger.info("✅ Registered control handler for category: \(category.rawValue)")
    }

    /// Unregister a control handler
    func unregisterControlHandler(for category: ControlProtocol.Category) {
        self.controlHandlers.removeValue(forKey: category)
        self.logger.info("❌ Unregistered control handler for category: \(category.rawValue)")
    }

    /// Create error response for unhandled messages
    private func createErrorResponse(for data: Data, category: String, error: String) -> Data? {
        do {
            // Try to get request ID and action for proper error response
            if let json = JSONValue.decodeObject(from: data),
               let id = json["id"]?.string,
               let action = json["action"]?.string,
               let type = json["type"]?.string,
               type == "request"
            { // Only send error responses for requests
                // Create error response matching request
                let errorResponse: [String: JSONValue] = [
                    "id": .string(id),
                    "type": .string("response"),
                    "category": .string(category),
                    "action": .string(action),
                    "error": .string(error),
                ]

                return try JSONEncoder().encode(errorResponse)
            }
        } catch {
            self.logger.error("Failed to create error response: \(error)")
        }

        return nil
    }

    /// Initialize system control handler
    func initializeSystemHandler(onSystemReady: @escaping () -> Void) {
        self.systemControlHandler = SystemControlHandler(onSystemReady: onSystemReady)

        // Register the system handler
        self.registerControlHandler(for: .system) { [weak self] data in
            await self?.systemControlHandler?.handleMessage(data)
        }

        self.logger.info("✅ System control handler initialized")
    }
}
