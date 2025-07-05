import AppKit
import Foundation
import OSLog

/// Configuration for window highlight effects
struct WindowHighlightConfig {
    /// The color of the highlight border
    let color: NSColor

    /// Duration of the pulse animation in seconds
    let duration: TimeInterval

    /// Width of the border stroke
    let borderWidth: CGFloat

    /// Radius of the glow effect
    let glowRadius: CGFloat

    /// Whether the effect is enabled
    let isEnabled: Bool

    /// Default configuration with VibeTunnel branding
    static let `default` = Self(
        color: NSColor(red: 0.0, green: 1.0, blue: 0.0, alpha: 1.0), // Green to match frontend
        duration: 0.8,
        borderWidth: 4.0,
        glowRadius: 12.0,
        isEnabled: true
    )

    /// A more subtle configuration
    static let subtle = Self(
        color: .systemBlue,
        duration: 0.5,
        borderWidth: 2.0,
        glowRadius: 6.0,
        isEnabled: true
    )

    /// A vibrant neon-style configuration
    static let neon = Self(
        color: NSColor(red: 0.0, green: 1.0, blue: 0.8, alpha: 1.0), // Cyan
        duration: 1.2,
        borderWidth: 6.0,
        glowRadius: 20.0,
        isEnabled: true
    )
}

/// Provides visual highlighting effects for terminal windows.
/// Creates a border pulse/glow effect to make window selection more noticeable.
@MainActor
final class WindowHighlightEffect {
    private let logger = Logger(
        subsystem: "sh.vibetunnel.vibetunnel",
        category: "WindowHighlightEffect"
    )

    /// Active overlay windows for effects
    private var overlayWindows: [NSWindow] = []

    /// Current configuration
    private var config: WindowHighlightConfig = .default

    /// Initialize with a specific configuration
    init(config: WindowHighlightConfig = .default) {
        self.config = config
    }

    /// Update the configuration
    func updateConfig(_ newConfig: WindowHighlightConfig) {
        self.config = newConfig
    }

    /// Converts screen coordinates (top-left origin) to Cocoa coordinates (bottom-left origin)
    /// This is necessary because:
    /// - Accessibility API returns coordinates with origin at screen top-left
    /// - NSWindow expects coordinates with origin at screen bottom-left
    /// - Multiple displays complicate this further
    private func convertScreenToCocoaCoordinates(_ screenFrame: CGRect) -> CGRect {
        // The key insight: NSScreen coordinates are ALREADY in Cocoa coordinates (bottom-left origin)
        // But the window bounds we get from Accessibility API are in screen coordinates (top-left origin)

        // First, we need to find the total screen height across all displays
        let screens = NSScreen.screens
        guard let mainScreen = NSScreen.main else {
            logger.error("No main screen found")
            return screenFrame
        }

        // Find which screen contains this window by checking in screen coordinates
        var targetScreen: NSScreen?
        let windowCenter = CGPoint(x: screenFrame.midX, y: screenFrame.midY)

        for screen in screens {
            // Convert screen's Cocoa frame to screen coordinates for comparison
            let screenFrameInScreenCoords = convertCocoaToScreenRect(
                screen.frame,
                mainScreenHeight: mainScreen.frame.height
            )

            if screenFrameInScreenCoords.contains(windowCenter) {
                targetScreen = screen
                break
            }
        }

        // Use the screen we found, or main screen as fallback
        let screen = targetScreen ?? mainScreen

        logger.debug("Screen info for coordinate conversion:")
        logger
            .debug(
                "  Target screen frame (Cocoa): x=\(screen.frame.origin.x), y=\(screen.frame.origin.y), w=\(screen.frame.width), h=\(screen.frame.height)"
            )
        logger
            .debug(
                "  Window frame (screen coords): x=\(screenFrame.origin.x), y=\(screenFrame.origin.y), w=\(screenFrame.width), h=\(screenFrame.height)"
            )
        logger.debug("  Window center: x=\(windowCenter.x), y=\(windowCenter.y)")
        logger.debug("  Is main screen: \(screen == NSScreen.main)")

        // Convert window coordinates from screen (top-left) to Cocoa (bottom-left)
        // The key is that we need to use the main screen's height as reference
        let mainScreenHeight = mainScreen.frame.height

        // In screen coordinates, y=0 is at the top of the main screen
        // In Cocoa coordinates, y=0 is at the bottom of the main screen
        // So: cocoaY = mainScreenHeight - (screenY + windowHeight)
        let cocoaY = mainScreenHeight - (screenFrame.origin.y + screenFrame.height)

        return CGRect(
            x: screenFrame.origin.x,
            y: cocoaY,
            width: screenFrame.width,
            height: screenFrame.height
        )
    }

    /// Helper to convert Cocoa rect to screen coordinates for comparison
    private func convertCocoaToScreenRect(_ cocoaRect: CGRect, mainScreenHeight: CGFloat) -> CGRect {
        // Convert from bottom-left origin to top-left origin
        let screenY = mainScreenHeight - (cocoaRect.origin.y + cocoaRect.height)
        return CGRect(
            x: cocoaRect.origin.x,
            y: screenY,
            width: cocoaRect.width,
            height: cocoaRect.height
        )
    }

    /// Highlight a window with a border pulse effect
    func highlightWindow(_ window: AXElement, bounds: CGRect? = nil) {
        guard config.isEnabled else { return }

        let windowFrame: CGRect

        if let bounds {
            // Use provided bounds
            windowFrame = bounds
        } else {
            // Get window bounds using AXElement
            guard let frame = window.frame() else {
                logger.error("Failed to get window bounds for highlight effect")
                return
            }
            windowFrame = frame
        }

        // Convert from screen coordinates (top-left origin) to Cocoa coordinates (bottom-left origin)
        let cocoaFrame = convertScreenToCocoaCoordinates(windowFrame)

        logger.debug("Window highlight coordinate conversion:")
        logger
            .debug(
                "  Original frame: x=\(windowFrame.origin.x), y=\(windowFrame.origin.y), w=\(windowFrame.width), h=\(windowFrame.height)"
            )
        logger
            .debug(
                "  Cocoa frame: x=\(cocoaFrame.origin.x), y=\(cocoaFrame.origin.y), w=\(cocoaFrame.width), h=\(cocoaFrame.height)"
            )

        // Create overlay window
        let overlayWindow = createOverlayWindow(
            frame: cocoaFrame
        )

        // Add to tracking
        overlayWindows.append(overlayWindow)

        // Show the window
        overlayWindow.orderFront(nil)

        // Animate the pulse effect
        animatePulse(on: overlayWindow, duration: config.duration) { [weak self] in
            Task { @MainActor in
                self?.removeOverlay(overlayWindow)
            }
        }
    }

    /// Create an overlay window for the effect
    private func createOverlayWindow(frame: CGRect) -> NSWindow {
        let window = NSWindow(
            contentRect: frame,
            styleMask: .borderless,
            backing: .buffered,
            defer: false
        )

        window.backgroundColor = .clear
        window.isOpaque = false
        window.level = .screenSaver
        window.ignoresMouseEvents = true
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]

        // Create custom view for the effect
        let effectView = BorderEffectView(
            frame: window.contentView!.bounds,
            color: config.color,
            borderWidth: config.borderWidth,
            glowRadius: config.glowRadius
        )
        effectView.autoresizingMask = [.width, .height]
        window.contentView = effectView

        return window
    }

    /// Animate the pulse effect
    private func animatePulse(on window: NSWindow, duration: TimeInterval, completion: @escaping @Sendable () -> Void) {
        guard let effectView = window.contentView as? BorderEffectView else { return }

        NSAnimationContext.runAnimationGroup { context in
            context.duration = duration
            context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)

            // Animate from full opacity to transparent
            effectView.animator().alphaValue = 0.0
        } completionHandler: {
            completion()
        }
    }

    /// Remove an overlay window
    private func removeOverlay(_ window: NSWindow) {
        window.orderOut(nil)
        overlayWindows.removeAll { $0 == window }
    }

    /// Clean up all overlay windows
    func cleanup() {
        for window in overlayWindows {
            window.orderOut(nil)
        }
        overlayWindows.removeAll()
    }
}

/// Custom view for border effect
private class BorderEffectView: NSView {
    private let borderColor: NSColor
    private let borderWidth: CGFloat
    private let glowRadius: CGFloat

    init(frame: NSRect, color: NSColor, borderWidth: CGFloat, glowRadius: CGFloat) {
        self.borderColor = color
        self.borderWidth = borderWidth
        self.glowRadius = glowRadius
        super.init(frame: frame)
        self.wantsLayer = true
        self.alphaValue = 1.0
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)

        guard let context = NSGraphicsContext.current?.cgContext else { return }

        context.saveGState()

        // Create inset rect for border
        let borderRect = bounds.insetBy(dx: borderWidth / 2, dy: borderWidth / 2)
        let borderPath = NSBezierPath(roundedRect: borderRect, xRadius: 8, yRadius: 8)

        // Draw glow effect
        context.setShadow(
            offset: .zero,
            blur: glowRadius,
            color: borderColor.withAlphaComponent(0.8).cgColor
        )

        // Draw border
        borderColor.setStroke()
        borderPath.lineWidth = borderWidth
        borderPath.stroke()

        // Draw inner glow
        context.setShadow(
            offset: .zero,
            blur: glowRadius / 2,
            color: borderColor.withAlphaComponent(0.4).cgColor
        )
        borderPath.stroke()

        context.restoreGState()
    }
}
