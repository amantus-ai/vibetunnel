import AppKit

/// Helper class for consistent window centering across the application.
///
/// Provides utility methods for positioning windows on screen, including
/// centering on the active display and moving windows off-screen when needed.
/// Used throughout VibeTunnel to ensure consistent window placement behavior.
enum WindowCenteringHelper {
    /// Centers a window on the active screen (where the mouse cursor is located)
    /// - Parameter window: The NSWindow to center
    @MainActor
    static func centerOnActiveScreen(_ window: NSWindow) {
        // Get the screen that contains the mouse cursor
        let mouseLocation = NSEvent.mouseLocation
        let activeScreen = NSScreen.screens.first { screen in
            screen.frame.contains(mouseLocation)
        } ?? NSScreen.main ?? NSScreen.screens.first

        if let screen = activeScreen {
            let screenFrame = screen.visibleFrame
            let windowFrame = window.frame

            let newX = screenFrame.midX - windowFrame.width / 2
            let newY = screenFrame.midY - windowFrame.height / 2

            window.setFrameOrigin(NSPoint(x: newX, y: newY))
        }
    }

    /// Positions a window off-screen (useful for hidden windows)
    /// - Parameter window: The NSWindow to position off-screen
    @MainActor
    static func positionOffScreen(_ window: NSWindow) {
        if let screen = NSScreen.main {
            let screenFrame = screen.frame
            window.setFrame(
                NSRect(x: screenFrame.midX, y: screenFrame.minY - 1000, width: 1, height: 1),
                display: false)
        }
    }

    /// Centers a window using the built-in NSWindow center method
    /// - Parameter window: The NSWindow to center
    @MainActor
    static func centerDefault(_ window: NSWindow) {
        window.center()
    }
}
