import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
import OSLog

/// Handles all input event operations for screen capture service
/// This includes mouse events (click, down, up, move) and keyboard events
@MainActor
public final class InputEventCoordinator {
    private let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "InputEventCoordinator")

    // MARK: - Error Types

    public enum InputError: LocalizedError {
        case accessibilityPermissionDenied
        case failedToCreateEvent
        case invalidCoordinates(x: Double, y: Double)
        case invalidKeyInput(String)

        public var errorDescription: String? {
            switch self {
            case .accessibilityPermissionDenied:
                "Accessibility permission not granted. Please grant Accessibility permission in System Settings > Privacy & Security > Accessibility"
            case .failedToCreateEvent:
                "Failed to create input event"
            case .invalidCoordinates(let x, let y):
                "Invalid coordinates: (\(x), \(y)) - must be in range 0-1000"
            case .invalidKeyInput(let key):
                "Invalid key input: '\(key)' - must be non-empty and <= 20 characters"
            }
        }
    }

    // MARK: - Public Methods

    /// Check if accessibility permission is granted
    public func hasAccessibilityPermission() -> Bool {
        let hasPermission = AXIsProcessTrusted()
        logger.info("🔐 Accessibility permission status: \(hasPermission)")
        return hasPermission
    }

    /// Send click at specified location
    /// - Parameters:
    ///   - location: The target location in screen coordinates
    ///   - useWarpCursor: Whether to use CGWarpMouseCursorPosition for cursor movement
    public func sendClick(at location: CGPoint, useWarpCursor: Bool = false) async throws {
        // Check accessibility permission first
        guard hasAccessibilityPermission() else {
            logger.error("❌ Cannot send mouse click - Accessibility permission not granted")
            throw InputError.accessibilityPermissionDenied
        }

        // Security audit log
        let timestamp = Date().timeIntervalSince1970
        logger.info("🔒 [AUDIT] Click event at \(timestamp): location=(\(location.x), \(location.y))")

        // Create an event source for better compatibility
        let eventSource = CGEventSource(stateID: .hidSystemState)

        // First move the mouse cursor to the target position
        logger.info("🖱️ Moving mouse cursor to position before clicking...")

        if useWarpCursor {
            logger.info("🖱️ Using CGWarpMouseCursorPosition to move cursor")
            let warpResult = CGWarpMouseCursorPosition(location)
            if warpResult != .success {
                logger.error("❌ CGWarpMouseCursorPosition failed with error: \(warpResult.rawValue)")
                // Fall back to CGEvent method
                try await moveCursor(to: location, eventSource: eventSource)
            }
        } else {
            // Use traditional CGEvent method
            try await moveCursor(to: location, eventSource: eventSource)
        }

        // Small delay to ensure the move is processed
        try await Task.sleep(nanoseconds: 10_000_000) // 10ms delay

        // Verify the mouse actually moved
        let newMouseLocation = NSEvent.mouseLocation
        logger
            .info(
                "🖱️ Mouse position after move: (\(String(format: "%.1f", newMouseLocation.x)), \(String(format: "%.1f", newMouseLocation.y)))"
            )

        // Create mouse down event
        guard let mouseDown = CGEvent(
            mouseEventSource: eventSource,
            mouseType: .leftMouseDown,
            mouseCursorPosition: location,
            mouseButton: .left
        ) else {
            throw InputError.failedToCreateEvent
        }

        // Create mouse up event
        guard let mouseUp = CGEvent(
            mouseEventSource: eventSource,
            mouseType: .leftMouseUp,
            mouseCursorPosition: location,
            mouseButton: .left
        ) else {
            throw InputError.failedToCreateEvent
        }

        // Set the click count to 1 for both events
        mouseDown.setIntegerValueField(.mouseEventClickState, value: 1)
        mouseUp.setIntegerValueField(.mouseEventClickState, value: 1)

        // Post events
        mouseDown.post(tap: .cghidEventTap)
        try await Task.sleep(nanoseconds: 50_000_000) // 50ms delay
        mouseUp.post(tap: .cghidEventTap)

        logger.info("✅ Click sent successfully")
    }

    /// Send mouse down event at specified location
    public func sendMouseDown(at location: CGPoint) async throws {
        guard hasAccessibilityPermission() else {
            throw InputError.accessibilityPermissionDenied
        }

        // Security audit log
        let timestamp = Date().timeIntervalSince1970
        logger.info("🔒 [AUDIT] Mouse down event at \(timestamp): location=(\(location.x), \(location.y))")

        // Create an event source for better compatibility
        let eventSource = CGEventSource(stateID: .hidSystemState)

        // Create mouse down event
        guard let mouseDown = CGEvent(
            mouseEventSource: eventSource,
            mouseType: .leftMouseDown,
            mouseCursorPosition: location,
            mouseButton: .left
        ) else {
            throw InputError.failedToCreateEvent
        }

        // Set the click state
        mouseDown.setIntegerValueField(.mouseEventClickState, value: 1)

        // Post event
        mouseDown.post(tap: .cghidEventTap)

        logger.info("✅ Mouse down sent successfully")
    }

    /// Send mouse move (drag) event at specified location
    public func sendMouseMove(to location: CGPoint) async throws {
        guard hasAccessibilityPermission() else {
            throw InputError.accessibilityPermissionDenied
        }

        // Create an event source for better compatibility
        let eventSource = CGEventSource(stateID: .hidSystemState)

        // Create mouse dragged event
        guard let mouseDrag = CGEvent(
            mouseEventSource: eventSource,
            mouseType: .leftMouseDragged,
            mouseCursorPosition: location,
            mouseButton: .left
        ) else {
            throw InputError.failedToCreateEvent
        }

        // Post event
        mouseDrag.post(tap: .cghidEventTap)
    }

    /// Send mouse up event at specified location
    public func sendMouseUp(at location: CGPoint) async throws {
        guard hasAccessibilityPermission() else {
            throw InputError.accessibilityPermissionDenied
        }

        // Security audit log
        let timestamp = Date().timeIntervalSince1970
        logger.info("🔒 [AUDIT] Mouse up event at \(timestamp): location=(\(location.x), \(location.y))")

        // Create an event source for better compatibility
        let eventSource = CGEventSource(stateID: .hidSystemState)

        // Create mouse up event
        guard let mouseUp = CGEvent(
            mouseEventSource: eventSource,
            mouseType: .leftMouseUp,
            mouseCursorPosition: location,
            mouseButton: .left
        ) else {
            throw InputError.failedToCreateEvent
        }

        // Set the click state
        mouseUp.setIntegerValueField(.mouseEventClickState, value: 1)

        // Post event
        mouseUp.post(tap: .cghidEventTap)

        logger.info("✅ Mouse up sent successfully")
    }

    /// Send keyboard input
    /// - Parameters:
    ///   - key: The key to send
    ///   - modifiers: Modifier keys to apply
    public func sendKey(
        _ key: String,
        modifiers: KeyModifiers = KeyModifiers()
    )
        async throws
    {
        guard hasAccessibilityPermission() else {
            throw InputError.accessibilityPermissionDenied
        }

        // Validate key input
        guard !key.isEmpty && key.count <= 20 else {
            logger.error("⚠️ Invalid key input: '\(key)' - must be non-empty and <= 20 characters")
            throw InputError.invalidKeyInput(key)
        }

        // Security audit log
        let timestamp = Date().timeIntervalSince1970
        logger.info("🔒 [AUDIT] Key event at \(timestamp): key='\(key)', modifiers=\(modifiers)")

        // Convert key string to key code
        let keyCode = keyStringToKeyCode(key)

        // Create key down event
        guard let keyDown = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: true) else {
            throw InputError.failedToCreateEvent
        }

        // Create key up event
        guard let keyUp = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: false) else {
            throw InputError.failedToCreateEvent
        }

        // Set modifier flags
        var flags: CGEventFlags = []
        if modifiers.command { flags.insert(.maskCommand) }
        if modifiers.control { flags.insert(.maskControl) }
        if modifiers.option { flags.insert(.maskAlternate) }
        if modifiers.shift { flags.insert(.maskShift) }

        keyDown.flags = flags
        keyUp.flags = flags

        // Post events
        keyDown.post(tap: .cghidEventTap)
        try await Task.sleep(nanoseconds: 50_000_000) // 50ms delay
        keyUp.post(tap: .cghidEventTap)

        logger.info("✅ Sent key: \(key) with modifiers")
    }

    // MARK: - Key Modifiers

    /// Represents keyboard modifier keys
    public struct KeyModifiers: CustomStringConvertible {
        public var command: Bool = false
        public var control: Bool = false
        public var option: Bool = false
        public var shift: Bool = false

        public init(
            command: Bool = false,
            control: Bool = false,
            option: Bool = false,
            shift: Bool = false
        ) {
            self.command = command
            self.control = control
            self.option = option
            self.shift = shift
        }

        public var description: String {
            var modifiers: [String] = []
            if command { modifiers.append("cmd") }
            if control { modifiers.append("ctrl") }
            if option { modifiers.append("alt") }
            if shift { modifiers.append("shift") }
            return "[" + modifiers.joined(separator: ", ") + "]"
        }
    }

    // MARK: - Private Methods

    /// Move cursor to specified location
    private func moveCursor(to location: CGPoint, eventSource: CGEventSource?) async throws {
        guard let mouseMove = CGEvent(
            mouseEventSource: eventSource,
            mouseType: .mouseMoved,
            mouseCursorPosition: location,
            mouseButton: .left
        ) else {
            throw InputError.failedToCreateEvent
        }

        // Post the mouse move event
        mouseMove.post(tap: .cghidEventTap)
    }

    /// Convert key string to key code
    /// - Parameter key: The key string to convert
    /// - Returns: The corresponding CGKeyCode
    private func keyStringToKeyCode(_ key: String) -> CGKeyCode {
        // Basic key mapping - this should be expanded
        switch key.lowercased() {
        case "a": 0x00
        case "s": 0x01
        case "d": 0x02
        case "f": 0x03
        case "h": 0x04
        case "g": 0x05
        case "z": 0x06
        case "x": 0x07
        case "c": 0x08
        case "v": 0x09
        case "b": 0x0B
        case "q": 0x0C
        case "w": 0x0D
        case "e": 0x0E
        case "r": 0x0F
        case "y": 0x10
        case "t": 0x11
        case "1": 0x12
        case "2": 0x13
        case "3": 0x14
        case "4": 0x15
        case "6": 0x16
        case "5": 0x17
        case "=": 0x18
        case "9": 0x19
        case "7": 0x1A
        case "-": 0x1B
        case "8": 0x1C
        case "0": 0x1D
        case "]": 0x1E
        case "o": 0x1F
        case "u": 0x20
        case "[": 0x21
        case "i": 0x22
        case "p": 0x23
        case "l": 0x25
        case "j": 0x26
        case "'": 0x27
        case "k": 0x28
        case ";": 0x29
        case "\\": 0x2A
        case ",": 0x2B
        case "/": 0x2C
        case "n": 0x2D
        case "m": 0x2E
        case ".": 0x2F
        case " ", "space": 0x31
        case "enter", "return": 0x24
        case "tab": 0x30
        case "escape", "esc": 0x35
        case "backspace", "delete": 0x33
        case "arrowup", "up": 0x7E
        case "arrowdown", "down": 0x7D
        case "arrowleft", "left": 0x7B
        case "arrowright", "right": 0x7C
        default: 0x00 // Default to 'a'
        }
    }
}
