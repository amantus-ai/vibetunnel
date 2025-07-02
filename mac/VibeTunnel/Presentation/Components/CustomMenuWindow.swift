import AppKit
import SwiftUI

/// Custom borderless window that appears below the menu bar icon.
///
/// Provides a dropdown-style window for the menu bar application
/// without the standard macOS popover arrow. Handles automatic positioning below
/// the status item, click-outside dismissal, and proper window management.
private enum DesignConstants {
    static let menuCornerRadius: CGFloat = 12
}

@MainActor
final class CustomMenuWindow: NSPanel {
    private var eventMonitor: Any?
    private let hostingController: NSHostingController<AnyView>
    private var retainedContentView: AnyView?
    private var isEventMonitoringActive = false
    private var targetFrame: NSRect?
    private weak var statusBarButton: NSStatusBarButton?
    private var _isWindowVisible = false
    private var frameObserver: Any?
    private var lastBounds: CGRect = .zero
    private var maskLayer: CAShapeLayer?

    /// Tracks whether the new session form is currently active
    var isNewSessionActive = false

    /// Closure to be called when window shows
    var onShow: (() -> Void)?

    /// Closure to be called when window hides
    var onHide: (() -> Void)?

    /// More reliable visibility tracking
    var isWindowVisible: Bool {
        _isWindowVisible
    }

    init(contentView: some View) {
        // Store the content view to prevent deallocation in Release builds
        let wrappedView = AnyView(contentView)
        self.retainedContentView = wrappedView

        // Create content view controller with the wrapped view
        hostingController = NSHostingController(rootView: wrappedView)

        // Initialize window with appropriate style
        super.init(
            contentRect: NSRect(x: 0, y: 0, width: 384, height: 400),
            styleMask: [.borderless, .utilityWindow],
            backing: .buffered,
            defer: false
        )

        // Configure window appearance
        isOpaque = false
        backgroundColor = .clear
        hasShadow = true
        level = .popUpMenu
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient, .ignoresCycle]
        isMovableByWindowBackground = false
        hidesOnDeactivate = false
        isReleasedWhenClosed = false

        // Allow the window to become key but not main
        // This helps maintain button highlight state
        acceptsMouseMovedEvents = false

        // Set content view controller
        contentViewController = hostingController

        // Force the view to load immediately
        _ = hostingController.view

        // Add visual effect background with custom shape
        if let contentView = contentViewController?.view {
            contentView.wantsLayer = true

            // Create a custom mask layer for side-rounded corners
            let maskLayer = CAShapeLayer()
            maskLayer.path = createSideRoundedPath(
                in: contentView.bounds,
                cornerRadius: DesignConstants.menuCornerRadius
            )
            contentView.layer?.mask = maskLayer
            self.maskLayer = maskLayer
            lastBounds = contentView.bounds

            // Update mask when bounds change
            contentView.postsFrameChangedNotifications = true
            self.frameObserver = NotificationCenter.default.addObserver(
                forName: NSView.frameDidChangeNotification,
                object: contentView,
                queue: .main
            ) { [weak self, weak contentView] _ in
                Task { @MainActor in
                    guard let self, let contentView else { return }
                    let currentBounds = contentView.bounds
                    guard currentBounds != self.lastBounds else { return }
                    self.lastBounds = currentBounds
                    self.maskLayer?.path = self.createSideRoundedPath(
                        in: currentBounds,
                        cornerRadius: DesignConstants.menuCornerRadius
                    )
                }
            }

            // Add subtle shadow
            contentView.shadow = NSShadow()
            contentView.shadow?.shadowOffset = NSSize(width: 0, height: -1)
            contentView.shadow?.shadowBlurRadius = 12
            contentView.shadow?.shadowColor = NSColor.black.withAlphaComponent(0.3)
        }
    }

    func show(relativeTo statusItemButton: NSStatusBarButton) {
        // Store button reference (state should already be set by StatusBarMenuManager)
        self.statusBarButton = statusItemButton

        // First, make sure the SwiftUI hierarchy has laid itself out
        hostingController.view.layoutSubtreeIfNeeded()

        // Determine the preferred size based on the content's intrinsic size
        let fittingSize = hostingController.view.fittingSize
        let preferredSize = NSSize(width: fittingSize.width, height: fittingSize.height)

        // Update the panel's content size
        setContentSize(preferredSize)

        // Get status item frame in screen coordinates
        if let statusWindow = statusItemButton.window {
            let buttonBounds = statusItemButton.bounds
            let buttonFrameInWindow = statusItemButton.convert(buttonBounds, to: nil)
            let buttonFrameInScreen = statusWindow.convertToScreen(buttonFrameInWindow)

            // Check if the button frame is valid and visible
            if buttonFrameInScreen.width > 0, buttonFrameInScreen.height > 0 {
                // Calculate optimal position relative to the status bar icon
                let targetFrame = calculateOptimalFrame(
                    relativeTo: buttonFrameInScreen,
                    preferredSize: preferredSize
                )

                // Set frame directly without animation
                setFrame(targetFrame, display: false)

                // Clear target frame since we're not animating
                self.targetFrame = nil
            } else {
                // Fallback: Position at top right of screen
                showAtTopRightFallback(withSize: preferredSize)
                self.targetFrame = nil
            }
        } else {
            // Fallback case
            showAtTopRightFallback(withSize: preferredSize)
            self.targetFrame = nil
        }

        // Ensure the hosting controller's view is loaded
        _ = hostingController.view

        // Display window with animation
        displayWindowWithAnimation()
    }

    private func displayWindowWithAnimation() {
        // Group all visual changes in a single transaction to prevent flicker
        CATransaction.begin()
        CATransaction.setDisableActions(true) // Disable all implicit animations
        CATransaction.setCompletionBlock { [weak self] in
            // Setup event monitoring after all visual changes are complete
            self?.setupEventMonitoring()
        }

        // Set all visual properties at once
        alphaValue = 1.0

        // Button state is managed by StatusBarMenuManager, don't change it here

        // Show window without activating the app aggressively
        // This helps maintain the button's highlight state
        orderFront(nil)
        makeKey()

        // Button state is managed by StatusBarMenuManager

        // Set first responder after window is visible
        makeFirstResponder(self)

        // Force immediate layout of all subviews to prevent delayed rendering
        contentView?.layoutSubtreeIfNeeded()

        // Mark window as visible
        _isWindowVisible = true

        // Commit all changes at once
        CATransaction.commit()

        onShow?()
    }

    private func displayWindowSafely() {
        // This method is now just a fallback for compatibility
        displayWindowWithAnimation()
    }

    private func displayWindowFallback() async {
        NSApp.activate(ignoringOtherApps: true)
        self.makeKeyAndOrderFront(nil)
        self.alphaValue = 1.0 // Set to full opacity immediately
        self.setupEventMonitoring()
    }

    private func calculateOptimalFrame(relativeTo statusFrame: NSRect, preferredSize: NSSize) -> NSRect {
        guard let screen = NSScreen.main else {
            let defaultScreenWidth: CGFloat = 1_920
            let defaultScreenHeight: CGFloat = 1_080
            let rightMargin: CGFloat = 10
            let menuBarHeight: CGFloat = 25
            let gap: CGFloat = 5

            let x = defaultScreenWidth - preferredSize.width - rightMargin
            let y = defaultScreenHeight - menuBarHeight - preferredSize.height - gap
            return NSRect(origin: NSPoint(x: x, y: y), size: preferredSize)
        }

        let screenFrame = screen.visibleFrame
        let gap: CGFloat = 5

        // Check if the status frame appears to be invalid
        if statusFrame.midX < 100, statusFrame.midY < 100 {
            // Fall back to top-right positioning
            let rightMargin: CGFloat = 10

            let x = screenFrame.maxX - preferredSize.width - rightMargin
            let y = screenFrame.maxY - preferredSize.height - gap

            return NSRect(origin: NSPoint(x: x, y: y), size: preferredSize)
        }

        // Start with centered position below status item
        var x = statusFrame.midX - preferredSize.width / 2
        let y = statusFrame.minY - preferredSize.height - gap

        // Ensure window stays within screen bounds
        let minX = screenFrame.minX + 10
        let maxX = screenFrame.maxX - preferredSize.width - 10
        x = max(minX, min(maxX, x))

        // Ensure window doesn't go below screen
        let finalY = max(screenFrame.minY + 10, y)

        return NSRect(
            origin: NSPoint(x: x, y: finalY),
            size: preferredSize
        )
    }

    private func showAtTopRightFallback(withSize preferredSize: NSSize) {
        guard let screen = NSScreen.main else { return }

        let screenFrame = screen.visibleFrame
        let rightMargin: CGFloat = 10
        let gap: CGFloat = 5

        let x = screenFrame.maxX - preferredSize.width - rightMargin
        let y = screenFrame.maxY - preferredSize.height - gap

        let fallbackFrame = NSRect(
            origin: NSPoint(x: x, y: y),
            size: preferredSize
        )

        setFrame(fallbackFrame, display: false)
    }

    func hide() {
        // Mark window as not visible
        _isWindowVisible = false
        isNewSessionActive = false  // Always reset this state

        // Button state will be reset by StatusBarMenuManager via onHide callback
        orderOut(nil)
        teardownEventMonitoring()
        onHide?()
    }

    override func orderOut(_ sender: Any?) {
        super.orderOut(sender)

        // Mark window as not visible
        _isWindowVisible = false

        // Button state will be reset by StatusBarMenuManager via onHide callback
        onHide?()
    }

    private func setupEventMonitoring() {
        teardownEventMonitoring()

        guard isVisible else { return }

        eventMonitor = NSEvent.addGlobalMonitorForEvents(matching: [
            .leftMouseDown,
            .rightMouseDown
        ]) { [weak self] _ in
            guard let self, self.isVisible else { return }

            let mouseLocation = NSEvent.mouseLocation

            // Don't dismiss if new session is active
            if self.isNewSessionActive {
                // Check if clicking on status bar button to allow closing via menu icon
                if let button = self.statusBarButton,
                   let buttonWindow = button.window
                {
                    let buttonFrame = buttonWindow.convertToScreen(button.convert(button.bounds, to: nil))
                    if buttonFrame.contains(mouseLocation) {
                        // User clicked the menu bar icon, dismiss even with new session active
                        self.hide()
                    }
                }
                return
            }

            if !self.frame.contains(mouseLocation) {
                self.hide()
            }
        }

        isEventMonitoringActive = true
    }

    private func teardownEventMonitoring() {
        if let monitor = eventMonitor {
            NSEvent.removeMonitor(monitor)
            eventMonitor = nil
            isEventMonitoringActive = false
        }
    }

    override func resignKey() {
        super.resignKey()
        hide()
    }

    override var canBecomeKey: Bool {
        true
    }

    override func makeKey() {
        super.makeKey()
        // Set the window itself as first responder to prevent auto-focus
        makeFirstResponder(self)
    }

    override var canBecomeMain: Bool {
        false
    }

    deinit {
        MainActor.assumeIsolated {
            teardownEventMonitoring()
            if let observer = frameObserver {
                NotificationCenter.default.removeObserver(observer)
            }
        }
    }

    private func createSideRoundedPath(in rect: CGRect, cornerRadius: CGFloat) -> CGPath {
        let path = CGMutablePath()

        // Start from top-left corner (flat)
        path.move(to: CGPoint(x: rect.minX, y: rect.minY))

        // Top edge (flat)
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))

        // Right edge with rounded corners
        path.addArc(
            center: CGPoint(x: rect.maxX - cornerRadius, y: rect.minY + cornerRadius),
            radius: cornerRadius,
            startAngle: -CGFloat.pi / 2,
            endAngle: 0,
            clockwise: false
        )

        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - cornerRadius))

        path.addArc(
            center: CGPoint(x: rect.maxX - cornerRadius, y: rect.maxY - cornerRadius),
            radius: cornerRadius,
            startAngle: 0,
            endAngle: CGFloat.pi / 2,
            clockwise: false
        )

        // Bottom edge (flat)
        path.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))

        // Left edge with rounded corners
        path.addArc(
            center: CGPoint(x: rect.minX + cornerRadius, y: rect.maxY - cornerRadius),
            radius: cornerRadius,
            startAngle: CGFloat.pi / 2,
            endAngle: CGFloat.pi,
            clockwise: false
        )

        path.addLine(to: CGPoint(x: rect.minX, y: rect.minY + cornerRadius))

        path.addArc(
            center: CGPoint(x: rect.minX + cornerRadius, y: rect.minY + cornerRadius),
            radius: cornerRadius,
            startAngle: CGFloat.pi,
            endAngle: 3 * CGFloat.pi / 2,
            clockwise: false
        )

        path.closeSubpath()

        return path
    }
}

/// A wrapper view that applies modern SwiftUI material background to menu content.
struct CustomMenuContainer<Content: View>: View {
    @ViewBuilder let content: Content

    @Environment(\.colorScheme)
    private var colorScheme

    var body: some View {
        content
            .fixedSize()
            .background(backgroundMaterial, in: SideRoundedRectangle(cornerRadius: DesignConstants.menuCornerRadius))
            .overlay(
                SideRoundedRectangle(cornerRadius: DesignConstants.menuCornerRadius)
                    .stroke(borderColor, lineWidth: 1)
            )
    }

    private var borderColor: Color {
        switch colorScheme {
        case .dark:
            Color.white.opacity(0.1)
        case .light:
            Color.black.opacity(0.2)
        @unknown default:
            Color.white.opacity(0.5)
        }
    }

    private var backgroundMaterial: some ShapeStyle {
        switch colorScheme {
        case .dark:
            return .ultraThinMaterial
        case .light:
            // Use a darker material in light mode for better contrast
            return .regularMaterial
        @unknown default:
            return .ultraThinMaterial
        }
    }
}
