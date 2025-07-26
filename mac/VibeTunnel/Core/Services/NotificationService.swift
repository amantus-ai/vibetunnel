import Foundation
import AppKit
import os.log
@preconcurrency import UserNotifications

/// Manages native macOS notifications for VibeTunnel events.
@MainActor
final class NotificationService: NSObject {
    static let shared = NotificationService()
    
    private let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "NotificationService")
    private var eventSource: EventSource?
    private let serverManager = ServerManager.shared
    private var isConnected = false
    private var recentNotifications = Set<String>()
    private var observationTask: Task<Void, Never>?
    
    /// Notification preferences
    struct NotificationPreferences {
        var sessionStart = true
        var sessionExit = true
        var commandCompletion = true
        var commandError = true
        var bell = true
        var claudeTurn = true
        
        init() {
            let defaults = UserDefaults.standard
            
            // Check if this is first launch
            if !defaults.bool(forKey: "notifications.initialized") {
                // First launch - set all to true
                defaults.set(true, forKey: "notifications.sessionStart")
                defaults.set(true, forKey: "notifications.sessionExit")
                defaults.set(true, forKey: "notifications.commandCompletion")
                defaults.set(true, forKey: "notifications.commandError")
                defaults.set(true, forKey: "notifications.bell")
                defaults.set(true, forKey: "notifications.claudeTurn")
                defaults.set(true, forKey: "notifications.initialized")
                
                self.sessionStart = true
                self.sessionExit = true
                self.commandCompletion = true
                self.commandError = true
                self.bell = true
                self.claudeTurn = true
            } else {
                // Load from UserDefaults
                self.sessionStart = defaults.bool(forKey: "notifications.sessionStart")
                self.sessionExit = defaults.bool(forKey: "notifications.sessionExit")
                self.commandCompletion = defaults.bool(forKey: "notifications.commandCompletion")
                self.commandError = defaults.bool(forKey: "notifications.commandError")
                self.bell = defaults.bool(forKey: "notifications.bell")
                self.claudeTurn = defaults.bool(forKey: "notifications.claudeTurn")
            }
        }
        
        func save() {
            let defaults = UserDefaults.standard
            defaults.set(sessionStart, forKey: "notifications.sessionStart")
            defaults.set(sessionExit, forKey: "notifications.sessionExit")
            defaults.set(commandCompletion, forKey: "notifications.commandCompletion")
            defaults.set(commandError, forKey: "notifications.commandError")
            defaults.set(bell, forKey: "notifications.bell")
            defaults.set(claudeTurn, forKey: "notifications.claudeTurn")
        }
    }
    
    private var preferences = NotificationPreferences()
    
    
    // MARK: - Initialization
    
    override private init() {
        super.init()
        setupNotificationHandling()
        setupServerObservation()
        
        // Load preferences from API on startup
        Task {
            await syncPreferencesFromAPI()
        }
    }
    
    deinit {
        observationTask?.cancel()
    }
    
    /// Clean up when app terminates
    func applicationWillTerminate() {
        observationTask?.cancel()
        disconnect()
        recentNotifications.removeAll()
    }
    
    // MARK: - Public Methods
    
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
    
    /// Send a session start notification
    func sendSessionStartNotification(sessionName: String) {
        guard preferences.sessionStart else { return }
        
        let content = UNMutableNotificationContent()
        content.title = "Session Started"
        content.body = sessionName
        content.sound = .default
        content.categoryIdentifier = "SESSION"
        content.interruptionLevel = .passive
        
        deliverNotificationWithAutoDismiss(content, identifier: "session-start-\(UUID().uuidString)", dismissAfter: 5.0)
    }
    
    /// Send a session exit notification
    func sendSessionExitNotification(sessionName: String, exitCode: Int) {
        guard preferences.sessionExit else { return }
        
        let content = UNMutableNotificationContent()
        content.title = "Session Ended"
        content.body = sessionName
        content.sound = .default
        content.categoryIdentifier = "SESSION"
        
        if exitCode != 0 {
            content.subtitle = "Exit code: \(exitCode)"
        }
        
        deliverNotification(content, identifier: "session-exit-\(UUID().uuidString)")
    }
    
    /// Send a command completion notification
    func sendCommandCompletionNotification(command: String, duration: Int) {
        guard preferences.commandCompletion else { return }
        
        let content = UNMutableNotificationContent()
        content.title = "Your Turn"
        content.body = command
        content.sound = .default
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
    func sendGenericNotification(title: String, body: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        content.categoryIdentifier = "GENERAL"
        
        deliverNotification(content, identifier: "generic-\(UUID().uuidString)")
    }
    
    /// Request notification permissions and show test notification
    func requestPermissionAndShowTestNotification() async -> Bool {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        
        switch settings.authorizationStatus {
        case .notDetermined:
            // First time - request permission
            do {
                let granted = try await center.requestAuthorization(options: [.alert, .sound, .badge])
                
                if granted {
                    logger.info("✅ Notification permissions granted")
                    showTestNotification()
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
            showTestNotification()
            return true
            
        @unknown default:
            return false
        }
    }
    
    /// Update notification preferences
    func updatePreferences(_ prefs: NotificationPreferences) {
        self.preferences = prefs
        prefs.save()
        
        // Sync to API
        Task {
            await syncPreferencesToAPI(prefs)
        }
    }
    
    // MARK: - Private Methods
    
    private func setupNotificationHandling() {
        UNUserNotificationCenter.current().delegate = self
    }
    
    private func setupServerObservation() {
        observationTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                
                let wasRunning = self.serverManager.isRunning
                try? await Task.sleep(nanoseconds: 1_000_000_000) // Check every second
                
                let isRunning = self.serverManager.isRunning
                if isRunning != wasRunning {
                    if isRunning {
                        self.logger.info("🔔 Server started, connecting...")
                        self.connect()
                    } else {
                        self.logger.info("🔔 Server stopped, disconnecting...")
                        self.disconnect()
                    }
                }
            }
        }
    }
    
    private nonisolated func checkAndRequestNotificationPermissions() async {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        
        if settings.authorizationStatus == .notDetermined {
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
    
    private func connect() {
        guard serverManager.isRunning, !isConnected else {
            logger.debug("🔔 Server not running or already connected")
            return
        }
        
        let port = serverManager.port
        guard let url = URL(string: "http://localhost:\(port)/api/events") else {
            logger.error("🔴 Invalid event stream URL")
            return
        }
        
        guard let localToken = serverManager.bunServer?.localToken else {
            logger.error("🔴 No local auth token available")
            return
        }
        
        logger.info("🔔 Connecting to server event stream...")
        
        eventSource = EventSource(url: url)
        eventSource?.addHeader("X-VibeTunnel-Local", value: localToken)
        
        eventSource?.onOpen = { [weak self] in
            self?.logger.info("✅ Event stream connected")
            self?.isConnected = true
            
            // Send synthetic events for existing sessions
            Task { @MainActor [weak self] in
                guard let self else { return }
                
                let sessions = await SessionMonitor.shared.getSessions()
                for (sessionId, session) in sessions where session.isRunning {
                    let event = ServerEvent(
                        type: .sessionStart,
                        sessionId: sessionId,
                        sessionName: session.name ?? session.command.joined(separator: " ")
                    )
                    self.handleSessionStart(event)
                }
            }
        }
        
        eventSource?.onError = { [weak self] error in
            self?.logger.error("🔴 Event stream error: \(error?.localizedDescription ?? "Unknown")")
            self?.isConnected = false
            
            // Simple reconnect after 5 seconds
            Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                if let self, !self.isConnected && self.serverManager.isRunning {
                    self.logger.info("🔄 Attempting to reconnect...")
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
        guard let data = event.data?.data(using: .utf8) else {
            logger.debug("🔔 Received empty event")
            return
        }
        
        do {
            let serverEvent = try JSONDecoder().decode(ServerEvent.self, from: data)
            logger.info("📨 Received event: \(serverEvent.type.rawValue)")
            
            switch serverEvent.type {
            case .sessionStart where preferences.sessionStart:
                handleSessionStart(serverEvent)
            case .sessionExit where preferences.sessionExit:
                handleSessionExit(serverEvent)
            case .commandFinished where preferences.commandCompletion:
                handleCommandFinished(serverEvent)
            case .commandError where preferences.commandError:
                handleCommandError(serverEvent)
            case .bell where preferences.bell:
                handleBell(serverEvent)
            case .claudeTurn where preferences.claudeTurn:
                handleClaudeTurn(serverEvent)
            case .connected:
                logger.debug("Received connected event")
            default:
                logger.debug("⚠️ Unhandled or disabled event type: \(serverEvent.type.rawValue)")
            }
        } catch {
            logger.error("🔴 Failed to decode event: \(error)")
        }
    }
    
    // MARK: - Event Handlers
    
    private func handleSessionStart(_ event: ServerEvent) {
        guard let sessionName = event.sessionName,
              let sessionId = event.sessionId else { return }
        
        // Dedup check
        let dedupKey = "session-start-\(sessionId)"
        guard !recentNotifications.contains(dedupKey) else {
            logger.debug("Skipping duplicate notification")
            return
        }
        recentNotifications.insert(dedupKey)
        
        Task {
            try? await Task.sleep(nanoseconds: 5_000_000_000) // 5 seconds
            recentNotifications.remove(dedupKey)
        }
        
        let content = UNMutableNotificationContent()
        content.title = "Session Started"
        content.body = sessionName
        content.sound = .default
        content.categoryIdentifier = "SESSION"
        content.userInfo = ["sessionId": sessionId, "type": "session-start"]
        
        deliverNotificationWithAutoDismiss(content, identifier: dedupKey, dismissAfter: 5.0)
    }
    
    private func handleSessionExit(_ event: ServerEvent) {
        guard let sessionName = event.sessionName else { return }
        
        let content = UNMutableNotificationContent()
        content.title = "Session Ended"
        content.body = sessionName
        content.sound = .default
        content.categoryIdentifier = "SESSION"
        
        if let sessionId = event.sessionId {
            content.userInfo = ["sessionId": sessionId, "type": "session-exit"]
        }
        
        if let exitCode = event.exitCode, exitCode != 0 {
            content.subtitle = "Exit code: \(exitCode)"
        }
        
        deliverNotification(content, identifier: "session-exit-\(UUID().uuidString)")
    }
    
    private func handleCommandFinished(_ event: ServerEvent) {
        guard let command = event.command else { return }
        
        let content = UNMutableNotificationContent()
        content.title = "Command Completed"
        content.body = command
        content.sound = .default
        content.categoryIdentifier = "COMMAND"
        
        if let sessionId = event.sessionId {
            content.userInfo = ["sessionId": sessionId, "type": "command-finished"]
        }
        
        if let duration = event.duration {
            let seconds = duration / 1_000
            if seconds > 60 {
                content.subtitle = "Duration: \(seconds / 60)m \(seconds % 60)s"
            } else {
                content.subtitle = "Duration: \(seconds)s"
            }
        }
        
        deliverNotification(content, identifier: "command-\(UUID().uuidString)")
    }
    
    private func handleCommandError(_ event: ServerEvent) {
        guard let command = event.command else { return }
        
        let content = UNMutableNotificationContent()
        content.title = "Command Failed"
        content.body = command
        content.sound = .defaultCritical
        content.categoryIdentifier = "COMMAND"
        
        if let sessionId = event.sessionId {
            content.userInfo = ["sessionId": sessionId, "type": "command-error"]
        }
        
        if let exitCode = event.exitCode {
            content.subtitle = "Exit code: \(exitCode)"
        }
        
        deliverNotification(content, identifier: "command-error-\(UUID().uuidString)")
    }
    
    private func handleBell(_ event: ServerEvent) {
        guard let sessionName = event.sessionName else { return }
        
        let content = UNMutableNotificationContent()
        content.title = "Terminal Bell"
        content.body = sessionName
        content.sound = .default
        content.categoryIdentifier = "BELL"
        
        if let sessionId = event.sessionId {
            content.userInfo = ["sessionId": sessionId, "type": "bell"]
        }
        
        if let processInfo = event.processInfo {
            content.subtitle = processInfo
        }
        
        deliverNotification(content, identifier: "bell-\(UUID().uuidString)")
    }
    
    private func handleClaudeTurn(_ event: ServerEvent) {
        guard let sessionName = event.sessionName else { return }
        
        let content = UNMutableNotificationContent()
        content.title = "Your Turn"
        content.body = "Claude has finished responding"
        content.subtitle = sessionName
        content.sound = .default
        content.categoryIdentifier = "CLAUDE_TURN"
        content.interruptionLevel = .active
        
        if let sessionId = event.sessionId {
            content.userInfo = ["sessionId": sessionId, "type": "claude-turn"]
        }
        
        deliverNotification(content, identifier: "claude-turn-\(UUID().uuidString)")
    }
    
    // MARK: - Notification Delivery
    
    private func deliverNotification(_ content: UNMutableNotificationContent, identifier: String) {
        let request = UNNotificationRequest(identifier: identifier, content: content, trigger: nil)
        
        Task {
            do {
                try await UNUserNotificationCenter.current().add(request)
                logger.info("🔔 Delivered notification: '\(content.title)'")
            } catch {
                logger.error("🔴 Failed to deliver notification: \(error)")
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
                logger.info("🔔 Delivered auto-dismiss notification: '\(content.title)' (dismiss in \(seconds)s)")
                
                // Schedule automatic dismissal
                try await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
                
                // Remove the notification
                UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [identifier])
                logger.debug("🔔 Auto-dismissed notification: \(identifier)")
            } catch {
                logger.error("🔴 Failed to deliver auto-dismiss notification: \(error)")
            }
        }
    }
    
    private func showTestNotification() {
        let content = UNMutableNotificationContent()
        content.title = "VibeTunnel Notifications"
        content.body = "Notifications are now enabled! You'll receive alerts for terminal events."
        content.sound = .default
        
        deliverNotification(content, identifier: "test-\(UUID().uuidString)")
    }
    
    private func openNotificationSettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension") {
            NSWorkspace.shared.open(url)
        }
    }
}

// MARK: - UNUserNotificationCenterDelegate

extension NotificationService: UNUserNotificationCenterDelegate {
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let userInfo = response.notification.request.content.userInfo
        
        if let sessionId = userInfo["sessionId"] as? String {
            // Post notification to open terminal session
            Task { @MainActor in
                NotificationCenter.default.post(
                    name: .openTerminalSession,
                    object: nil,
                    userInfo: [
                        "sessionId": sessionId,
                        "action": "focus" // Focus the specific terminal tab
                    ]
                )
            }
        }
        
        completionHandler()
    }
    
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        // Show notifications even when app is in foreground
        completionHandler([.banner, .sound])
    }
}

// MARK: - EventSource

/// Simple Server-Sent Events client (only used from MainActor context)
@MainActor
private final class EventSource: NSObject {
    private let url: URL
    private var session: URLSession?
    private var task: URLSessionDataTask?
    private var headers: [String: String] = [:]
    private var buffer = ""
    
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
        
        // Use nil for delegateQueue to use a background queue, avoiding main thread blocking
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
    
}

// MARK: - URLSessionDataDelegate

extension EventSource: URLSessionDataDelegate {
    nonisolated func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        if let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 {
            Task { @MainActor in
                self.onOpen?()
            }
            completionHandler(.allow)
        } else {
            completionHandler(.cancel)
            Task { @MainActor in
                self.onError?(nil)
            }
        }
    }
    
    nonisolated func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard let text = String(data: data, encoding: .utf8) else { return }
        
        // Process on background queue to avoid blocking
        Task { @MainActor in
            self.buffer += text
            
            // Process complete events
            let lines = self.buffer.components(separatedBy: "\n")
            self.buffer = lines.last ?? ""
            
            var currentEvent = Event(id: nil, event: nil, data: nil)
            var dataLines: [String] = []
            
            for line in lines.dropLast() {
                if line.isEmpty {
                    // End of event
                    if !dataLines.isEmpty {
                        let data = dataLines.joined(separator: "\n")
                        let event = Event(id: currentEvent.id, event: currentEvent.event, data: data)
                        self.onMessage?(event)
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
    }
    
    nonisolated func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        Task { @MainActor in
            self.onError?(error)
        }
    }
}

// MARK: - Notification Names

extension Notification.Name {
    static let serverStateChanged = Notification.Name("serverStateChanged")
    static let openTerminalSession = Notification.Name("openTerminalSession")
}

// MARK: - API Sync

extension NotificationService {
    /// Sync preferences from the API
    private func syncPreferencesFromAPI() async {
        guard serverManager.isRunning else { return }
        
        let port = serverManager.port
        guard let url = URL(string: "http://localhost:\(port)/api/preferences/notifications") else {
            return
        }
        
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            if let json = try JSONSerialization.jsonObject(with: data) as? [String: Bool] {
                // Map API preferences to our format
                var prefs = NotificationPreferences()
                prefs.sessionStart = json["sessionStart"] ?? true
                prefs.sessionExit = json["sessionExit"] ?? true
                prefs.commandCompletion = json["commandNotifications"] ?? true
                prefs.commandError = json["sessionError"] ?? true
                prefs.bell = json["systemAlerts"] ?? true
                prefs.claudeTurn = json["claudeTurn"] ?? true
                
                // Update local preferences
                self.preferences = prefs
                prefs.save()
                
                logger.info("Synced notification preferences from API")
            }
        } catch {
            logger.debug("Failed to sync preferences from API: \(error)")
            // Not critical - we have local defaults
        }
    }
    
    /// Sync preferences to the API
    private func syncPreferencesToAPI(_ prefs: NotificationPreferences) async {
        guard serverManager.isRunning else { return }
        
        let port = serverManager.port
        guard let url = URL(string: "http://localhost:\(port)/api/preferences/notifications") else {
            return
        }
        
        // Map our preferences to API format
        let apiPrefs: [String: Any] = [
            "enabled": true, // Always true for native notifications
            "sessionStart": prefs.sessionStart,
            "sessionExit": prefs.sessionExit,
            "commandNotifications": prefs.commandCompletion,
            "sessionError": prefs.commandError,
            "systemAlerts": prefs.bell,
            "claudeTurn": prefs.claudeTurn,
            "soundEnabled": true,
            "vibrationEnabled": false
        ]
        
        do {
            let jsonData = try JSONSerialization.data(withJSONObject: apiPrefs)
            var request = URLRequest(url: url)
            request.httpMethod = "PUT"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = jsonData

            let (_, _) = try await URLSession.shared.data(for: request)
            logger.info("Synced notification preferences to API")
        } catch {
            logger.error("Failed to sync preferences to API: \(error)")
            // Not critical - changes are saved locally
        }
    }
}
