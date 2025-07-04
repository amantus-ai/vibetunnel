import Foundation
import Network
import OSLog

/// HTTP server that exposes screencap functionality via REST API
@preconcurrency @MainActor
public final class ScreencapHTTPServer {
    private let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "ScreencapHTTPServer")

    // MARK: - Properties

    private let port: UInt16
    private var listener: NWListener?
    private let screencapService: ScreencapService
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    // MARK: - Initialization

    init(port: UInt16 = 4_010) {
        self.port = port
        self.screencapService = ScreencapService()

        encoder.outputFormatting = [.prettyPrinted]
    }

    // MARK: - Public Methods

    func start() throws {
        let parameters = NWParameters.tcp
        parameters.allowLocalEndpointReuse = true

        listener = try NWListener(using: parameters, on: NWEndpoint.Port(integerLiteral: port))

        listener?.newConnectionHandler = { [weak self] connection in
            Task { @MainActor in
                self?.handleConnection(connection)
            }
        }

        listener?.start(queue: .main)
        logger.info("Screencap HTTP server started on port \(self.port)")
    }

    func stop() {
        listener?.cancel()
        listener = nil
        logger.info("Screencap HTTP server stopped")
    }

    // MARK: - Private Methods

    private func handleConnection(_ connection: NWConnection) {
        connection.start(queue: .main)

        // Read HTTP request
        connection
            .receive(minimumIncompleteLength: 1, maximumLength: 65_536) { [weak self] data, _, isComplete, error in
                guard let self else { return }

                if let error {
                    self.logger.error("Connection error: \(error)")
                    connection.cancel()
                    return
                }

                if let data, !data.isEmpty {
                    Task { @MainActor in
                        await self.handleRequest(data: data, connection: connection)
                    }
                }

                if isComplete {
                    connection.cancel()
                }
            }
    }

    private func handleRequest(data: Data, connection: NWConnection) async {
        guard let request = String(data: data, encoding: .utf8) else {
            await sendError(connection: connection, statusCode: 400, message: "Invalid request")
            return
        }

        // Parse HTTP request
        let lines = request.split(separator: "\r\n")
        guard let firstLine = lines.first else {
            await sendError(connection: connection, statusCode: 400, message: "Invalid request")
            return
        }

        let parts = firstLine.split(separator: " ")
        guard parts.count >= 2 else {
            await sendError(connection: connection, statusCode: 400, message: "Invalid request")
            return
        }

        let method = String(parts[0])
        let path = String(parts[1])

        // Extract body if present
        var body: Data?
        if let separator = "\r\n\r\n".data(using: .utf8),
           let doubleNewline = data.range(of: separator)
        {
            let bodyStart = doubleNewline.upperBound
            if bodyStart < data.count {
                body = data[bodyStart...]
            }
        }

        // Route request
        switch (method, path) {
        case ("GET", "/windows"):
            await handleGetWindows(connection: connection)

        case ("GET", "/display"):
            await handleGetDisplay(connection: connection)

        case ("GET", "/displays"):
            await handleGetDisplays(connection: connection)

        case ("GET", "/frame"):
            await handleGetFrame(connection: connection)

        case ("POST", "/capture"):
            await handleStartCapture(body: body, connection: connection)

        case ("POST", "/capture-window"):
            await handleCaptureWindow(body: body, connection: connection)

        case ("POST", "/stop"):
            await handleStopCapture(connection: connection)

        case ("POST", "/click"):
            await handleClick(body: body, connection: connection)

        case ("POST", "/click-window"):
            await handleClickWindow(body: body, connection: connection)

        case ("POST", "/key"):
            await handleKey(body: body, connection: connection)

        case ("POST", "/key-window"):
            await handleKeyWindow(body: body, connection: connection)

        case ("POST", "/mousedown"):
            await handleMouseDown(body: body, connection: connection)

        case ("POST", "/mousemove"):
            await handleMouseMove(body: body, connection: connection)

        case ("POST", "/mouseup"):
            await handleMouseUp(body: body, connection: connection)

        case ("GET", "/health"):
            await sendJSON(connection: connection, data: ["status": "ok"])

        default:
            await sendError(connection: connection, statusCode: 404, message: "Not found")
        }
    }

    // MARK: - Request Handlers

    private func handleGetWindows(connection: NWConnection) async {
        do {
            let windows = try await screencapService.getWindows()
            await sendJSON(connection: connection, data: windows)
        } catch {
            await sendError(connection: connection, statusCode: 500, message: error.localizedDescription)
        }
    }

    private func handleGetDisplay(connection: NWConnection) async {
        do {
            let display = try await screencapService.getDisplayInfo()
            await sendJSON(connection: connection, data: display)
        } catch {
            await sendError(connection: connection, statusCode: 500, message: error.localizedDescription)
        }
    }

    private func handleGetDisplays(connection: NWConnection) async {
        do {
            let displays = try await screencapService.getDisplays()
            await sendJSON(connection: connection, data: displays)
        } catch {
            await sendError(connection: connection, statusCode: 500, message: error.localizedDescription)
        }
    }

    private func handleGetFrame(connection: NWConnection) async {
        logger.debug("Frame request received")

        guard let frameData = screencapService.getCurrentFrame() else {
            logger.warning("No frame available for request")
            await sendError(connection: connection, statusCode: 404, message: "No frame available")
            return
        }

        logger.debug("Sending frame - size: \(frameData.count) bytes")

        // Send JPEG image
        let headers = """
        HTTP/1.1 200 OK\r
        Content-Type: image/jpeg\r
        Content-Length: \(frameData.count)\r
        Cache-Control: no-cache\r
        Connection: close\r
        Access-Control-Allow-Origin: *\r
        Access-Control-Allow-Methods: GET\r
        \r

        """

        guard var response = headers.data(using: .utf8) else {
            return
        }
        response.append(frameData)

        connection.send(content: response, completion: .contentProcessed { [weak self] error in
            if let error {
                self?.logger.error("Failed to send frame: \(error)")
            } else {
                self?.logger.debug("Frame sent successfully")
            }
            connection.cancel()
        })
    }

    private func handleStartCapture(body: Data?, connection: NWConnection) async {
        struct CaptureRequest: Codable {
            let type: String
            let index: Int
            let webrtc: Bool?
        }

        guard let body,
              let request = try? decoder.decode(CaptureRequest.self, from: body)
        else {
            await sendError(connection: connection, statusCode: 400, message: "Invalid request body")
            return
        }

        do {
            let useWebRTC = request.webrtc ?? false
            try await screencapService.startCapture(type: request.type, index: request.index, useWebRTC: useWebRTC)
            await sendJSON(
                connection: connection,
                data: ["status": "started", "type": request.type, "webrtc": String(useWebRTC)]
            )
        } catch {
            await sendError(connection: connection, statusCode: 500, message: error.localizedDescription)
        }
    }

    private func handleCaptureWindow(body: Data?, connection: NWConnection) async {
        struct WindowCaptureRequest: Codable {
            let cgWindowID: Int
            let webrtc: Bool?
        }

        guard let body,
              let request = try? decoder.decode(WindowCaptureRequest.self, from: body)
        else {
            await sendError(connection: connection, statusCode: 400, message: "Invalid request body")
            return
        }

        // Start capture by window ID directly
        do {
            let useWebRTC = request.webrtc ?? false
            try await screencapService.startCaptureWindow(cgWindowID: request.cgWindowID, useWebRTC: useWebRTC)
            await sendJSON(
                connection: connection,
                data: ["status": "started", "cgWindowID": String(request.cgWindowID), "webrtc": String(useWebRTC)]
            )
        } catch {
            await sendError(connection: connection, statusCode: 500, message: error.localizedDescription)
        }
    }

    private func handleStopCapture(connection: NWConnection) async {
        await screencapService.stopCapture()
        await sendJSON(connection: connection, data: ["status": "stopped"])
    }

    private func handleClick(body: Data?, connection: NWConnection) async {
        struct ClickRequest: Codable {
            let x: Double
            let y: Double
        }

        guard let body,
              let request = try? decoder.decode(ClickRequest.self, from: body)
        else {
            await sendError(connection: connection, statusCode: 400, message: "Invalid request body")
            return
        }

        do {
            try await screencapService.sendClick(x: request.x, y: request.y)
            await sendJSON(connection: connection, data: ["status": "clicked"])
        } catch {
            await sendError(connection: connection, statusCode: 500, message: error.localizedDescription)
        }
    }

    private func handleClickWindow(body: Data?, connection: NWConnection) async {
        struct ClickWindowRequest: Codable {
            let x: Double
            let y: Double
            let cgWindowID: Int
        }

        guard let body,
              let request = try? decoder.decode(ClickWindowRequest.self, from: body)
        else {
            await sendError(connection: connection, statusCode: 400, message: "Invalid request body")
            return
        }

        do {
            try await screencapService.sendClick(x: request.x, y: request.y, cgWindowID: request.cgWindowID)
            await sendJSON(connection: connection, data: ["status": "clicked"])
        } catch {
            await sendError(connection: connection, statusCode: 500, message: error.localizedDescription)
        }
    }

    private func handleKey(body: Data?, connection: NWConnection) async {
        struct KeyRequest: Codable {
            let key: String
            let metaKey: Bool?
            let ctrlKey: Bool?
            let altKey: Bool?
            let shiftKey: Bool?
        }

        guard let body,
              let request = try? decoder.decode(KeyRequest.self, from: body)
        else {
            await sendError(connection: connection, statusCode: 400, message: "Invalid request body")
            return
        }

        do {
            try await screencapService.sendKey(
                key: request.key,
                metaKey: request.metaKey ?? false,
                ctrlKey: request.ctrlKey ?? false,
                altKey: request.altKey ?? false,
                shiftKey: request.shiftKey ?? false
            )
            await sendJSON(connection: connection, data: ["status": "key sent"])
        } catch {
            await sendError(connection: connection, statusCode: 500, message: error.localizedDescription)
        }
    }

    private func handleKeyWindow(body: Data?, connection: NWConnection) async {
        // For now, just forward to regular key handler
        // In the future, could focus specific window first
        await handleKey(body: body, connection: connection)
    }

    private func handleMouseDown(body: Data?, connection: NWConnection) async {
        struct MouseRequest: Codable {
            let x: Double
            let y: Double
        }

        guard let body,
              let request = try? decoder.decode(MouseRequest.self, from: body)
        else {
            await sendError(connection: connection, statusCode: 400, message: "Invalid request body")
            return
        }

        do {
            try await screencapService.sendMouseDown(x: request.x, y: request.y)
            await sendJSON(connection: connection, data: ["status": "mousedown"])
        } catch {
            await sendError(connection: connection, statusCode: 500, message: error.localizedDescription)
        }
    }

    private func handleMouseMove(body: Data?, connection: NWConnection) async {
        struct MouseRequest: Codable {
            let x: Double
            let y: Double
        }

        guard let body,
              let request = try? decoder.decode(MouseRequest.self, from: body)
        else {
            await sendError(connection: connection, statusCode: 400, message: "Invalid request body")
            return
        }

        do {
            try await screencapService.sendMouseMove(x: request.x, y: request.y)
            await sendJSON(connection: connection, data: ["status": "mousemove"])
        } catch {
            await sendError(connection: connection, statusCode: 500, message: error.localizedDescription)
        }
    }

    private func handleMouseUp(body: Data?, connection: NWConnection) async {
        struct MouseRequest: Codable {
            let x: Double
            let y: Double
        }

        guard let body,
              let request = try? decoder.decode(MouseRequest.self, from: body)
        else {
            await sendError(connection: connection, statusCode: 400, message: "Invalid request body")
            return
        }

        do {
            try await screencapService.sendMouseUp(x: request.x, y: request.y)
            await sendJSON(connection: connection, data: ["status": "mouseup"])
        } catch {
            await sendError(connection: connection, statusCode: 500, message: error.localizedDescription)
        }
    }

    // MARK: - Response Helpers

    private func sendJSON(connection: NWConnection, data: some Encodable, statusCode: Int = 200) async {
        do {
            let jsonData = try encoder.encode(data)
            let headers = """
            HTTP/1.1 \(statusCode) OK\r
            Content-Type: application/json\r
            Content-Length: \(jsonData.count)\r
            Connection: close\r
            Access-Control-Allow-Origin: *\r
            Access-Control-Allow-Methods: GET, POST, OPTIONS\r
            Access-Control-Allow-Headers: Content-Type\r
            \r

            """

            guard var response = headers.data(using: .utf8) else {
                connection.cancel()
                return
            }
            response.append(jsonData)

            connection.send(content: response, completion: .contentProcessed { _ in
                connection.cancel()
            })
        } catch {
            logger.error("Failed to encode JSON: \(error)")
            connection.cancel()
        }
    }

    private func sendError(connection: NWConnection, statusCode: Int, message: String) async {
        await sendJSON(connection: connection, data: ["error": message], statusCode: statusCode)
    }
}
