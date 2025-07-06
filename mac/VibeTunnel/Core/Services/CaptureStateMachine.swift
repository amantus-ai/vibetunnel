import Foundation
import OSLog

/// States for the capture lifecycle
enum CaptureState: String, CustomStringConvertible {
    case idle = "idle"
    case connecting = "connecting"
    case ready = "ready"
    case starting = "starting"
    case capturing = "capturing"
    case stopping = "stopping"
    case error = "error"
    case reconnecting = "reconnecting"

    var description: String { rawValue }
}

/// Events that can trigger state transitions
enum CaptureEvent {
    case connect
    case connectionEstablished
    case connectionFailed(Error)
    case startCapture(mode: ScreencapService.CaptureMode, useWebRTC: Bool)
    case captureStarted
    case captureFailure(Error)
    case stopCapture
    case captureStopped
    case displayChanged
    case errorRecovered
    case disconnect
}

/// Capture state machine managing the lifecycle of screen capture
@MainActor
final class CaptureStateMachine {
    private let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "CaptureStateMachine")

    /// Current state
    private(set) var currentState: CaptureState = .idle

    /// Previous state (for debugging and recovery)
    private(set) var previousState: CaptureState?

    /// Error if in error state
    private(set) var lastError: Error?

    /// Capture configuration
    private(set) var captureMode: ScreencapService.CaptureMode?
    private(set) var useWebRTC: Bool = false

    /// State change callback
    var onStateChange: ((CaptureState, CaptureState?) -> Void)?

    /// Initialize the state machine
    init() {
        logger.info("🎯 Capture state machine initialized")
    }

    /// Process an event and transition states
    @discardableResult
    func processEvent(_ event: CaptureEvent) -> Bool {
        let fromState = currentState
        let validTransition = transition(from: fromState, event: event)

        if validTransition {
            logger.info("✅ State transition: \(fromState) → \(self.currentState) (event: \(String(describing: event)))")
            onStateChange?(currentState, previousState)
        } else {
            logger.warning("⚠️ Invalid transition: \(fromState) with event \(String(describing: event))")
        }

        return validTransition
    }

    /// Perform state transition based on current state and event
    private func transition(from state: CaptureState, event: CaptureEvent) -> Bool {
        switch (state, event) {
        // From idle state
        case (.idle, .connect):
            setState(.connecting)
            return true

        // From connecting state
        case (.connecting, .connectionEstablished):
            setState(.ready)
            lastError = nil
            return true

        case (.connecting, .connectionFailed(let error)):
            setState(.error)
            lastError = error
            return true

        // From ready state
        case (.ready, .startCapture(let mode, let webRTC)):
            setState(.starting)
            captureMode = mode
            useWebRTC = webRTC
            return true

        case (.ready, .disconnect):
            setState(.idle)
            return true

        // From starting state
        case (.starting, .captureStarted):
            setState(.capturing)
            return true

        case (.starting, .captureFailure(let error)):
            setState(.error)
            lastError = error
            return true

        // From capturing state
        case (.capturing, .stopCapture):
            setState(.stopping)
            return true

        case (.capturing, .displayChanged):
            setState(.reconnecting)
            return true

        case (.capturing, .connectionFailed(let error)):
            setState(.error)
            lastError = error
            return true

        // From stopping state
        case (.stopping, .captureStopped):
            setState(.ready)
            captureMode = nil
            return true

        case (.stopping, .disconnect):
            setState(.idle)
            captureMode = nil
            return true

        // From error state
        case (.error, .errorRecovered):
            setState(.ready)
            lastError = nil
            return true

        case (.error, .disconnect):
            setState(.idle)
            lastError = nil
            return true

        // From reconnecting state
        case (.reconnecting, .captureStarted):
            setState(.capturing)
            return true

        case (.reconnecting, .captureFailure(let error)):
            setState(.error)
            lastError = error
            return true

        // Invalid transitions
        default:
            return false
        }
    }

    /// Update state and track previous state
    private func setState(_ newState: CaptureState) {
        previousState = currentState
        currentState = newState
    }

    /// Check if a specific action is allowed in current state
    func canPerformAction(_ action: CaptureAction) -> Bool {
        switch (currentState, action) {
        case (.idle, .connect):
            true
        case (.ready, .startCapture):
            true
        case (.ready, .disconnect):
            true
        case (.capturing, .stopCapture):
            true
        case (.error, .recover):
            true
        case (.error, .disconnect):
            true
        default:
            false
        }
    }

    /// Get human-readable description of current state
    func stateDescription() -> String {
        switch currentState {
        case .idle:
            return "Not connected"
        case .connecting:
            return "Connecting..."
        case .ready:
            return "Ready to capture"
        case .starting:
            return "Starting capture..."
        case .capturing:
            if let mode = captureMode {
                switch mode {
                case .desktop(let index):
                    return index == -1 ? "Capturing all displays" : "Capturing display \(index)"
                case .window:
                    return "Capturing window"
                case .allDisplays:
                    return "Capturing all displays"
                case .application:
                    return "Capturing application"
                }
            }
            return "Capturing"
        case .stopping:
            return "Stopping capture..."
        case .error:
            return "Error: \(lastError?.localizedDescription ?? "Unknown")"
        case .reconnecting:
            return "Reconnecting..."
        }
    }

    /// Reset to initial state
    func reset() {
        logger.info("🔄 Resetting state machine")
        previousState = currentState
        currentState = .idle
        captureMode = nil
        useWebRTC = false
        lastError = nil
        onStateChange?(currentState, previousState)
    }
}

/// Actions that can be performed
enum CaptureAction {
    case connect
    case startCapture
    case stopCapture
    case recover
    case disconnect
}
