import Foundation
import Hummingbird
import OSLog

/// Hummingbird server implementation.
///
/// Provides a Swift-native HTTP server using the Hummingbird framework.
/// This implementation offers direct integration with the VibeTunnel UI,
/// built-in WebSocket support, and native Swift performance characteristics.
/// It serves as an alternative to the external Rust tty-fwd binary.
@MainActor
final class HummingbirdServer: ServerProtocol {
    private var tunnelServer: TunnelServer?
    private let logger = Logger(subsystem: "com.steipete.VibeTunnel", category: "HummingbirdServer")
    private var logContinuation: AsyncStream<ServerLogEntry>.Continuation?

    var serverType: ServerMode { .hummingbird }

    var isRunning: Bool {
        tunnelServer?.isRunning ?? false
    }

    var port: String = "4020" {
        didSet {
            // If server is running and port changed, we need to restart
            if isRunning && oldValue != port {
                Task {
                    try? await restart()
                }
            }
        }
    }

    let logStream: AsyncStream<ServerLogEntry>

    init() {
        var localContinuation: AsyncStream<ServerLogEntry>.Continuation?
        self.logStream = AsyncStream { continuation in
            localContinuation = continuation
        }
        self.logContinuation = localContinuation
    }

    func start() async throws {
        guard !isRunning else {
            logger.warning("Hummingbird server already running")
            return
        }

        logger.info("Starting Hummingbird server on port \(self.port)")
        logContinuation?.yield(ServerLogEntry(
            level: .info,
            message: "Initializing Hummingbird server...",
            source: .hummingbird
        ))

        do {
            let portInt = Int(port) ?? 4_020
            let bindAddress = ServerManager.shared.bindAddress
            let server = TunnelServer(port: portInt, bindAddress: bindAddress)
            tunnelServer = server

            try await server.start()

            logger.info("Hummingbird server started successfully")
            logContinuation?.yield(ServerLogEntry(
                level: .info,
                message: "Hummingbird server is ready",
                source: .hummingbird
            ))
        } catch {
            logger.error("Failed to start Hummingbird server: \(error.localizedDescription)")
            logContinuation?.yield(ServerLogEntry(
                level: .error,
                message: "Failed to start: \(error.localizedDescription)",
                source: .hummingbird
            ))
            throw error
        }
    }

    func stop() async {
        guard let server = tunnelServer, isRunning else {
            logger.warning("Hummingbird server not running")
            return
        }

        logger.info("Stopping Hummingbird server")
        logContinuation?.yield(ServerLogEntry(
            level: .info,
            message: "Shutting down Hummingbird server...",
            source: .hummingbird
        ))

        do {
            try await server.stop()
            tunnelServer = nil

            logger.info("Hummingbird server stopped")
            logContinuation?.yield(ServerLogEntry(
                level: .info,
                message: "Hummingbird server shutdown complete",
                source: .hummingbird
            ))
        } catch {
            logger.error("Error stopping Hummingbird server: \(error.localizedDescription)")
            logContinuation?.yield(ServerLogEntry(
                level: .error,
                message: "Error stopping: \(error.localizedDescription)",
                source: .hummingbird
            ))
        }
    }

    /// Clears the authentication cache
    func clearAuthCache() async {
        await tunnelServer?.clearAuthCache()
    }

    func restart() async throws {
        logger.info("Restarting Hummingbird server")
        logContinuation?.yield(ServerLogEntry(level: .info, message: "Restarting server", source: .hummingbird))

        await stop()
        try await start()
    }
}
