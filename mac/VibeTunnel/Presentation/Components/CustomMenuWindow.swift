import AppKit
import SwiftUI

/// Custom borderless window that appears below the menu bar icon.
///
/// Provides a dropdown-style window for the menu bar application
/// without the standard macOS popover arrow. Handles automatic positioning below
/// the status item, click-outside dismissal, and proper window management.
@MainActor
final class CustomMenuWindow: NSPanel {
    private var eventMonitor: Any?
    private let hostingController: NSHostingController<AnyView>
    private var retainedContentView: AnyView?
    private var isEventMonitoringActive = false

    /// Closure to be called when window hides
    var onHide: (() -> Void)?

    init(contentView: some View) {
        // Store the content view to prevent deallocation in Release builds
        let wrappedView = AnyView(contentView)
        self.retainedContentView = wrappedView

        // Create content view controller with the wrapped view
        hostingController = NSHostingController(rootView: wrappedView)

        // Initialize window with appropriate style
        super.init(
            contentRect: NSRect(x: 0, y: 0, width: 384, height: 400),
            styleMask: [.borderless, .nonactivatingPanel, .utilityWindow],
            backing: .buffered,
            defer: false
        )

        // Configure window appearance
        isOpaque = false
        backgroundColor = .clear
        hasShadow = true
        level = .popUpMenu
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
        isMovableByWindowBackground = false
        hidesOnDeactivate = false
        isReleasedWhenClosed = false

        // Set content view controller
        contentViewController = hostingController

        // Force the view to load immediately
        _ = hostingController.view

        // Add visual effect background with rounded corners
        if let contentView = contentViewController?.view {
            contentView.wantsLayer = true
            contentView.layer?.cornerRadius = 12
            contentView.layer?.masksToBounds = true

            // Add subtle shadow
            contentView.shadow = NSShadow()
            contentView.shadow?.shadowOffset = NSSize(width: 0, height: -1)
            contentView.shadow?.shadowBlurRadius = 12
            contentView.shadow?.shadowColor = NSColor.black.withAlphaComponent(0.3)
        }
    }

    func show(relativeTo statusItemButton: NSStatusBarButton) {
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

                setFrame(targetFrame, display: false)
            } else {
                // Fallback: Position at top right of screen
                showAtTopRightFallback(withSize: preferredSize)
            }
        } else {
            // Fallback case
            showAtTopRightFallback(withSize: preferredSize)
        }

        // Ensure the hosting controller's view is loaded
        _ = hostingController.view

        // Display window safely
        displayWindowSafely()
    }

    private func displayWindowSafely() {
        alphaValue = 0

        // Ensure app is active
        NSApp.activate(ignoringOtherApps: true)

        // Make the window first responder to enable keyboard navigation
        // but don't focus any specific element
        makeFirstResponder(self)

        // Small delay to ensure window is fully displayed before animation
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(10))

            if self.isVisible {
                self.animateWindowIn()
                self.setupEventMonitoring()
            } else {
                await self.displayWindowFallback()
            }
        }
    }

    private func displayWindowFallback() async {
        NSApp.activate(ignoringOtherApps: true)
        self.makeKeyAndOrderFront(nil)

        try? await Task.sleep(for: .milliseconds(50))

        if self.isVisible {
            self.animateWindowIn()
            self.setupEventMonitoring()
        } else {
            self.orderFrontRegardless()
            self.alphaValue = 1.0
            self.setupEventMonitoring()
        }
    }

    private func animateWindowIn() {
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.25
            context.timingFunction = CAMediaTimingFunction(controlPoints: 0.2, 0.0, 0.2, 1.0)
            context.allowsImplicitAnimation = true
            self.animator().alphaValue = 1
        }
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
        orderOut(nil)
        teardownEventMonitoring()
        onHide?()
    }

    override func orderOut(_ sender: Any?) {
        super.orderOut(sender)
        if isVisible == false {
            onHide?()
        }
    }

    private func setupEventMonitoring() {
        teardownEventMonitoring()

        guard isVisible else { return }

        eventMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] _ in
            guard let self, self.isVisible else { return }

            let mouseLocation = NSEvent.mouseLocation

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
        }
    }
}

/// A wrapper view that applies modern SwiftUI material background to menu content.
struct CustomMenuContainer<Content: View>: View {
    @ViewBuilder
    let content: Content

    @Environment(\.colorScheme)
    private var colorScheme

    var body: some View {
        content
            .fixedSize()
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(borderColor, lineWidth: 1)
            )
    }

    private var borderColor: Color {
        switch colorScheme {
        case .dark:
            Color.white.opacity(0.1)
        case .light:
            Color.white.opacity(0.8)
        @unknown default:
            Color.white.opacity(0.5)
        }
    }
}
