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
final class NotificationService: NSObject, @preconcurrency UNUserNotificationCenterDelegate {
    @MainActor
    static let shared = // Defer initialization to avoid circular dependency
        // This ensures ServerManager and ConfigManager are ready
        NotificationService()

    private let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "NotificationService")
    private var eventSource: EventSource?
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

        /// Memberwise initializer
        init(
            sessionStart: Bool,
            sessionExit: Bool,
            commandCompletion: Bool,
            commandError: Bool,
            bell: Bool,
            claudeTurn: Bool,
            soundEnabled: Bool,
            vibrationEnabled: Bool
        ) {
            self.sessionStart = sessionStart
            self.sessionExit = sessionExit
            self.commandCompletion = commandCompletion
            self.commandError = commandError
            self.bell = bell
            self.claudeTurn = claudeTurn
            self.soundEnabled = soundEnabled
            self.vibrationEnabled = vibrationEnabled
        }

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

    // Dependencies (will be set after init to avoid circular dependency)
    private weak var serverProvider: ServerManager?
    private weak var configProvider: ConfigManager?

    @MainActor
    override private init() {
        // Initialize with default preferences first
        self.preferences = NotificationPreferences(
            sessionStart: true,
            sessionExit: true,
            commandCompletion: true,
            commandError: true,
            bell: true,
            claudeTurn: false,
            soundEnabled: true,
            vibrationEnabled: true
        )

        super.init()

        // Defer dependency setup to avoid circular initialization
        Task { @MainActor in
            self.serverProvider = ServerManager.shared
            self.configProvider = ConfigManager.shared
            // Now load actual preferences
            if let configProvider = self.configProvider {
                self.preferences = NotificationPreferences(fromConfig: configProvider)
            }
            setupNotifications()
            listenForConfigChanges()
        }
    }

    /// Start monitoring server events
    func start() async {
        logger.info("🚀 NotificationService.start() called")

        // Set delegate here to ensure it's done at the right time
        UNUserNotificationCenter.current().delegate = self
        logger.info("✅ NotificationService set as UNUserNotificationCenter delegate in start()")

        // Debug: Log current delegate to verify it's set
        let currentDelegate = UNUserNotificationCenter.current().delegate
        logger.info("🔍 Current UNUserNotificationCenter delegate: \(String(describing: currentDelegate))")
        // Check if notifications are enabled in config
        guard let configProvider, configProvider.notificationsEnabled else {
            logger.info("📴 Notifications are disabled in config, skipping SSE connection")
            return
        }

        guard let serverProvider, serverProvider.isRunning else {
            logger.warning("🔴 Server not running, cannot start notification service")
            return
        }

        logger.info("🔔 Starting notification service - server is running on port \(serverProvider.port)")

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

        // Debug: Log current notification settings
        let settings = await center.notificationSettings()
        logger
            .info(
                "🔔 Current notification settings - authorizationStatus: \(settings.authorizationStatus.rawValue, privacy: .public), alertSetting: \(settings.alertSetting.rawValue, privacy: .public)"
            )

        switch await authorizationStatus() {
        case .notDetermined:
            // First time - request permission
            do {
                let granted = try await center.requestAuthorization(options: [.alert, .sound, .badge])

                if granted {
                    logger.info("✅ Notification permissions granted")

                    // Debug: Log granted settings
                    let newSettings = await center.notificationSettings()
                    logger
                        .info(
                            "🔔 New settings after grant - alert: \(newSettings.alertSetting.rawValue, privacy: .public), sound: \(newSettings.soundSetting.rawValue, privacy: .public), badge: \(newSettings.badgeSetting.rawValue, privacy: .public)"
                        )

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
        guard configProvider?.notificationsEnabled ?? false else { return }

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
        guard configProvider?.notificationsEnabled ?? false && preferences.sessionStart else { return }

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
        guard configProvider?.notificationsEnabled ?? false && preferences.sessionExit else { return }

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
        guard configProvider?.notificationsEnabled ?? false && preferences.commandCompletion else { return }

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
        guard configProvider?.notificationsEnabled ?? false else { return }

        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = getNotificationSound()
        content.categoryIdentifier = "GENERAL"

        deliverNotification(content, identifier: "generic-\(UUID().uuidString)")
    }

    /// Send a test notification for debugging and verification
    func sendTestNotification(title: String? = nil, message: String? = nil, sessionId: String? = nil) async {
        guard configProvider?.notificationsEnabled ?? false else { return }

        let content = UNMutableNotificationContent()
        content.title = title ?? "Test Notification"
        content.body = message ?? "This is a test notification from VibeTunnel"
        content.sound = getNotificationSound()
        content.categoryIdentifier = "TEST"
        content.interruptionLevel = .passive

        if let sessionId {
            content.subtitle = "Session: \(sessionId)"
            content.userInfo = ["sessionId": sessionId, "type": "test-notification"]
        } else {
            content.userInfo = ["type": "test-notification"]
        }

        let identifier = "test-\(sessionId ?? UUID().uuidString)"
        deliverNotification(content, identifier: identifier)

        logger.info("🧪 Test notification sent: \(title ?? "Test Notification") - \(message ?? "Test message")")
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
        configProvider?.updateNotificationPreferences(
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
        // Using interpolation to bypass privacy restrictions for debugging
        logger.info("🔌 NotificationService.connect() called - isConnected: \(self.isConnected, privacy: .public)")
        guard !isConnected else {
            logger.info("Already connected to notification service")
            return
        }

        // When auth mode is "none", we can connect without a token.
        // In any other auth mode, a token is required for the local Mac app to connect.
        guard let serverProvider = self.serverProvider else {
            logger.error("Server provider is not available")
            return
        }

        if serverProvider.authMode != "none", serverProvider.localAuthToken == nil {
            logger.error("No auth token available for notification service in auth mode '\(serverProvider.authMode)'")
            return
        }

        let eventsURL = "http://localhost:\(serverProvider.port)/api/events"
        // Show full URL for debugging SSE connection issues
        logger.info("📡 Attempting to connect to SSE endpoint: \(eventsURL, privacy: .public)")
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
        if let authToken = serverProvider.localAuthToken {
            headers["Authorization"] = "Bearer \(authToken)"
            // Show token prefix for debugging (first 10 chars only for security)
            let tokenPrefix = String(authToken.prefix(10))
            logger.info("🔑 Using auth token for SSE connection: \(tokenPrefix, privacy: .public)...")
        } else {
            logger.info("🔓 Connecting to SSE without an auth token (auth mode: '\(serverProvider.authMode)')")
        }

        // Add custom header to indicate this is the Mac app
        headers["X-VibeTunnel-Client"] = "mac-app"

        eventSource = EventSource(url: url, headers: headers)

        eventSource?.onOpen = { [weak self] in
            Task { @MainActor in
                guard let self else { return }
                self.logger.info("✅ Connected to notification event stream")
                self.isConnected = true
                // Post notification for UI update
                NotificationCenter.default.post(name: .notificationServiceConnectionChanged, object: nil)
            }
        }

        eventSource?.onError = { [weak self] error in
            Task { @MainActor in
                guard let self else { return }
                if let error {
                    self.logger.error("❌ EventSource error: \(error)")
                }
                self.isConnected = false
                // Post notification for UI update
                NotificationCenter.default.post(name: .notificationServiceConnectionChanged, object: nil)
                // Don't reconnect here - let server state changes trigger reconnection
            }
        }

        eventSource?.onMessage = { [weak self] event in
            Task { @MainActor in
                guard let self else { return }
                self.logger
                    .info(
                        "🎯 EventSource onMessage fired! Event type: \(event.event ?? "default", privacy: .public), Has data: \(event.data != nil, privacy: .public)"
                    )
                await self.handleEvent(event)
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

    private func handleEvent(_ event: Event) async {
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
                if configProvider?.notificationsEnabled ?? false && preferences.sessionStart {
                    handleSessionStart(json)
                } else {
                    logger.debug("Session start notifications disabled")
                }
            case "session-exit":
                logger.info("🏁 Processing session-exit event")
                if configProvider?.notificationsEnabled ?? false && preferences.sessionExit {
                    handleSessionExit(json)
                } else {
                    logger.debug("Session exit notifications disabled")
                }
            case "command-finished":
                logger.info("✅ Processing command-finished event")
                if configProvider?.notificationsEnabled ?? false && preferences.commandCompletion {
                    handleCommandFinished(json)
                } else {
                    logger.debug("Command completion notifications disabled")
                }
            case "command-error":
                logger.info("❌ Processing command-error event")
                if configProvider?.notificationsEnabled ?? false && preferences.commandError {
                    handleCommandError(json)
                } else {
                    logger.debug("Command error notifications disabled")
                }
            case "bell":
                logger.info("🔔 Processing bell event")
                if configProvider?.notificationsEnabled ?? false && preferences.bell {
                    handleBell(json)
                } else {
                    logger.debug("Bell notifications disabled")
                }
            case "claude-turn":
                logger.info("💬 Processing claude-turn event")
                if configProvider?.notificationsEnabled ?? false && preferences.claudeTurn {
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
            logger.error("Failed to parse legacy event data: \(error)")
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
        // Debug: Show full test notification data
        logger.info("🧪 Handling test notification from server - JSON: \(json, privacy: .public)")
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

        Task { @MainActor in
            do {
                try await UNUserNotificationCenter.current().add(request)
                self.logger.debug("Notification delivered: \(identifier, privacy: .public)")
            } catch {
                self.logger
                    .error(
                        "Failed to deliver notification: \(error, privacy: .public) for identifier: \(identifier, privacy: .public)"
                    )
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
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [identifier])
        }
    }

    // MARK: - Cleanup

    private func scheduleNotificationCleanup(for key: String, after seconds: TimeInterval) {
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            self.recentlyNotifiedSessions.remove(key)
        }
    }

    /// Send a test notification through the server to verify the full flow
    @MainActor
    func sendServerTestNotification() async {
        logger.info("🧪 Sending test notification through server...")
        // Show thread details for debugging dispatch issues
        logger.info("🧵 Current thread: \(Thread.current, privacy: .public)")
        logger.info("🧵 Is main thread: \(Thread.isMainThread, privacy: .public)")
        // Check if server is running
        guard serverProvider?.isRunning ?? false else {
            logger.error("❌ Cannot send test notification - server is not running")
            return
        }

        // If not connected to SSE, try to connect first
        if !isConnected {
            logger.warning("⚠️ Not connected to SSE endpoint, attempting to connect...")
            connect()
            // Give it a moment to connect
            try? await Task.sleep(nanoseconds: 500_000_000) // 0.5 seconds
        }

        // Log server info
        logger
            .info(
                "Server info - Port: \(self.serverProvider?.port ?? "unknown"), Running: \(self.serverProvider?.isRunning ?? false), SSE Connected: \(self.isConnected)"
            )

        guard let url = serverProvider?.buildURL(endpoint: "/api/test-notification") else {
            logger.error("❌ Failed to build test notification URL")
            return
        }

        // Show full URL for debugging test notification endpoint
        logger.info("📤 Sending POST request to: \(url, privacy: .public)")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        // Add auth token if available
        if let authToken = serverProvider?.localAuthToken {
            request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
            logger.debug("Added auth token to request")
        }

        do {
            let (data, response) = try await URLSession.shared.data(for: request)

            if let httpResponse = response as? HTTPURLResponse {
                // Show HTTP status code for debugging
                logger.info("📥 Received response - Status: \(httpResponse.statusCode, privacy: .public)")
                if httpResponse.statusCode == 200 {
                    logger.info("✅ Server test notification sent successfully")
                    if let responseData = String(data: data, encoding: .utf8) {
                        // Show full response for debugging
                        logger.debug("Response data: \(responseData, privacy: .public)")
                    }
                } else {
                    logger.error("❌ Server test notification failed with status: \(httpResponse.statusCode)")
                    if let errorData = String(data: data, encoding: .utf8) {
                        // Show full error response for debugging
                        logger.error("Error response: \(errorData, privacy: .public)")
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

    // MARK: - UNUserNotificationCenterDelegate

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        // Debug: Show full notification details
        logger
            .info(
                "🔔 willPresent notification - identifier: \(notification.request.identifier, privacy: .public), title: \(notification.request.content.title, privacy: .public), body: \(notification.request.content.body, privacy: .public)"
            )
        // Show notifications even when app is in foreground
        completionHandler([.banner, .sound, .list])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        // Debug: Show interaction details
        logger
            .info(
                "🔔 didReceive response - identifier: \(response.notification.request.identifier, privacy: .public), actionIdentifier: \(response.actionIdentifier, privacy: .public)"
            )
        // Handle notification actions here if needed in the future
        completionHandler()
    }
}
