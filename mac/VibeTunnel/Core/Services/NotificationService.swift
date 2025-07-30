import AppKit
import Foundation
import Observation
import os.log
@preconcurrency import UserNotifications

/// Manages native macOS notifications for VibeTunnel events.
///
/// Connects to the VibeTunnel server to receive real-time events like session starts,
/// command completions, and errors, then displays them as native macOS notifications.
@MainActor
@Observable
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

    /// Public property to check SSE connection status
    var isSSEConnected: Bool { isConnected }

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
        logger.info("🚀 NotificationService.start() called")

        // Check if notifications are enabled in config
        guard configManager.notificationsEnabled else {
            logger.info("📴 Notifications are disabled in config, skipping SSE connection")
            return
        }

        guard serverManager.isRunning else {
            logger.warning("🔴 Server not running, cannot start notification service")
            return
        }

        logger.info("🔔 Starting notification service - server is running on port \(self.serverManager.port)")

        // Wait for Unix socket to be ready before connecting SSE
        // This ensures the server is fully ready to accept connections
        await MainActor.run {
            waitForUnixSocketAndConnect()
        }
    }

    /// Wait for Unix socket ready notification then connect
    private func waitForUnixSocketAndConnect() {
        logger.info("⏳ Waiting for Unix socket ready notification...")

        // Check if Unix socket is already connected
        if SharedUnixSocketManager.shared.isConnected {
            logger.info("✅ Unix socket already connected, connecting to SSE immediately")
            connect()
            return
        }

        // Listen for Unix socket ready notification
        NotificationCenter.default.addObserver(
            forName: SharedUnixSocketManager.unixSocketReadyNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.logger.info("✅ Unix socket ready notification received, connecting to SSE")
                self?.connect()

                // Remove observer after first notification to prevent duplicate connections
                NotificationCenter.default.removeObserver(
                    self as Any,
                    name: SharedUnixSocketManager.unixSocketReadyNotification,
                    object: nil
                )
            }
        }
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
                    logger.warning("⚠️ Notification permissions denied by user")
                    return false
                }
            } catch {
                logger.error("❌ Failed to request notification permissions: \(error)")
                return false
            }

        case .denied:
            logger.warning("⚠️ Notification permissions previously denied")
            return false

        case .authorized, .provisional:
            logger.info("✅ Notification permissions already granted")

            // Show test notification
            let content = UNMutableNotificationContent()
            content.title = "VibeTunnel Notifications"
            content.body = "Notifications are already enabled! You'll receive alerts for terminal events."
            content.sound = getNotificationSound()

            deliverNotification(content, identifier: "permission-test-\(UUID().uuidString)")

            return true

        case .ephemeral:
            logger.info("ℹ️ Ephemeral notification permissions")
            return true

        @unknown default:
            logger.warning("⚠️ Unknown notification authorization status")
            return false
        }
    }

    // MARK: - Public Notification Methods

    /// Send a notification for a server event
    /// - Parameter event: The server event to create a notification for
    func sendNotification(for event: ServerEvent) async {
        // Check master switch first
        guard configManager.notificationsEnabled else { return }

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

    /// Send a session start notification (legacy method for compatibility)
    func sendSessionStartNotification(sessionName: String) async {
        guard configManager.notificationsEnabled && preferences.sessionStart else { return }

        let content = UNMutableNotificationContent()
        content.title = "Session Started"
        content.body = sessionName
        content.sound = getNotificationSound()
        content.categoryIdentifier = "SESSION"
        content.interruptionLevel = .passive

        deliverNotificationWithAutoDismiss(content, identifier: "session-start-\(UUID().uuidString)", dismissAfter: 5.0)
    }

    /// Send a session exit notification (legacy method for compatibility)
    func sendSessionExitNotification(sessionName: String, exitCode: Int) async {
        guard configManager.notificationsEnabled && preferences.sessionExit else { return }

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

    /// Send a command completion notification (legacy method for compatibility)
    func sendCommandCompletionNotification(command: String, duration: Int) async {
        guard configManager.notificationsEnabled && preferences.commandCompletion else { return }

        let content = UNMutableNotificationContent()
        content.title = "Your Turn"
        content.body = command
        content.sound = getNotificationSound()
        content.categoryIdentifier = "COMMAND"
        content.interruptionLevel = .active

        // Format duration if provided
        if duration > 0 {
            let seconds = duration / 1_000
            if seconds < 60 {
                content.subtitle = "\(seconds)s"
            } else {
                let minutes = seconds / 60
                let remainingSeconds = seconds % 60
                content.subtitle = "\(minutes)m \(remainingSeconds)s"
            }
        }

        deliverNotification(content, identifier: "command-\(UUID().uuidString)")
    }

    /// Send a generic notification
    func sendGenericNotification(title: String, body: String) async {
        guard configManager.notificationsEnabled else { return }

        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = getNotificationSound()
        content.categoryIdentifier = "GENERAL"

        deliverNotification(content, identifier: "generic-\(UUID().uuidString)")
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
        // Note: We do NOT listen for server state changes here
        // Connection is managed explicitly via start() and stop() methods
        // This prevents dual-path connection attempts
    }

    private func connect() {
        logger.info("🔌 NotificationService.connect() called - isConnected: \(self.isConnected)")
        guard !isConnected else {
            logger.info("Already connected to notification service")
            return
        }

        // When auth mode is "none", we can connect without a token.
        // In any other auth mode, a token is required for the local Mac app to connect.
        if serverManager.authMode != "none", serverManager.localAuthToken == nil {
            logger
                .error("No auth token available for notification service in auth mode '\(self.serverManager.authMode)'")
            return
        }

        let eventsURL = "http://localhost:\(self.serverManager.port)/api/events"
        logger.info("📡 Attempting to connect to SSE endpoint: \(eventsURL)")

        guard let url = URL(string: eventsURL) else {
            logger.error("Invalid events URL: \(eventsURL)")
            return
        }

        // Create headers
        var headers: [String: String] = [
            "Accept": "text/event-stream",
            "Cache-Control": "no-cache"
        ]

        // Add authorization header if auth token is available.
        // When auth mode is "none", there's no token, and that's okay.
        if let authToken = serverManager.localAuthToken {
            headers["Authorization"] = "Bearer \(authToken)"
            logger.info("🔑 Using auth token for SSE connection")
        } else {
            logger.info("🔓 Connecting to SSE without an auth token (auth mode: '\(self.serverManager.authMode)')")
        }

        // Add custom header to indicate this is the Mac app
        headers["X-VibeTunnel-Client"] = "mac-app"

        eventSource = EventSource(url: url, headers: headers)

        eventSource?.onOpen = { [weak self] in
            Task { @MainActor in
                self?.logger.info("✅ Connected to notification event stream")
                self?.isConnected = true
                // Post notification for UI update
                NotificationCenter.default.post(name: .notificationServiceConnectionChanged, object: nil)
            }
        }

        eventSource?.onError = { [weak self] error in
            Task { @MainActor in
                if let error {
                    self?.logger.error("❌ EventSource error: \(error)")
                }
                self?.isConnected = false
                // Post notification for UI update
                NotificationCenter.default.post(name: .notificationServiceConnectionChanged, object: nil)
                // Don't reconnect here - let server state changes trigger reconnection
            }
        }

        eventSource?.onMessage = { [weak self] event in
            Task { @MainActor in
                self?.logger
                    .info(
                        "🎯 EventSource onMessage fired! Event type: \(event.event ?? "default"), Has data: \(event.data != nil)"
                    )
                self?.handleEvent(event)
            }
        }

        eventSource?.connect()
    }

    private func disconnect() {
        eventSource?.disconnect()
        eventSource = nil
        isConnected = false
        logger.info("Disconnected from notification service")
        // Post notification for UI update
        NotificationCenter.default.post(name: .notificationServiceConnectionChanged, object: nil)
    }

    private func handleEvent(_ event: Event) {
        guard let data = event.data else {
            logger.warning("Received event with no data")
            return
        }

        // Log event details for debugging
        logger.debug("📨 Received SSE event - Type: \(event.event ?? "message"), ID: \(event.id ?? "none")")
        logger.debug("📨 Event data: \(data)")

        do {
            guard let jsonData = data.data(using: .utf8) else {
                logger.error("Failed to convert event data to UTF-8")
                return
            }

            let json = try JSONSerialization.jsonObject(with: jsonData) as? [String: Any] ?? [:]

            guard let type = json["type"] as? String else {
                logger.error("Event missing type field")
                return
            }

            // Process based on event type and user preferences
            switch type {
            case "session-start":
                logger.info("🚀 Processing session-start event")
                if configManager.notificationsEnabled && preferences.sessionStart {
                    handleSessionStart(json)
                } else {
                    logger.debug("Session start notifications disabled")
                }
            case "session-exit":
                logger.info("🏁 Processing session-exit event")
                if configManager.notificationsEnabled && preferences.sessionExit {
                    handleSessionExit(json)
                } else {
                    logger.debug("Session exit notifications disabled")
                }
            case "command-finished":
                logger.info("✅ Processing command-finished event")
                if configManager.notificationsEnabled && preferences.commandCompletion {
                    handleCommandFinished(json)
                } else {
                    logger.debug("Command completion notifications disabled")
                }
            case "command-error":
                logger.info("❌ Processing command-error event")
                if configManager.notificationsEnabled && preferences.commandError {
                    handleCommandError(json)
                } else {
                    logger.debug("Command error notifications disabled")
                }
            case "bell":
                logger.info("🔔 Processing bell event")
                if configManager.notificationsEnabled && preferences.bell {
                    handleBell(json)
                } else {
                    logger.debug("Bell notifications disabled")
                }
            case "claude-turn":
                logger.info("💬 Processing claude-turn event")
                if configManager.notificationsEnabled && preferences.claudeTurn {
                    handleClaudeTurn(json)
                } else {
                    logger.debug("Claude turn notifications disabled")
                }
            case "connected":
                logger.info("🔗 Received connected event from server")
            case "test-notification":
                logger.info("🧪 Processing test-notification event")
                handleTestNotification(json)
            // No notification for connected events
            default:
                logger.warning("Unknown event type: \(type)")
            }
        } catch {
            logger.error("Failed to parse event data: \(error)")
        }
    }

    // MARK: - Event Handlers

    private func handleSessionStart(_ json: [String: Any]) {
        guard let sessionId = json["sessionId"] as? String else {
            logger.error("Session start event missing sessionId")
            return
        }

        let sessionName = json["sessionName"] as? String ?? "Terminal Session"

        // Prevent duplicate notifications
        if recentlyNotifiedSessions.contains("start-\(sessionId)") {
            logger.debug("Skipping duplicate session start notification for \(sessionId)")
            return
        }

        recentlyNotifiedSessions.insert("start-\(sessionId)")

        let content = UNMutableNotificationContent()
        content.title = "Session Started"
        content.body = sessionName
        content.sound = getNotificationSound()
        content.categoryIdentifier = "SESSION"
        content.userInfo = ["sessionId": sessionId, "type": "session-start"]
        content.interruptionLevel = .passive

        deliverNotificationWithAutoDismiss(content, identifier: "session-start-\(sessionId)", dismissAfter: 5.0)

        // Schedule cleanup
        scheduleNotificationCleanup(for: "start-\(sessionId)", after: 30)
    }

    private func handleSessionExit(_ json: [String: Any]) {
        guard let sessionId = json["sessionId"] as? String else {
            logger.error("Session exit event missing sessionId")
            return
        }

        let sessionName = json["sessionName"] as? String ?? "Terminal Session"
        let exitCode = json["exitCode"] as? Int ?? 0

        // Prevent duplicate notifications
        if recentlyNotifiedSessions.contains("exit-\(sessionId)") {
            logger.debug("Skipping duplicate session exit notification for \(sessionId)")
            return
        }

        recentlyNotifiedSessions.insert("exit-\(sessionId)")

        let content = UNMutableNotificationContent()
        content.title = "Session Ended"
        content.body = sessionName
        content.sound = getNotificationSound()
        content.categoryIdentifier = "SESSION"
        content.userInfo = ["sessionId": sessionId, "type": "session-exit", "exitCode": exitCode]

        if exitCode != 0 {
            content.subtitle = "Exit code: \(exitCode)"
        }

        deliverNotification(content, identifier: "session-exit-\(sessionId)")

        // Schedule cleanup
        scheduleNotificationCleanup(for: "exit-\(sessionId)", after: 30)
    }

    private func handleCommandFinished(_ json: [String: Any]) {
        let command = json["command"] as? String ?? "Command"
        let duration = json["duration"] as? Int ?? 0

        let content = UNMutableNotificationContent()
        content.title = "Your Turn"
        content.body = command
        content.sound = getNotificationSound()
        content.categoryIdentifier = "COMMAND"
        content.interruptionLevel = .active

        // Format duration if provided
        if duration > 0 {
            let seconds = duration / 1_000
            if seconds < 60 {
                content.subtitle = "\(seconds)s"
            } else {
                let minutes = seconds / 60
                let remainingSeconds = seconds % 60
                content.subtitle = "\(minutes)m \(remainingSeconds)s"
            }
        }

        if let sessionId = json["sessionId"] as? String {
            content.userInfo = ["sessionId": sessionId, "type": "command-finished"]
        }

        deliverNotification(content, identifier: "command-\(UUID().uuidString)")
    }

    private func handleCommandError(_ json: [String: Any]) {
        let command = json["command"] as? String ?? "Command"
        let exitCode = json["exitCode"] as? Int ?? 1

        let content = UNMutableNotificationContent()
        content.title = "Command Failed"
        content.body = command
        content.sound = getNotificationSound(critical: true)
        content.categoryIdentifier = "COMMAND"
        content.subtitle = "Exit code: \(exitCode)"

        if let sessionId = json["sessionId"] as? String {
            content.userInfo = ["sessionId": sessionId, "type": "command-error", "exitCode": exitCode]
        }

        deliverNotification(content, identifier: "error-\(UUID().uuidString)")
    }

    private func handleBell(_ json: [String: Any]) {
        guard let sessionId = json["sessionId"] as? String else {
            logger.error("Bell event missing sessionId")
            return
        }

        let sessionName = json["sessionName"] as? String ?? "Terminal"

        let content = UNMutableNotificationContent()
        content.title = "Terminal Bell"
        content.body = sessionName
        content.sound = getNotificationSound()
        content.categoryIdentifier = "BELL"
        content.userInfo = ["sessionId": sessionId, "type": "bell"]

        if let message = json["message"] as? String {
            content.subtitle = message
        }

        deliverNotification(content, identifier: "bell-\(sessionId)-\(Date().timeIntervalSince1970)")
    }

    private func handleTestNotification(_ json: [String: Any]) {
        logger.info("🧪 Handling test notification from server")

        let title = json["title"] as? String ?? "VibeTunnel Test"
        let body = json["body"] as? String ?? "Server-side notifications are working correctly!"
        let message = json["message"] as? String

        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        if let message {
            content.subtitle = message
        }
        content.sound = getNotificationSound()
        content.categoryIdentifier = "TEST"
        content.userInfo = ["type": "test-notification"]

        logger.info("📤 Delivering test notification: \(title) - \(body)")
        deliverNotification(content, identifier: "test-\(UUID().uuidString)")
    }

    private func handleClaudeTurn(_ json: [String: Any]) {
        guard let sessionId = json["sessionId"] as? String else {
            logger.error("Claude turn event missing sessionId")
            return
        }

        let sessionName = json["sessionName"] as? String ?? "Claude"
        let message = json["message"] as? String ?? "Claude has finished responding"

        let content = UNMutableNotificationContent()
        content.title = "Your Turn"
        content.body = message
        content.subtitle = sessionName
        content.sound = getNotificationSound()
        content.categoryIdentifier = "CLAUDE_TURN"
        content.userInfo = ["sessionId": sessionId, "type": "claude-turn"]
        content.interruptionLevel = .active

        deliverNotification(content, identifier: "claude-turn-\(sessionId)-\(Date().timeIntervalSince1970)")
    }

    // MARK: - Notification Delivery

    private func deliverNotification(_ content: UNNotificationContent, identifier: String) {
        let request = UNNotificationRequest(identifier: identifier, content: content, trigger: nil)

        UNUserNotificationCenter.current().add(request) { [weak self] error in
            if let error {
                self?.logger.error("Failed to deliver notification: \(error)")
            } else {
                self?.logger.debug("Notification delivered: \(identifier)")
            }
        }
    }

    private func deliverNotificationWithAutoDismiss(
        _ content: UNNotificationContent,
        identifier: String,
        dismissAfter seconds: TimeInterval
    ) {
        deliverNotification(content, identifier: identifier)

        // Schedule automatic dismissal
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds) {
            UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [identifier])
        }
    }

    // MARK: - Cleanup

    private func scheduleNotificationCleanup(for key: String, after seconds: TimeInterval) {
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { [weak self] in
            self?.recentlyNotifiedSessions.remove(key)
        }
    }

    /// Send a test notification through the server to verify the full flow
    func sendServerTestNotification() async {
        logger.info("🧪 Sending test notification through server...")

        // Check if server is running
        guard serverManager.isRunning else {
            logger.error("❌ Cannot send test notification - server is not running")
            return
        }

        // If not connected to SSE, try to connect first
        if !isConnected {
            logger.warning("⚠️ Not connected to SSE endpoint, attempting to connect...")
            await MainActor.run {
                connect()
            }
            // Give it a moment to connect
            try? await Task.sleep(nanoseconds: 500_000_000) // 0.5 seconds
        }

        // Log server info
        logger
            .info(
                "Server info - Port: \(self.serverManager.port), Running: \(self.serverManager.isRunning), SSE Connected: \(self.isConnected)"
            )

        guard let url = serverManager.buildURL(endpoint: "/api/test-notification") else {
            logger.error("❌ Failed to build test notification URL")
            return
        }

        logger.info("📤 Sending POST request to: \(url)")

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        // Add auth token if available
        if let authToken = serverManager.localAuthToken {
            request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
            logger.debug("Added auth token to request")
        }

        do {
            let (data, response) = try await URLSession.shared.data(for: request)

            if let httpResponse = response as? HTTPURLResponse {
                logger.info("📥 Received response - Status: \(httpResponse.statusCode)")

                if httpResponse.statusCode == 200 {
                    logger.info("✅ Server test notification sent successfully")
                    if let responseData = String(data: data, encoding: .utf8) {
                        logger.debug("Response data: \(responseData)")
                    }
                } else {
                    logger.error("❌ Server test notification failed with status: \(httpResponse.statusCode)")
                    if let errorData = String(data: data, encoding: .utf8) {
                        logger.error("Error response: \(errorData)")
                    }
                }
            }
        } catch {
            logger.error("❌ Failed to send server test notification: \(error)")
            logger.error("Error details: \(error.localizedDescription)")
        }
    }

    deinit {
        // Note: We can't call disconnect() here because it's @MainActor isolated
        // The cleanup will happen when the EventSource is deallocated
        // NotificationCenter observers are automatically removed on deinit in modern Swift
    }
}
