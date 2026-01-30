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
    private let wsClient = WsV3SocketClient.shared
    private var isConnected = false
    private var recentlyNotifiedSessions = Set<String>()
    private var notificationCleanupTimer: Timer?

    /// Public property to check the WS v3 event stream connection status
    var isEventStreamConnected: Bool { self.isConnected }

    /// Notification types that can be enabled/disabled
    struct NotificationPreferences {
        var sessionStart: Bool
        var sessionExit: Bool
        var commandCompletion: Bool
        var commandError: Bool
        var bell: Bool
        var soundEnabled: Bool
        var vibrationEnabled: Bool

        /// Memberwise initializer
        init(
            sessionStart: Bool,
            sessionExit: Bool,
            commandCompletion: Bool,
            commandError: Bool,
            bell: Bool,
            soundEnabled: Bool,
            vibrationEnabled: Bool)
        {
            self.sessionStart = sessionStart
            self.sessionExit = sessionExit
            self.commandCompletion = commandCompletion
            self.commandError = commandError
            self.bell = bell
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
            self.soundEnabled = configManager.notificationSoundEnabled
            self.vibrationEnabled = configManager.notificationVibrationEnabled
        }
    }

    private var preferences: NotificationPreferences

    // Dependencies (will be set after init to avoid circular dependency)
    private weak var serverProvider: ServerManager?
    private weak var configProvider: ConfigManager?

    private static func isRunningTests() -> Bool {
        let processInfo = ProcessInfo.processInfo
        return processInfo.environment[EnvironmentKeys.xcTestConfigurationFilePath] != nil ||
            processInfo.environment["XCTestBundlePath"] != nil ||
            processInfo.environment["XCTestSessionIdentifier"] != nil ||
            processInfo.arguments.contains("-XCTest") ||
            NSClassFromString("XCTestCase") != nil
    }

    private static func canUseUserNotifications() -> Bool {
        guard !self.isRunningTests() else { return false }
        return Bundle.main.bundlePath.hasSuffix(".app")
    }

    @MainActor
    override private init() {
        // Initialize with default preferences first
        self.preferences = NotificationPreferences(
            sessionStart: true,
            sessionExit: true,
            commandCompletion: true,
            commandError: true,
            bell: true,
            soundEnabled: true,
            vibrationEnabled: true)

        super.init()

        // Set delegate immediately on initialization
        // This ensures it's set before the app finishes launching, which is required for proper notification handling
        if Self.canUseUserNotifications() {
            UNUserNotificationCenter.current().delegate = self
            self.logger.info("✅ NotificationService set as UNUserNotificationCenter delegate in init()")
        } else {
            self.logger.info("🧪 Skipping UNUserNotificationCenter delegate setup in tests")
        }

        // Defer dependency setup to avoid circular initialization
        Task { @MainActor in
            self.serverProvider = ServerManager.shared
            self.configProvider = ConfigManager.shared
            // Now load actual preferences
            if let configProvider = self.configProvider {
                self.preferences = NotificationPreferences(fromConfig: configProvider)
            }
            self.setupNotifications()
            self.listenForConfigChanges()
        }
    }

    /// Start monitoring server events
    func start() async {
        self.logger.info("🚀 NotificationService.start() called")

        if !Self.canUseUserNotifications() {
            self.logger.info("🧪 Skipping notification service start outside app bundle")
            return
        }

        // Delegate is already set in init(), but we can log it for debugging
        let currentDelegate = UNUserNotificationCenter.current().delegate
        self.logger.info("🔍 Current UNUserNotificationCenter delegate: \(String(describing: currentDelegate))")
        // Check if notifications are enabled in config
        guard let configProvider, configProvider.notificationsEnabled else {
            self.logger.info("📴 Notifications are disabled in config, skipping event stream connection")
            return
        }

        guard let serverProvider, serverProvider.isRunning else {
            self.logger.warning("🔴 Server not running, cannot start notification service")
            return
        }

        self.logger.info("🔔 Starting notification service - server is running on port \(serverProvider.port)")

        // Wait for Unix socket to be ready before connecting
        // This ensures the server is fully ready to accept connections
        await MainActor.run {
            self.waitForUnixSocketAndConnect()
        }
    }

    /// Wait for Unix socket ready notification then connect
    private func waitForUnixSocketAndConnect() {
        self.logger.info("⏳ Waiting for Unix socket ready notification...")

        // Check if Unix socket is already connected
        if SharedUnixSocketManager.shared.isConnected {
            self.logger.info("✅ Unix socket already connected, connecting to event stream immediately")
            self.connect()
            return
        }

        // Listen for Unix socket ready notification
        NotificationCenter.default.addObserver(
            forName: SharedUnixSocketManager.unixSocketReadyNotification,
            object: nil,
            queue: .main)
        { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.logger.info("✅ Unix socket ready notification received, connecting to event stream")
                self?.connect()

                // Remove observer after first notification to prevent duplicate connections
                NotificationCenter.default.removeObserver(
                    self as Any,
                    name: SharedUnixSocketManager.unixSocketReadyNotification,
                    object: nil)
            }
        }
    }

    /// Stop monitoring server events
    func stop() {
        self.disconnect()
    }

    /// Request notification permissions and show test notification
    func requestPermissionAndShowTestNotification() async -> Bool {
        let center = UNUserNotificationCenter.current()

        // Debug: Log current notification settings
        let settings = await center.notificationSettings()
        self.logger
            .info(
                "🔔 Current notification settings - authorizationStatus: \(settings.authorizationStatus.rawValue, privacy: .public), alertSetting: \(settings.alertSetting.rawValue, privacy: .public)")

        switch await self.authorizationStatus() {
        case .notDetermined:
            // First time - request permission
            do {
                let granted = try await center.requestAuthorization(options: [.alert, .sound, .badge])

                if granted {
                    self.logger.info("✅ Notification permissions granted")

                    // Debug: Log granted settings
                    let newSettings = await center.notificationSettings()
                    self.logger
                        .info(
                            "🔔 New settings after grant - alert: \(newSettings.alertSetting.rawValue, privacy: .public), sound: \(newSettings.soundSetting.rawValue, privacy: .public), badge: \(newSettings.badgeSetting.rawValue, privacy: .public)")

                    // Show test notification
                    let content = UNMutableNotificationContent()
                    content.title = "VibeTunnel Notifications"
                    content.body = "Notifications are now enabled! You'll receive alerts for terminal events."
                    content.sound = self.getNotificationSound()

                    self.deliverNotification(content, identifier: "permission-granted-\(UUID().uuidString)")

                    return true
                } else {
                    self.logger.warning("⚠️ Notification permissions denied by user")
                    return false
                }
            } catch {
                self.logger.error("❌ Failed to request notification permissions: \(error)")
                return false
            }

        case .denied:
            self.logger.warning("⚠️ Notification permissions previously denied")
            return false

        case .authorized, .provisional:
            self.logger.info("✅ Notification permissions already granted")

            // Show test notification
            let content = UNMutableNotificationContent()
            content.title = "VibeTunnel Notifications"
            content.body = "Notifications are already enabled! You'll receive alerts for terminal events."
            content.sound = self.getNotificationSound()

            self.deliverNotification(content, identifier: "permission-test-\(UUID().uuidString)")

            return true

        case .ephemeral:
            self.logger.info("ℹ️ Ephemeral notification permissions")
            return true

        @unknown default:
            self.logger.warning("⚠️ Unknown notification authorization status")
            return false
        }
    }

    // MARK: - Public Notification Methods

    /// Send a notification for a server event
    /// - Parameter event: The server event to create a notification for
    func sendNotification(for event: ServerEvent) async {
        // Check master switch first
        guard self.configProvider?.notificationsEnabled ?? false else { return }

        // Check preferences based on event type
        switch event.type {
        case .sessionStart:
            guard self.preferences.sessionStart else { return }
        case .sessionExit:
            guard self.preferences.sessionExit else { return }
        case .commandFinished:
            guard self.preferences.commandCompletion else { return }
        case .commandError:
            guard self.preferences.commandError else { return }
        case .bell:
            guard self.preferences.bell else { return }
        case .connected:
            // Connected events don't trigger notifications
            return
        case .testNotification:
            break
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

        case .connected:
            return // Already handled above

        case .testNotification:
            content.title = event.title ?? "Test Notification"
            content.body = event.body ?? "VibeTunnel test notification"
            content.categoryIdentifier = "TEST"
            content.interruptionLevel = .active
        }

        // Set sound based on event type
        content.sound = event.type == .commandError ? self.getNotificationSound(critical: true) : self
            .getNotificationSound()

        // Add session ID to user info if available
        if let sessionId = event.sessionId {
            content.userInfo = ["sessionId": sessionId, "type": event.type.rawValue]
        }

        // Generate identifier
        let identifier = "\(event.type.rawValue)-\(event.sessionId ?? UUID().uuidString)"

        // Deliver notification with appropriate method
        if event.type == .sessionStart {
            self.deliverNotificationWithAutoDismiss(content, identifier: identifier, dismissAfter: 5.0)
        } else {
            self.deliverNotification(content, identifier: identifier)
        }
    }

    // Keep notification creation centralized via `sendNotification(for:)`.

    /// Send a test notification for debugging and verification
    func sendTestNotification(title: String? = nil, message: String? = nil, sessionId: String? = nil) async {
        guard self.configProvider?.notificationsEnabled ?? false else { return }

        let content = UNMutableNotificationContent()
        content.title = title ?? "Test Notification"
        content.body = message ?? "This is a test notification from VibeTunnel"
        content.sound = self.getNotificationSound()
        content.categoryIdentifier = "TEST"
        content.interruptionLevel = .passive

        if let sessionId {
            content.subtitle = "Session: \(sessionId)"
            content.userInfo = ["sessionId": sessionId, "type": "test-notification"]
        } else {
            content.userInfo = ["type": "test-notification"]
        }

        let identifier = "test-\(sessionId ?? UUID().uuidString)"
        self.deliverNotification(content, identifier: identifier)

        self.logger.info("🧪 Test notification sent: \(title ?? "Test Notification") - \(message ?? "Test message")")
    }

    /// Open System Settings to the Notifications pane
    func openNotificationSettings() {
        // Try to open directly to the app's settings
        if let url =
            URL(
                string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=sh.vibetunnel.vibetunnel")
        {
            NSWorkspace.shared.open(url)
        } else if let url = URL(string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension") {
            NSWorkspace.shared.open(url)
        }
    }

    /// Update notification preferences
    func updatePreferences(_ prefs: NotificationPreferences) {
        self.preferences = prefs

        // Update ConfigManager
        self.configProvider?.updateNotificationPreferences(
            sessionStart: prefs.sessionStart,
            sessionExit: prefs.sessionExit,
            commandCompletion: prefs.commandCompletion,
            commandError: prefs.commandError,
            bell: prefs.bell,
            soundEnabled: prefs.soundEnabled,
            vibrationEnabled: prefs.vibrationEnabled)
    }

    /// Get notification sound based on user preferences
    private func getNotificationSound(critical: Bool = false) -> UNNotificationSound? {
        guard self.preferences.soundEnabled else { return nil }
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
                .badge,
            ])

            self.logger.info("Notification permission granted: \(granted)")

            return granted
        } catch {
            self.logger.error("Failed to request notification permissions: \(error)")
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
        self.logger.info("🔌 NotificationService.connect() called - isConnected: \(self.isConnected, privacy: .public)")
        guard !self.isConnected else {
            self.logger.info("Already connected to notification service")
            return
        }

        // When auth mode is "none", we can connect without a token.
        // In any other auth mode, a token is required for the local Mac app to connect.
        guard let serverProvider = self.serverProvider else {
            self.logger.error("Server provider is not available")
            return
        }

        self.wsClient.onConnectionStateChange = { [weak self] state in
            guard let self else { return }
            self.isConnected = (state == .connected)
            NotificationCenter.default.post(name: .notificationServiceConnectionChanged, object: nil)
        }

        self.wsClient.onServerEvent = { [weak self] event, _ in
            guard let self else { return }
            Task { @MainActor in
                self.handleServerEvent(event)
            }
        }

        self.logger.info("📡 Connecting to WS v3 events stream on port \(serverProvider.port, privacy: .public)")
        self.wsClient.connect(
            serverPort: serverProvider.port,
            authMode: serverProvider.authMode,
            token: serverProvider.localAuthToken)

        self.wsClient.subscribeGlobalEvents()
    }

    private func disconnect() {
        self.wsClient.disconnect()
        self.isConnected = false
        self.logger.info("Disconnected from notification service")
        // Post notification for UI update
        NotificationCenter.default.post(name: .notificationServiceConnectionChanged, object: nil)
    }

    private func handleServerEvent(_ event: ServerEvent) {
        switch event.type {
        case .sessionStart:
            self.logger.info("🚀 Processing session-start event")
            if self.configProvider?.notificationsEnabled ?? false, self.preferences.sessionStart {
                self.handleSessionStart(event)
            }
        case .sessionExit:
            self.logger.info("🏁 Processing session-exit event")
            if self.configProvider?.notificationsEnabled ?? false, self.preferences.sessionExit {
                self.handleSessionExit(event)
            }
        case .commandFinished:
            self.logger.info("✅ Processing command-finished event")
            if self.configProvider?.notificationsEnabled ?? false, self.preferences.commandCompletion {
                self.handleCommandFinished(event)
            }
        case .commandError:
            self.logger.info("❌ Processing command-error event")
            if self.configProvider?.notificationsEnabled ?? false, self.preferences.commandError {
                self.handleCommandError(event)
            }
        case .bell:
            self.logger.info("🔔 Processing bell event")
            if self.configProvider?.notificationsEnabled ?? false, self.preferences.bell {
                self.handleBell(event)
            }
        case .connected:
            self.logger.info("🔗 Received connected event from server")
        case .testNotification:
            self.logger.info("🧪 Processing test-notification event")
            self.handleTestNotification(event)
        }
    }

    // MARK: - Event Handlers

    private func handleSessionStart(_ event: ServerEvent) {
        guard let sessionId = event.sessionId else {
            self.logger.error("Session start event missing sessionId")
            return
        }

        let sessionName = event.sessionName ?? "Terminal Session"

        // Prevent duplicate notifications
        if self.recentlyNotifiedSessions.contains("start-\(sessionId)") {
            self.logger.debug("Skipping duplicate session start notification for \(sessionId)")
            return
        }

        self.recentlyNotifiedSessions.insert("start-\(sessionId)")

        let content = UNMutableNotificationContent()
        content.title = "Session Started"
        content.body = sessionName
        content.sound = self.getNotificationSound()
        content.categoryIdentifier = "SESSION"
        content.userInfo = ["sessionId": sessionId, "type": "session-start"]
        content.interruptionLevel = .passive

        self.deliverNotificationWithAutoDismiss(content, identifier: "session-start-\(sessionId)", dismissAfter: 5.0)

        // Schedule cleanup
        self.scheduleNotificationCleanup(for: "start-\(sessionId)", after: 30)
    }

    private func handleSessionExit(_ event: ServerEvent) {
        guard let sessionId = event.sessionId else {
            self.logger.error("Session exit event missing sessionId")
            return
        }

        let sessionName = event.sessionName ?? "Terminal Session"
        let exitCode = event.exitCode ?? 0

        // Prevent duplicate notifications
        if self.recentlyNotifiedSessions.contains("exit-\(sessionId)") {
            self.logger.debug("Skipping duplicate session exit notification for \(sessionId)")
            return
        }

        self.recentlyNotifiedSessions.insert("exit-\(sessionId)")

        let content = UNMutableNotificationContent()
        content.title = "Session Ended"
        content.body = sessionName
        content.sound = self.getNotificationSound()
        content.categoryIdentifier = "SESSION"
        content.userInfo = ["sessionId": sessionId, "type": "session-exit", "exitCode": exitCode]

        if exitCode != 0 {
            content.subtitle = "Exit code: \(exitCode)"
        }

        self.deliverNotification(content, identifier: "session-exit-\(sessionId)")

        // Schedule cleanup
        self.scheduleNotificationCleanup(for: "exit-\(sessionId)", after: 30)
    }

    private func handleCommandFinished(_ event: ServerEvent) {
        let command = event.command ?? "Command"
        let duration = event.duration ?? 0

        let content = UNMutableNotificationContent()
        content.title = "Your Turn"
        content.body = command
        content.sound = self.getNotificationSound()
        content.categoryIdentifier = "COMMAND"
        content.interruptionLevel = .active

        // Format duration if provided
        if duration > 0 {
            let seconds = duration / 1000
            if seconds < 60 {
                content.subtitle = "\(seconds)s"
            } else {
                let minutes = seconds / 60
                let remainingSeconds = seconds % 60
                content.subtitle = "\(minutes)m \(remainingSeconds)s"
            }
        }

        if let sessionId = event.sessionId {
            content.userInfo = ["sessionId": sessionId, "type": "command-finished"]
        }

        self.deliverNotification(content, identifier: "command-\(UUID().uuidString)")
    }

    private func handleCommandError(_ event: ServerEvent) {
        let command = event.command ?? "Command"
        let exitCode = event.exitCode ?? 1

        let content = UNMutableNotificationContent()
        content.title = "Command Failed"
        content.body = command
        content.sound = self.getNotificationSound(critical: true)
        content.categoryIdentifier = "COMMAND"
        content.subtitle = "Exit code: \(exitCode)"

        if let sessionId = event.sessionId {
            content.userInfo = ["sessionId": sessionId, "type": "command-error", "exitCode": exitCode]
        }

        self.deliverNotification(content, identifier: "error-\(UUID().uuidString)")
    }

    private func handleBell(_ event: ServerEvent) {
        guard let sessionId = event.sessionId else {
            self.logger.error("Bell event missing sessionId")
            return
        }

        let sessionName = event.sessionName ?? "Terminal"

        let content = UNMutableNotificationContent()
        content.title = "Terminal Bell"
        content.body = sessionName
        content.sound = self.getNotificationSound()
        content.categoryIdentifier = "BELL"
        content.userInfo = ["sessionId": sessionId, "type": "bell"]

        if let message = event.message {
            content.subtitle = message
        }

        self.deliverNotification(content, identifier: "bell-\(sessionId)-\(Date().timeIntervalSince1970)")
    }

    private func handleTestNotification(_ event: ServerEvent) {
        let title = event.title ?? "VibeTunnel Test"
        let body = event.body ?? "Server-side notifications are working correctly!"
        let message = event.message

        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        if let message {
            content.subtitle = message
        }
        content.sound = self.getNotificationSound()
        content.categoryIdentifier = "TEST"
        content.userInfo = ["type": "test-notification"]

        self.logger.info("📤 Delivering test notification: \(title, privacy: .public) - \(body, privacy: .public)")
        self.deliverNotification(content, identifier: "test-\(UUID().uuidString)")
    }

    // MARK: - Notification Delivery

    private func deliverNotification(_ content: UNNotificationContent, identifier: String) {
        guard Self.canUseUserNotifications() else {
            self.logger.debug("Skipping notification delivery outside app bundle")
            return
        }
        let request = UNNotificationRequest(identifier: identifier, content: content, trigger: nil)

        Task { @MainActor in
            do {
                try await UNUserNotificationCenter.current().add(request)
                self.logger.debug("Notification delivered: \(identifier, privacy: .public)")
            } catch {
                self.logger
                    .error(
                        "Failed to deliver notification: \(error, privacy: .public) for identifier: \(identifier, privacy: .public)")
            }
        }
    }

    private func deliverNotificationWithAutoDismiss(
        _ content: UNNotificationContent,
        identifier: String,
        dismissAfter seconds: TimeInterval)
    {
        guard Self.canUseUserNotifications() else {
            self.logger.debug("Skipping auto-dismiss notification outside app bundle")
            return
        }
        self.deliverNotification(content, identifier: identifier)

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
        self.logger.info("🧪 Sending test notification through server...")
        // Show thread details for debugging dispatch issues
        self.logger.info("🧵 Current thread: \(Thread.current, privacy: .public)")
        self.logger.info("🧵 Is main thread: \(Thread.isMainThread, privacy: .public)")
        // Check if server is running
        guard self.serverProvider?.isRunning ?? false else {
            self.logger.error("❌ Cannot send test notification - server is not running")
            return
        }

        // If not connected to the event stream, try to connect first
        if !self.isConnected {
            self.logger.warning("⚠️ Not connected to event stream, attempting to connect...")
            self.connect()
            // Give it a moment to connect
            try? await Task.sleep(nanoseconds: 500_000_000) // 0.5 seconds
        }

        // Log server info
        self.logger
            .info(
                "Server info - Port: \(self.serverProvider?.port ?? "unknown"), Running: \(self.serverProvider?.isRunning ?? false), Event Stream Connected: \(self.isConnected)")

        guard let url = serverProvider?.buildURL(endpoint: "/api/test-notification") else {
            self.logger.error("❌ Failed to build test notification URL")
            return
        }

        // Show full URL for debugging test notification endpoint
        self.logger.info("📤 Sending POST request to: \(url, privacy: .public)")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        // Add auth token if available
        if let authToken = serverProvider?.localAuthToken {
            request.setValue(authToken, forHTTPHeaderField: NetworkConstants.localAuthHeader)
            self.logger.debug("Added local auth token to request")
        }

        do {
            let (data, response) = try await URLSession.shared.data(for: request)

            if let httpResponse = response as? HTTPURLResponse {
                // Show HTTP status code for debugging
                self.logger.info("📥 Received response - Status: \(httpResponse.statusCode, privacy: .public)")
                if httpResponse.statusCode == 200 {
                    self.logger.info("✅ Server test notification sent successfully")
                    if let responseData = String(data: data, encoding: .utf8) {
                        // Show full response for debugging
                        self.logger.debug("Response data: \(responseData, privacy: .public)")
                    }
                } else {
                    self.logger.error("❌ Server test notification failed with status: \(httpResponse.statusCode)")
                    if let errorData = String(data: data, encoding: .utf8) {
                        // Show full error response for debugging
                        self.logger.error("Error response: \(errorData, privacy: .public)")
                    }
                }
            }
        } catch {
            self.logger.error("❌ Failed to send server test notification: \(error)")
            self.logger.error("Error details: \(error.localizedDescription)")
        }
    }

    deinit {
        // Note: We can't call disconnect() here because it's @MainActor isolated
        // Cleanup is handled via stop() / server lifecycle
        // NotificationCenter observers are automatically removed on deinit in modern Swift
    }

    // MARK: - UNUserNotificationCenterDelegate

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void)
    {
        // Debug: Show full notification details
        self.logger
            .info(
                "🔔 willPresent notification - identifier: \(notification.request.identifier, privacy: .public), title: \(notification.request.content.title, privacy: .public), body: \(notification.request.content.body, privacy: .public)")
        // Show notifications even when app is in foreground
        completionHandler([.banner, .sound, .list])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void)
    {
        // Debug: Show interaction details
        self.logger
            .info(
                "🔔 didReceive response - identifier: \(response.notification.request.identifier, privacy: .public), actionIdentifier: \(response.actionIdentifier, privacy: .public)")
        // Handle notification actions here if needed in the future
        completionHandler()
    }
}
