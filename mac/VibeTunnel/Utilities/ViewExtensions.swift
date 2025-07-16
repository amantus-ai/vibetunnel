import SwiftUI

/// View extensions for common functionality
extension View {
    /// Adds a periodic timer that executes an async action at regular intervals.
    ///
    /// This modifier automatically handles timer lifecycle, cleanup, and proper
    /// async task management. The timer is automatically invalidated when the
    /// view disappears.
    ///
    /// - Parameters:
    ///   - interval: The time interval between timer fires
    ///   - tolerance: The tolerance for timer accuracy (default: 0.1 seconds)
    ///   - action: The async action to execute on each timer fire
    /// - Returns: A view with the periodic timer attached
    func withPeriodicTimer(
        interval: TimeInterval,
        tolerance: TimeInterval = 0.1,
        action: @escaping @Sendable () async -> Void
    ) -> some View {
        modifier(PeriodicTimerModifier(interval: interval, tolerance: tolerance, action: action))
    }
}

/// ViewModifier that manages a periodic timer with proper cleanup
private struct PeriodicTimerModifier: ViewModifier {
    let interval: TimeInterval
    let tolerance: TimeInterval
    let action: @Sendable () async -> Void
    
    @State private var timer: Timer?
    
    func body(content: Content) -> some View {
        content
            .onAppear {
                startTimer()
            }
            .onDisappear {
                stopTimer()
            }
    }
    
    private func startTimer() {
        // Execute immediately
        Task {
            await action()
        }
        
        // Then set up periodic execution
        timer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { _ in
            Task {
                await action()
            }
        }
        timer?.tolerance = tolerance
    }
    
    private func stopTimer() {
        timer?.invalidate()
        timer = nil
    }
}