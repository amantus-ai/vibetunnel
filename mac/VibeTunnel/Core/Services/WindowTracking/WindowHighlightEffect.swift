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
    static let `default` = WindowHighlightConfig(
        color: NSColor(red: 0.0, green: 1.0, blue: 0.0, alpha: 1.0), // Green to match frontend
        duration: 0.8,
        borderWidth: 4.0,
        glowRadius: 12.0,
        isEnabled: true
    )
    
    /// A more subtle configuration
    static let subtle = WindowHighlightConfig(
        color: .systemBlue,
        duration: 0.5,
        borderWidth: 2.0,
        glowRadius: 6.0,
        isEnabled: true
    )
    
    /// A vibrant neon-style configuration
    static let neon = WindowHighlightConfig(
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
    
    /// Highlight a window with a border pulse effect
    func highlightWindow(_ window: AXUIElement, bounds: CGRect? = nil) {
        guard config.isEnabled else { return }
        
        let windowFrame: CGRect
        
        if let bounds = bounds {
            // Use provided bounds
            windowFrame = bounds
        } else {
            // Get window bounds from AXUIElement
            var positionRef: CFTypeRef?
            var sizeRef: CFTypeRef?
            
            guard AXUIElementCopyAttributeValue(window, kAXPositionAttribute as CFString, &positionRef) == .success,
                  AXUIElementCopyAttributeValue(window, kAXSizeAttribute as CFString, &sizeRef) == .success,
                  let positionValue = positionRef as! AXValue?,
                  let sizeValue = sizeRef as! AXValue? else {
                logger.error("Failed to get window bounds for highlight effect")
                return
            }
            
            var position = CGPoint.zero
            var size = CGSize.zero
            AXValueGetValue(positionValue, .cgPoint, &position)
            AXValueGetValue(sizeValue, .cgSize, &size)
            windowFrame = CGRect(origin: position, size: size)
        }
        
        // Create overlay window
        let overlayWindow = createOverlayWindow(
            frame: windowFrame
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