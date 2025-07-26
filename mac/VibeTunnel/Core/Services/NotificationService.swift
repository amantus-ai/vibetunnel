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

        // Check authorization status first
        await checkAndRequestNotificationPermissions()

        connect()
    }

    /// Stop monitoring server events
    func stop() {
        disconnect()
    }

    /// Request notification permissions and show test notification
    func requestPermissionAndShowTestNotification() async -> Bool {
        let center = UNUserNotificationCenter.current()

        // First check current authorization status
        let settings = await center.notificationSettings()

        switch settings.authorizationStatus {
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

    /// Send a session start notification
    func sendSessionStartNotification(sessionName: String) async {
        guard preferences.sessionStart else { return }

        let content = UNMutableNotificationContent()
        content.title = "Session Started"
        content.body = sessionName
        content.sound = getNotificationSound()
        content.categoryIdentifier = "SESSION"
        content.interruptionLevel = .passive

        deliverNotificationWithAutoDismiss(content, identifier: "session-start-\(UUID().uuidString)", dismissAfter: 5.0)
    }

    /// Send a session exit notification
    func sendSessionExitNotification(sessionName: String, exitCode: Int) async {
        guard preferences.sessionExit else { return }

        let content = UNMutableNotificationContent()
        content.title = "Session Ended"
        content.body = sessionName
        content.sound = getNotificationSound()
        content.categoryIdentifier = "SESSION"

        if exitCode != 0 {
            content.subtitle = "Exit code: \(exitCode)"
        }

        deliverNotification(content, identifier: "session-exit-\(UUID().uuidString)")
    }

    /// Send a command completion notification (also used for "Your Turn")
    func sendCommandCompletionNotification(command: String, duration: Int) async {
        guard preferences.commandCompletion else { return }

        let content = UNMutableNotificationContent()
        content.title = "Your Turn"
        content.body = command
        content.sound = getNotificationSound()
        content.categoryIdentifier = "COMMAND"
        content.interruptionLevel = .active

        if duration > 0 {
            let seconds = duration / 1_000
            if seconds > 60 {
                content.subtitle = "Duration: \(seconds / 60)m \(seconds % 60)s"
            } else {
                content.subtitle = "Duration: \(seconds)s"
            }
        }

        deliverNotification(content, identifier: "command-\(UUID().uuidString)")
    }

    /// Send a generic notification
    func sendGenericNotification(title: String, body: String) async {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = getNotificationSound()
        content.categoryIdentifier = "GENERAL"

        deliverNotification(content, identifier: "generic-\(UUID().uuidString)")
    }

    /// Open System Settings to the Notifications pane
    private func openNotificationSettings() {
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

    // MARK: - Private Methods

    private nonisolated func checkAndRequestNotificationPermissions() async {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        let authStatus = settings.authorizationStatus

        await MainActor.run {
            if authStatus == .notDetermined {
                logger.info("🔔 Notification permissions not determined, requesting authorization...")
            } else {
                logger.info("🔔 Notification authorization status: \(authStatus.rawValue)")
            }
        }

        if authStatus == .notDetermined {
            do {
                let granted = try await center.requestAuthorization(options: [.alert, .sound, .badge])
                await MainActor.run {
                    logger.info("🔔 Notification permission granted: \(granted)")
                }
            } catch {
                await MainActor.run {
                    logger.error("🔔 Failed to request notification permissions: \(error)")
                }
            }
        }
    }

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
                    let sessionName = session.name ?? session.command.joined(separator: " ")
                    self.logger.info("📨 Sending synthetic session-start event for existing session: \(sessionId)")

                    // Create synthetic event data
                    let eventData: [String: Any] = [
                        "type": "session-start",
                        "sessionId": sessionId,
                        "sessionName": sessionName
                    ]

                    // Handle as if it was a real event
                    self.handleSessionStart(eventData)
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
            guard let jsonData = data.data(using: .utf8),
                  let json = try JSONSerialization.jsonObject(with: jsonData) as? [String: Any],
                  let type = json["type"] as? String
            else {
                logger.error("🔴 Invalid event data format: \(data)")
                return
            }

            logger.info("📨 Received event: \(type)")

            switch type {
            case "session-start":
                logger.info("🚀 Processing session-start event")
                if preferences.sessionStart {
                    handleSessionStart(json)
                } else {
                    logger.debug("Session start notifications disabled")
                }
            case "session-exit":
                logger.info("🏁 Processing session-exit event")
                if preferences.sessionExit {
                    handleSessionExit(json)
                } else {
                    logger.debug("Session exit notifications disabled")
                }
            case "command-finished":
                logger.info("✅ Processing command-finished event")
                if preferences.commandCompletion {
                    handleCommandFinished(json)
                } else {
                    logger.debug("Command completion notifications disabled")
                }
            case "command-error":
                logger.info("❌ Processing command-error event")
                if preferences.commandError {
                    handleCommandError(json)
                } else {
                    logger.debug("Command error notifications disabled")
                }
            case "bell":
                logger.info("🔔 Processing bell event")
                if preferences.bell {
                    handleBell(json)
                } else {
                    logger.debug("Bell notifications disabled")
                }
            case "claude-turn":
                logger.info("💬 Processing claude-turn event")
                if preferences.claudeTurn {
                    handleClaudeTurn(json)
                } else {
                    logger.debug("Claude turn notifications disabled")
                }
            default:
                logger.debug("⚠️ Unhandled event type: \(type)")
            }
        } catch {
            logger.error("🔴 Failed to parse event: \(error)")
        }
    }

    private func handleSessionStart(_ data: [String: Any]) {
        guard let sessionName = data["sessionName"] as? String else { return }

        // Check for duplicate notifications
        if let sessionId = data["sessionId"] as? String {
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

        let content = UNMutableNotificationContent()
        content.title = "Session Started"
        content.body = sessionName
        content.sound = getNotificationSound()
        content.categoryIdentifier = "SESSION"
        content.interruptionLevel = .passive // Less intrusive for auto-dismiss

        let identifier: String
        if let sessionId = data["sessionId"] as? String {
            content.userInfo = ["sessionId": sessionId, "type": "session-start"]
            identifier = "session-start-\(sessionId)"
        } else {
            identifier = "session-start-\(UUID().uuidString)"
        }

        // Deliver notification with auto-dismiss
        deliverNotificationWithAutoDismiss(content, identifier: identifier, dismissAfter: 5.0)
    }

    private func handleSessionExit(_ data: [String: Any]) {
        guard let sessionName = data["sessionName"] as? String else { return }

        let content = UNMutableNotificationContent()
        content.title = "Session Ended"
        content.body = sessionName
        content.sound = getNotificationSound()
        content.categoryIdentifier = "SESSION"

        if let sessionId = data["sessionId"] as? String {
            content.userInfo = ["sessionId": sessionId, "type": "session-exit"]
        }

        if let exitCode = data["exitCode"] as? Int, exitCode != 0 {
            content.subtitle = "Exit code: \(exitCode)"
        }

        deliverNotification(content, identifier: "session-exit-\(UUID().uuidString)")
    }

    private func handleCommandFinished(_ data: [String: Any]) {
        guard let command = data["command"] as? String else { return }

        let content = UNMutableNotificationContent()
        content.title = "Command Completed"
        content.body = command
        content.sound = getNotificationSound()
        content.categoryIdentifier = "COMMAND"

        if let sessionId = data["sessionId"] as? String {
            content.userInfo = ["sessionId": sessionId, "type": "command-finished"]
        }

        if let duration = data["duration"] as? Int {
            let seconds = duration / 1_000
            if seconds > 60 {
                content.subtitle = "Duration: \(seconds / 60)m \(seconds % 60)s"
            } else {
                content.subtitle = "Duration: \(seconds)s"
            }
        }

        deliverNotification(content, identifier: "command-\(UUID().uuidString)")
    }

    private func handleCommandError(_ data: [String: Any]) {
        guard let command = data["command"] as? String else { return }

        let content = UNMutableNotificationContent()
        content.title = "Command Failed"
        content.body = command
        content.sound = getNotificationSound(critical: true)
        content.categoryIdentifier = "COMMAND"

        if let sessionId = data["sessionId"] as? String {
            content.userInfo = ["sessionId": sessionId, "type": "command-error"]
        }

        if let exitCode = data["exitCode"] as? Int {
            content.subtitle = "Exit code: \(exitCode)"
        }

        deliverNotification(content, identifier: "command-error-\(UUID().uuidString)")
    }

    private func handleBell(_ data: [String: Any]) {
        guard let sessionName = data["sessionName"] as? String else { return }

        let content = UNMutableNotificationContent()
        content.title = "Terminal Bell"
        content.body = sessionName
        content.sound = getNotificationSound()
        content.categoryIdentifier = "BELL"

        if let sessionId = data["sessionId"] as? String {
            content.userInfo = ["sessionId": sessionId, "type": "bell"]
        }

        if let processInfo = data["processInfo"] as? String {
            content.subtitle = processInfo
        }

        deliverNotification(content, identifier: "bell-\(UUID().uuidString)")
    }

    private func handleClaudeTurn(_ data: [String: Any]) {
        guard let sessionName = data["sessionName"] as? String else { return }

        let content = UNMutableNotificationContent()
        content.title = "Your Turn"
        content.body = "Claude has finished responding"
        content.subtitle = sessionName
        content.sound = getNotificationSound()
        content.categoryIdentifier = "CLAUDE_TURN"
        content.interruptionLevel = .active

        if let sessionId = data["sessionId"] as? String {
            content.userInfo = ["sessionId": sessionId, "type": "claude-turn"]
        }

        deliverNotification(content, identifier: "claude-turn-\(UUID().uuidString)")
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

/// Simple Server-Sent Events client
private final class EventSource: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    private let url: URL
    private var session: URLSession?
    private var task: URLSessionDataTask?
    private var headers: [String: String] = [:]

    var onOpen: (() -> Void)?
    var onMessage: ((Event) -> Void)?
    var onError: ((Error?) -> Void)?

    struct Event {
        let id: String?
        let event: String?
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
