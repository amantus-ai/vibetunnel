import Observation
import SwiftUI

/// Manages live terminal preview subscriptions for session cards.
///
/// This service efficiently handles multiple WebSocket subscriptions
/// for terminal previews, with automatic cleanup and performance optimization.
@MainActor
@Observable
final class LivePreviewManager {
    static let shared = LivePreviewManager()

    private let logger = Logger(category: "LivePreviewManager")
    private let bufferClient = BufferWebSocketClient.shared
    private var subscriptions: [String: LivePreviewSubscription] = [:]
    private var updateTimers: [String: Timer] = [:]

    /// Maximum number of concurrent live previews
    private let maxConcurrentPreviews = 6

    /// Update interval for previews (in seconds)
    private let updateInterval: TimeInterval = 1.0

    private init() {
    }

    /// Subscribe to live updates for a session.
    func subscribe(to sessionId: String) -> LivePreviewSubscription {
        // Check if we already have a subscription
        if let existing = subscriptions[sessionId] {
            existing.referenceCount += 1
            return existing
        }

        // Create new subscription
        let subscription = LivePreviewSubscription(sessionId: sessionId)
        subscriptions[sessionId] = subscription

        // Manage concurrent preview limit
        if subscriptions.count > maxConcurrentPreviews {
            // Remove oldest subscriptions that have no references
            let sortedSubs = subscriptions.values
                .filter { $0.referenceCount == 0 }
                .sorted { $0.subscriptionTime < $1.subscriptionTime }

            if let oldest = sortedSubs.first {
                unsubscribe(from: oldest.sessionId)
            }
        }

        // Set up WebSocket subscription with throttling
        var lastUpdateTime: Date = .distantPast
        var pendingSnapshot: BufferSnapshot?

        bufferClient.subscribe(to: sessionId) { [weak self, weak subscription] event in
            guard let self, let subscription else { return }

            Task { @MainActor in
                switch event {
                case .bufferUpdate(let snapshot):
                    // Throttle updates to prevent overwhelming the UI
                    let now = Date()
                    if now.timeIntervalSince(lastUpdateTime) >= self.updateInterval {
                        subscription.latestSnapshot = snapshot
                        subscription.lastUpdate = now
                        lastUpdateTime = now
                        pendingSnapshot = nil
                    } else {
                        // Store pending update
                        pendingSnapshot = snapshot

                        // Schedule delayed update if not already scheduled
                        if self.updateTimers[sessionId] == nil {
                            let timer = Timer
                                .scheduledTimer(withTimeInterval: self.updateInterval, repeats: false) { _ in
                                    Task { @MainActor in
                                        if let pending = pendingSnapshot {
                                            subscription.latestSnapshot = pending
                                            subscription.lastUpdate = Date()
                                            pendingSnapshot = nil
                                        }
                                        self.updateTimers.removeValue(forKey: sessionId)
                                    }
                                }
                            self.updateTimers[sessionId] = timer
                        }
                    }

                case .exit:
                    subscription.isSessionActive = false

                default:
                    break
                }
            }
        }

        return subscription
    }

    /// Unsubscribe from a session's live updates.
    func unsubscribe(from sessionId: String) {
        guard let subscription = subscriptions[sessionId] else { return }

        subscription.referenceCount -= 1

        if subscription.referenceCount <= 0 {
            // Clean up
            updateTimers[sessionId]?.invalidate()
            updateTimers.removeValue(forKey: sessionId)
            bufferClient.unsubscribe(from: sessionId)
            subscriptions.removeValue(forKey: sessionId)

            logger.debug("Unsubscribed from session: \(sessionId)")
        }
    }

    /// Clean up all subscriptions.
    func cleanup() {
        for timer in updateTimers.values {
            timer.invalidate()
        }
        updateTimers.removeAll()

        for sessionId in subscriptions.keys {
            bufferClient.unsubscribe(from: sessionId)
        }
        subscriptions.removeAll()
    }
}

/// Represents a live preview subscription for a terminal session.
@MainActor
@Observable
final class LivePreviewSubscription {
    let sessionId: String
    let subscriptionTime = Date()

    var latestSnapshot: BufferSnapshot?
    var lastUpdate = Date()
    var isSessionActive = true
    var referenceCount = 1

    init(sessionId: String) {
        self.sessionId = sessionId
    }
}

/// SwiftUI view modifier for managing live preview subscriptions.
struct LivePreviewModifier: ViewModifier {
    let sessionId: String
    let isEnabled: Bool

    @State private var subscription: LivePreviewSubscription?

    func body(content: Content) -> some View {
        content
            .onAppear {
                if isEnabled {
                    subscription = LivePreviewManager.shared.subscribe(to: sessionId)
                }
            }
            .onDisappear {
                if let _ = subscription {
                    LivePreviewManager.shared.unsubscribe(from: sessionId)
                    subscription = nil
                }
            }
            .environment(\.livePreviewSubscription, subscription)
    }
}

/// Environment key for passing subscription down the view hierarchy
private struct LivePreviewSubscriptionKey: EnvironmentKey {
    static let defaultValue: LivePreviewSubscription? = nil
}

extension EnvironmentValues {
    var livePreviewSubscription: LivePreviewSubscription? {
        get { self[LivePreviewSubscriptionKey.self] }
        set { self[LivePreviewSubscriptionKey.self] = newValue }
    }
}

extension View {
    /// Enables live preview for a session.
    func livePreview(for sessionId: String, enabled: Bool = true) -> some View {
        modifier(LivePreviewModifier(sessionId: sessionId, isEnabled: enabled))
    }
}
