import AppKit
import Foundation
import os.log
@preconcurrency import UserNotifications

/// Manages native macOS notifications for VibeTunnel events.
///
/// Connects to the VibeTunnel server to receive real-time events like session starts,
/// command completions, and errors, then displays them as native macOS notifications.
@MainActor
final class NotificationService: NSObject {
    @MainActor
    static let shared = NotificationService()

    private let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "NotificationService")
    private var eventSource: EventSource?
    private let serverManager = ServerManager.shared
    private let configManager = ConfigManager.shared
    private var isConnected = false
    private var recentlyNotifiedSessions = Set<String>()
    private var notificationCleanupTimer: Timer?

    /// Notification types that can be enabled/disabled
    struct NotificationPreferences {
        var sessionStart: Bool
        var sessionExit: Bool
        var commandCompletion: Bool
        var commandError: Bool
        var bell: Bool
        var claudeTurn: Bool
        var soundEnabled: Bool
        var vibrationEnabled: Bool

        @MainActor
        init(fromConfig configManager: ConfigManager) {
            // Load from ConfigManager - ConfigManager provides the defaults
            self.sessionStart = configManager.notificationSessionStart
            self.sessionExit = configManager.notificationSessionExit
            self.commandCompletion = configManager.notificationCommandCompletion
            self.commandError = configManager.notificationCommandError
            self.bell = configManager.notificationBell
            self.claudeTurn = configManager.notificationClaudeTurn
            self.soundEnabled = configManager.notificationSoundEnabled
            self.vibrationEnabled = configManager.notificationVibrationEnabled
        }
    }

    private var preferences: NotificationPreferences

    @MainActor
    override private init() {
        // Load preferences from ConfigManager
        self.preferences = NotificationPreferences(fromConfig: configManager)

        super.init()
        setupNotifications()

        // Listen for config changes
        listenForConfigChanges()
    }

    /// Start monitoring server events
    func start() async {
        guard serverManager.isRunning else {
            logger.warning("🔴 Server not running, cannot start notification service")
            return
        }

        logger.info("🔔 Starting notification service...")

        connect()
    }

    /// Stop monitoring server events
    func stop() {
        disconnect()
    }

    /// Request notification permissions and show test notification
    func requestPermissionAndShowTestNotification() async -> Bool {
        let center = UNUserNotificationCenter.current()

        switch await authorizationStatus() {
        case .notDetermined:
            // First time - request permission
            do {
                let granted = try await center.requestAuthorization(options: [.alert, .sound, .badge])

                if granted {
                    logger.info("✅ Notification permissions granted")

                    // Show test notification
                    let content = UNMutableNotificationContent()
                    content.title = "VibeTunnel Notifications"
                    content.body = "Notifications are now enabled! You'll receive alerts for terminal events."
                    content.sound = getNotificationSound()

                    deliverNotification(content, identifier: "permission-granted-\(UUID().uuidString)")

                    return true
                } else {
                    logger.warning("❌ Notification permissions denied")
                    return false
                }
            } catch {
                logger.error("Failed to request notification permissions: \(error)")
                return false
            }

        case .denied:
            // Already denied - open System Settings
            logger.info("Opening System Settings to Notifications pane")
            openNotificationSettings()
            return false

        case .authorized, .provisional, .ephemeral:
            // Already authorized - show test notification
            logger.info("✅ Notifications already authorized")

            let content = UNMutableNotificationContent()
            content.title = "VibeTunnel Notifications"
            content.body = "Notifications are enabled! You'll receive alerts for terminal events."
            content.sound = getNotificationSound()

            deliverNotification(content, identifier: "permission-test-\(UUID().uuidString)")

            return true

        @unknown default:
            return false
        }
    }

    // MARK: - Public Notification Methods

    /// Send a notification for a server event
    /// - Parameter event: The server event to create a notification for
    func sendNotification(for event: ServerEvent) async {
        // Check preferences based on event type
        switch event.type {
        case .sessionStart:
            guard preferences.sessionStart else { return }
        case .sessionExit:
            guard preferences.sessionExit else { return }
        case .commandFinished:
            guard preferences.commandCompletion else { return }
        case .commandError:
            guard preferences.commandError else { return }
        case .bell:
            guard preferences.bell else { return }
        case .claudeTurn:
            guard preferences.claudeTurn else { return }
        case .connected:
            // Connected events don't trigger notifications
            return
        }

        let content = UNMutableNotificationContent()
        
        // Configure notification based on event type
        switch event.type {
        case .sessionStart:
            content.title = "Session Started"
            content.body = event.displayName
            content.categoryIdentifier = "SESSION"
            content.interruptionLevel = .passive
            
        case .sessionExit:
            content.title = "Session Ended"
            content.body = event.displayName
            content.categoryIdentifier = "SESSION"
            if let exitCode = event.exitCode, exitCode != 0 {
                content.subtitle = "Exit code: \(exitCode)"
            }
            
        case .commandFinished:
            content.title = "Your Turn"
            content.body = event.command ?? event.displayName
            content.categoryIdentifier = "COMMAND"
            content.interruptionLevel = .active
            if let duration = event.duration, duration > 0, let formattedDuration = event.formattedDuration {
                content.subtitle = formattedDuration
            }
            
        case .commandError:
            content.title = "Command Failed"
            content.body = event.command ?? event.displayName
            content.categoryIdentifier = "COMMAND"
            if let exitCode = event.exitCode {
                content.subtitle = "Exit code: \(exitCode)"
            }
            
        case .bell:
            content.title = "Terminal Bell"
            content.body = event.displayName
            content.categoryIdentifier = "BELL"
            if let message = event.message {
                content.subtitle = message
            }
            
        case .claudeTurn:
            content.title = event.type.description
            content.body = event.message ?? "Claude has finished responding"
            content.subtitle = event.displayName
            content.categoryIdentifier = "CLAUDE_TURN"
            content.interruptionLevel = .active
            
        case .connected:
            return // Already handled above
        }
        
        // Set sound based on event type
        content.sound = event.type == .commandError ? getNotificationSound(critical: true) : getNotificationSound()
        
        // Add session ID to user info if available
        if let sessionId = event.sessionId {
            content.userInfo = ["sessionId": sessionId, "type": event.type.rawValue]
        }
        
        // Generate identifier
        let identifier = "\(event.type.rawValue)-\(event.sessionId ?? UUID().uuidString)"
        
        // Deliver notification with appropriate method
        if event.type == .sessionStart {
            deliverNotificationWithAutoDismiss(content, identifier: identifier, dismissAfter: 5.0)
        } else {
            deliverNotification(content, identifier: identifier)
        }
    }

    /// Open System Settings to the Notifications pane
    func openNotificationSettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension") {
            NSWorkspace.shared.open(url)
        }
    }

    /// Update notification preferences
    func updatePreferences(_ prefs: NotificationPreferences) {
        self.preferences = prefs

        // Update ConfigManager
        configManager.updateNotificationPreferences(
            sessionStart: prefs.sessionStart,
            sessionExit: prefs.sessionExit,
            commandCompletion: prefs.commandCompletion,
            commandError: prefs.commandError,
            bell: prefs.bell,
            claudeTurn: prefs.claudeTurn,
            soundEnabled: prefs.soundEnabled,
            vibrationEnabled: prefs.vibrationEnabled
        )
    }

    /// Get notification sound based on user preferences
    private func getNotificationSound(critical: Bool = false) -> UNNotificationSound? {
        guard preferences.soundEnabled else { return nil }
        return critical ? .defaultCritical : .default
    }

    /// Listen for config changes
    private func listenForConfigChanges() {
        // ConfigManager is @Observable, so we can observe its properties
        // For now, we'll rely on the UI to call updatePreferences when settings change
        // In the future, we could add a proper observation mechanism
    }

    /// Check the local notifications authorization status
    func authorizationStatus() async -> UNAuthorizationStatus {
        await UNUserNotificationCenter.current()
            .notificationSettings()
            .authorizationStatus
    }

    /// Request notifications authorization
    @discardableResult
    func requestAuthorization() async throws -> Bool {
        do {
            let granted = try await UNUserNotificationCenter.current().requestAuthorization(options: [
                .alert,
                .sound,
                .badge
            ])

            logger.info("Notification permission granted: \(granted)")

            return granted
        } catch {
            logger.error("Failed to request notification permissions: \(error)")
            throw error
        }
    }

    // MARK: - Private Methods

    private func setupNotifications() {
        // Listen for server state changes
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(serverStateChanged),
            name: .serverStateChanged,
            object: nil
        )
    }

    @objc
    private func serverStateChanged(_ notification: Notification) {
        if serverManager.isRunning {
            logger.info("🔔 Server started, initializing notification service...")
            // Delay connection to ensure server is ready
            Task {
                try? await Task.sleep(nanoseconds: 2_000_000_000) // 2 seconds (increased delay)
                await MainActor.run {
                    if serverManager.isRunning {
                        logger.info("🔔 Server ready, connecting notification service...")
                        connect()
                    } else {
                        logger.warning("🔴 Server stopped before notification service could connect")
                    }
                }
            }
        } else {
            logger.info("🔔 Server stopped, disconnecting notification service...")
            disconnect()
        }
    }

    private func connect() {
        guard serverManager.isRunning, !isConnected else {
            logger.debug("🔔 Server not running or already connected to event stream")
            return
        }

        let port = serverManager.port
        guard let url = URL(string: "http://localhost:\(port)/api/events") else {
            logger.error("🔴 Invalid event stream URL for port \(port)")
            return
        }

        logger.info("🔔 Connecting to server event stream at \(url.absoluteString)")

        eventSource = EventSource(url: url)

        // Add authentication if available
        if let localToken = serverManager.bunServer?.localToken {
            eventSource?.addHeader("X-VibeTunnel-Local", value: localToken)
            logger.debug("🔐 Added local auth token to event stream")
        } else {
            logger.warning("⚠️ No local auth token available for event stream")
        }

        eventSource?.onOpen = { [weak self] in
            self?.logger.info("✅ Event stream connected successfully")
            self?.isConnected = true

            // Send synthetic events for existing sessions
            Task { @MainActor [weak self] in
                guard let self else { return }

                // Get current sessions from SessionMonitor
                let sessions = await SessionMonitor.shared.getSessions()

                for (sessionId, session) in sessions where session.isRunning {
                    let sessionName = session.name
                    self.logger.info("📨 Sending synthetic session-start event for existing session: \(sessionId)")

                    // Create synthetic ServerEvent
                    let syntheticEvent = ServerEvent.sessionStart(
                        sessionId: sessionId,
                        sessionName: sessionName,
                        command: session.command.joined(separator: " ")
                    )

                    // Handle as if it was a real event
                    self.handleSessionStart(syntheticEvent)
                }
            }
        }

        eventSource?.onError = { [weak self] error in
            self?.logger.error("🔴 Event stream error: \(error?.localizedDescription ?? "Unknown")")
            self?.isConnected = false

            // Schedule reconnection after delay
            Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: 5_000_000_000) // 5 seconds
                if let self, !self.isConnected && self.serverManager.isRunning {
                    self.logger.info("🔄 Attempting to reconnect event stream...")
                    self.connect()
                }
            }
        }

        eventSource?.onMessage = { [weak self] event in
            self?.handleServerEvent(event)
        }

        eventSource?.connect()
    }

    private func disconnect() {
        eventSource?.disconnect()
        eventSource = nil
        isConnected = false
        logger.info("Disconnected from event stream")
    }

    private func handleServerEvent(_ event: EventSource.Event) {
        guard let data = event.data else {
            logger.debug("🔔 Received event with no data")
            return
        }

        do {
            guard let jsonData = data.data(using: .utf8) else {
                logger.error("🔴 Failed to convert event data to UTF-8")
                return
            }
            
            // Decode the JSON into a dictionary
            guard let json = try JSONSerialization.jsonObject(with: jsonData) as? [String: Any],
                  let typeString = json["type"] as? String,
                  let eventType = ServerEventType(rawValue: typeString) else {
                logger.error("🔴 Invalid event type or format: \(data)")
                return
            }
            
            // Create ServerEvent from the JSON data
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            
            // Map the JSON to ServerEvent structure
            var serverEvent = ServerEvent(
                type: eventType,
                sessionId: json["sessionId"] as? String,
                sessionName: json["sessionName"] as? String,
                command: json["command"] as? String,
                exitCode: json["exitCode"] as? Int,
                duration: json["duration"] as? Int,
                message: json["message"] as? String,
                timestamp: Date()
            )
            
            // Parse timestamp if available
            if let timestampString = json["timestamp"] as? String,
               let timestampData = timestampString.data(using: .utf8),
               let timestamp = try? decoder.decode(Date.self, from: timestampData) {
                serverEvent = ServerEvent(
                    type: eventType,
                    sessionId: serverEvent.sessionId,
                    sessionName: serverEvent.sessionName,
                    command: serverEvent.command,
                    exitCode: serverEvent.exitCode,
                    duration: serverEvent.duration,
                    message: serverEvent.message,
                    timestamp: timestamp
                )
            }

            logger.info("📨 Received event: \(serverEvent.type.rawValue)")

            // Special handling for session start events
            if serverEvent.type == .sessionStart {
                handleSessionStart(serverEvent)
            } else if serverEvent.type == .connected {
                logger.debug("📡 Connected event received")
            } else {
                // Send notification for all other event types
                Task {
                    await sendNotification(for: serverEvent)
                }
            }
        } catch {
            logger.error("🔴 Failed to parse event: \(error)")
        }
    }

    private func handleSessionStart(_ event: ServerEvent) {
        // Check for duplicate notifications
        if let sessionId = event.sessionId {
            if recentlyNotifiedSessions.contains(sessionId) {
                logger.debug("Skipping duplicate notification for session \(sessionId)")
                return
            }
            recentlyNotifiedSessions.insert(sessionId)

            // Schedule cleanup after 10 seconds
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 10_000_000_000) // 10 seconds
                self.recentlyNotifiedSessions.remove(sessionId)
            }
        }

        // Use the consolidated notification method
        Task {
            await sendNotification(for: event)
        }
    }

    private func deliverNotification(_ content: UNMutableNotificationContent, identifier: String) {
        let request = UNNotificationRequest(identifier: identifier, content: content, trigger: nil)

        Task {
            do {
                try await UNUserNotificationCenter.current().add(request)
                logger.info("🔔 Delivered notification: '\(content.title)' - '\(content.body)'")
            } catch {
                logger.error("🔴 Failed to deliver notification '\(content.title)': \(error)")
            }
        }
    }

    private func deliverNotificationWithAutoDismiss(
        _ content: UNMutableNotificationContent,
        identifier: String,
        dismissAfter seconds: Double
    ) {
        let request = UNNotificationRequest(identifier: identifier, content: content, trigger: nil)

        Task {
            do {
                try await UNUserNotificationCenter.current().add(request)
                logger
                    .info(
                        "🔔 Delivered auto-dismiss notification: '\(content.title)' - '\(content.body)' (dismiss in \(seconds)s)"
                    )

                // Schedule automatic dismissal
                try await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))

                // Remove the notification
                UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [identifier])
                logger.debug("🔔 Auto-dismissed notification: \(identifier)")
            } catch {
                logger.error("🔴 Failed to deliver auto-dismiss notification '\(content.title)': \(error)")
            }
        }
    }
}

// MARK: - EventSource

/// A lightweight Server-Sent Events (SSE) client for receiving real-time notifications.
///
/// `EventSource` establishes a persistent HTTP connection to receive server-sent events
/// from the VibeTunnel server. It handles connection management, event parsing, and
/// automatic reconnection on failure.
///
/// - Note: This is a private implementation detail of `NotificationService`.
private final class EventSource: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    private let url: URL
    private var session: URLSession?
    private var task: URLSessionDataTask?
    private var headers: [String: String] = [:]

    var onOpen: (() -> Void)?
    var onMessage: ((Event) -> Void)?
    var onError: ((Error?) -> Void)?

    /// Represents a single Server-Sent Event.
    struct Event {
        /// Optional event identifier.
        let id: String?
        /// Optional event type.
        let event: String?
        /// The event data payload.
        let data: String?
    }

    init(url: URL) {
        self.url = url
        super.init()
    }

    func addHeader(_ name: String, value: String) {
        headers[name] = value
    }

    func connect() {
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = TimeInterval.infinity
        configuration.timeoutIntervalForResource = TimeInterval.infinity

        session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)

        var request = URLRequest(url: url)
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")

        // Add custom headers
        for (name, value) in headers {
            request.setValue(value, forHTTPHeaderField: name)
        }

        task = session?.dataTask(with: request)
        task?.resume()
    }

    func disconnect() {
        task?.cancel()
        session?.invalidateAndCancel()
        task = nil
        session = nil
    }

    // URLSessionDataDelegate

    nonisolated func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        if let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 {
            DispatchQueue.main.async {
                self.onOpen?()
            }
            completionHandler(.allow)
        } else {
            completionHandler(.cancel)
            DispatchQueue.main.async {
                self.onError?(nil)
            }
        }
    }

    private var buffer = ""

    nonisolated func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard let text = String(data: data, encoding: .utf8) else { return }
        buffer += text

        // Process complete events
        let lines = buffer.components(separatedBy: "\n")
        buffer = lines.last ?? ""

        var currentEvent = Event(id: nil, event: nil, data: nil)
        var dataLines: [String] = []

        for line in lines.dropLast() {
            if line.isEmpty {
                // End of event
                if !dataLines.isEmpty {
                    let data = dataLines.joined(separator: "\n")
                    let event = Event(id: currentEvent.id, event: currentEvent.event, data: data)
                    DispatchQueue.main.async {
                        self.onMessage?(event)
                    }
                }
                currentEvent = Event(id: nil, event: nil, data: nil)
                dataLines = []
            } else if line.hasPrefix("id:") {
                currentEvent = Event(
                    id: line.dropFirst(3).trimmingCharacters(in: .whitespaces),
                    event: currentEvent.event,
                    data: currentEvent.data
                )
            } else if line.hasPrefix("event:") {
                currentEvent = Event(
                    id: currentEvent.id,
                    event: line.dropFirst(6).trimmingCharacters(in: .whitespaces),
                    data: currentEvent.data
                )
            } else if line.hasPrefix("data:") {
                dataLines.append(String(line.dropFirst(5).trimmingCharacters(in: .whitespaces)))
            }
        }
    }

    nonisolated func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        DispatchQueue.main.async {
            self.onError?(error)
        }
    }
}

// MARK: - Notification Names

extension Notification.Name {
    static let serverStateChanged = Notification.Name("serverStateChanged")
}
