import Foundation
import Network
import OSLog

/// Manages UNIX socket connection for screen capture communication
@MainActor
final class UnixSocketConnection {
    private let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "UnixSocket")
    
    // MARK: - Properties
    
    private var connection: NWConnection?
    private let socketPath: String
    private let queue = DispatchQueue(label: "sh.vibetunnel.unix-socket", qos: .userInitiated)
    
    /// Buffer for accumulating partial messages
    private var receiveBuffer = Data()
    
    /// Task for continuous message receiving
    private var receiveTask: Task<Void, Never>?
    
    /// Message handler callback
    var onMessage: ((Data) -> Void)?
    
    /// Connection state change callback
    var onStateChange: ((NWConnection.State) -> Void)?
    
    // MARK: - Initialization
    
    init(socketPath: String? = nil) {
        // Use socket path in user's home directory to avoid /tmp issues
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        self.socketPath = socketPath ?? "\(home)/.vibetunnel/screencap.sock"
        logger.info("Unix socket initialized with path: \(self.socketPath)")
    }
    
    // MARK: - Public Methods
    
    /// Connect to the UNIX socket
    func connect() {
        logger.info("🔌 Connecting to UNIX socket at \(self.socketPath)")
        
        // Ensure socket directory exists with proper permissions
        ensureSocketSecurity()
        
        let endpoint = NWEndpoint.unix(path: socketPath)
        let parameters = NWParameters()
        
        // Configure connection parameters
        parameters.defaultProtocolStack.transportProtocol = NWProtocolTCP.Options()
        
        connection = NWConnection(to: endpoint, using: parameters)
        
        connection?.stateUpdateHandler = { [weak self] state in
            Task { @MainActor [weak self] in
                self?.handleStateChange(state)
            }
        }
        
        // Start the connection
        connection?.start(queue: queue)
    }
    
    /// Send a message
    func send<T: Encodable>(_ message: T) async throws {
        guard let connection, connection.state == .ready else {
            throw UnixSocketError.notConnected
        }
        
        let encoder = JSONEncoder()
        let data = try encoder.encode(message)
        
        // Add newline delimiter
        var messageData = data
        messageData.append("\n".data(using: .utf8)!)
        
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            connection.send(content: messageData, completion: .contentProcessed { error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume()
                }
            })
        }
    }
    
    /// Send raw dictionary message (for compatibility)
    func sendMessage(_ dict: [String: Any]) async {
        do {
            let data = try JSONSerialization.data(withJSONObject: dict, options: [])
            var messageData = data
            messageData.append("\n".data(using: .utf8)!)
            
            guard let connection, connection.state == .ready else {
                logger.error("Cannot send message - not connected")
                return
            }
            
            connection.send(content: messageData, completion: .contentProcessed { [weak self] error in
                if let error {
                    self?.logger.error("Failed to send message: \(error)")
                }
            })
        } catch {
            logger.error("Failed to serialize message: \(error)")
        }
    }
    
    /// Disconnect from the socket
    func disconnect() {
        logger.info("🔌 Disconnecting from UNIX socket")
        
        // Cancel receive task
        receiveTask?.cancel()
        receiveTask = nil
        
        // Clear buffer
        receiveBuffer.removeAll()
        
        // Cancel connection
        connection?.cancel()
        connection = nil
    }
    
    // MARK: - Private Methods
    
    private func handleStateChange(_ state: NWConnection.State) {
        logger.info("Connection state changed: \(String(describing: state))")
        
        switch state {
        case .ready:
            logger.info("✅ UNIX socket connected")
            // Start continuous receive loop when connected
            startReceiveLoop()
        case .failed(let error):
            logger.error("❌ Connection failed: \(error)")
            // Clean up on failure
            receiveTask?.cancel()
            receiveTask = nil
        case .cancelled:
            logger.info("Connection cancelled")
            // Clean up on cancellation
            receiveTask?.cancel()
            receiveTask = nil
        default:
            break
        }
        
        onStateChange?(state)
    }
    
    /// Start continuous receive loop
    private func startReceiveLoop() {
        receiveTask?.cancel()
        receiveTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.receiveNextMessage()
            }
        }
    }
    
    /// Receive next message from the connection
    private func receiveNextMessage() async {
        guard let connection else { return }
        
        do {
            let data = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Data?, Error>) in
                connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { data, _, _, error in
                    if let error {
                        continuation.resume(throwing: error)
                    } else {
                        continuation.resume(returning: data)
                    }
                }
            }
            
            if let data, !data.isEmpty {
                processReceivedData(data)
            }
        } catch {
            if !Task.isCancelled {
                logger.error("Receive error: \(error)")
            }
        }
    }
    
    /// Process received data with proper message framing
    private func processReceivedData(_ data: Data) {
        // Append new data to buffer
        receiveBuffer.append(data)
        
        // Log buffer state for debugging
        logger.debug("📥 Buffer after append: \(self.receiveBuffer.count) bytes")
        if let str = String(data: receiveBuffer.prefix(200), encoding: .utf8) {
            logger.debug("📋 Buffer content preview: \(str)")
        }
        
        // Process complete messages (delimited by newlines)
        while let newlineIndex = receiveBuffer.firstIndex(of: 0x0A) { // 0x0A is newline
            // Calculate the offset from the start of the buffer
            let newlineOffset = receiveBuffer.distance(from: receiveBuffer.startIndex, to: newlineIndex)
            
            // Extract message up to the newline (not including it)
            let messageData = receiveBuffer.prefix(newlineOffset)
            
            // Calculate how much to remove (message + newline)
            let bytesToRemove = newlineOffset + 1
            
            logger.debug("🔍 Found newline at offset \(newlineOffset), message size: \(messageData.count), removing: \(bytesToRemove) bytes")
            
            // Remove processed data from buffer (including newline)
            receiveBuffer.removeFirst(bytesToRemove)
            logger.debug("✅ Removed \(bytesToRemove) bytes, buffer now: \(self.receiveBuffer.count) bytes")
            
            // Skip empty messages
            if messageData.isEmpty {
                logger.debug("⏭️ Skipping empty message")
                continue
            }
            
            // Log the message being delivered
            if let msgStr = String(data: messageData, encoding: .utf8) {
                logger.debug("📤 Delivering message: \(msgStr)")
            }
            
            // Deliver the complete message
            onMessage?(messageData)
        }
        
        // If buffer grows too large, clear it to prevent memory issues
        if receiveBuffer.count > 1024 * 1024 { // 1MB limit
            logger.warning("Receive buffer exceeded 1MB, clearing to prevent memory issues")
            receiveBuffer.removeAll()
        }
    }
    
    /// Ensure socket directory exists with proper permissions
    private func ensureSocketSecurity() {
        let socketURL = URL(fileURLWithPath: socketPath)
        let socketDir = socketURL.deletingLastPathComponent().path
        
        // Create socket directory if needed
        let fileManager = FileManager.default
        if !fileManager.fileExists(atPath: socketDir) {
            do {
                try fileManager.createDirectory(atPath: socketDir, withIntermediateDirectories: true, attributes: nil)
            } catch {
                logger.error("Failed to create socket directory: \(error)")
            }
        }
        
        // IMPORTANT: Do NOT remove the socket file here!
        // The server creates and manages the socket file.
        // Removing it here causes a race condition where we delete
        // the server's socket and then fail to connect.
        
        // Set restrictive permissions after socket is created
        // This will be done by the server when it creates the socket
    }
}

// MARK: - Errors

enum UnixSocketError: LocalizedError {
    case notConnected
    case connectionFailed(Error)
    case sendFailed(Error)
    
    var errorDescription: String? {
        switch self {
        case .notConnected:
            return "UNIX socket not connected"
        case .connectionFailed(let error):
            return "Connection failed: \(error.localizedDescription)"
        case .sendFailed(let error):
            return "Send failed: \(error.localizedDescription)"
        }
    }
}