import SwiftUI
#if targetEnvironment(macCatalyst)
    import Dynamic
    import UIKit

    // MARK: - Window Style

    /// Mac Catalyst window appearance styles.
    /// Controls title bar visibility and traffic light positioning.
    enum MacWindowStyle {
        case standard // Normal title bar with traffic lights
        case inline // Hidden title bar with repositioned traffic lights
    }

    // MARK: - UIWindow Extension

    /// UIWindow extension for accessing NSWindow in Mac Catalyst.
    /// Provides bridge to AppKit window functionality on macOS.
    extension UIWindow {
        /// Access the underlying NSWindow in Mac Catalyst
        var nsWindow: NSObject? {
            var nsWindow = Dynamic.NSApplication.sharedApplication.delegate.hostWindowForUIWindow(self)
            nsWindow = nsWindow.attachedWindow
            return nsWindow.asObject
        }
    }

    // MARK: - Window Manager

    /// Manages Mac Catalyst window customizations.
    /// Handles window style changes and traffic light button repositioning.
    @MainActor
    class MacCatalystWindowManager: ObservableObject {
        static let shared = MacCatalystWindowManager()

        @Published var windowStyle: MacWindowStyle = .standard

        private var window: UIWindow?
        private var windowResizeObserver: NSObjectProtocol?
        private var windowDidBecomeKeyObserver: NSObjectProtocol?
        private let logger = Logger(category: "MacCatalystWindow")

        // Traffic light button configuration
        private let trafficLightInset = CGPoint(x: 20, y: 20)
        private let trafficLightSpacing: CGFloat = 20

        private init() {}

        /// Configure the window with the specified style
        func configureWindow(_ window: UIWindow, style: MacWindowStyle) {
            self.window = window
            self.windowStyle = style

            // Wait for window to be fully initialized
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                self.applyWindowStyle(style)
            }

            // Observe window events
            setupWindowObservers()
        }

        /// Switch between window styles at runtime
        func setWindowStyle(_ style: MacWindowStyle) {
            windowStyle = style
            applyWindowStyle(style)
        }

        private func applyWindowStyle(_ style: MacWindowStyle) {
            guard let window,
                  let nsWindow = window.nsWindow
            else {
                logger.warning("Unable to access NSWindow")
                return
            }

            let dynamic = Dynamic(nsWindow)

            switch style {
            case .standard:
                applyStandardStyle(dynamic)
            case .inline:
                applyInlineStyle(dynamic, window: window)
            }
        }

        private func applyStandardStyle(_ nsWindow: Dynamic) {
            logger.info("Applying standard window style")

            // Show title bar
            nsWindow.titlebarAppearsTransparent = false
            nsWindow.titleVisibility = Dynamic.NSWindowTitleVisibility.visible
            guard let currentMask = nsWindow.styleMask.asObject as? UInt,
                  let titledMask = Dynamic.NSWindowStyleMask.titled.asObject as? UInt
            else {
                logger.error("Failed to get window style masks")
                return
            }
            nsWindow.styleMask = currentMask | titledMask

            // Reset traffic light positions
            resetTrafficLightPositions(nsWindow)

            // Show all buttons
            for i in 0...2 {
                let button = nsWindow.standardWindowButton(i)
                button.isHidden = false
            }
        }

        private func applyInlineStyle(_ nsWindow: Dynamic, window: UIWindow) {
            logger.info("Applying inline window style")

            // Make title bar transparent and hide title
            nsWindow.titlebarAppearsTransparent = true
            nsWindow.titleVisibility = Dynamic.NSWindowTitleVisibility.hidden
            nsWindow.backgroundColor = Dynamic.NSColor.clearColor

            // Keep the titled style mask to preserve traffic lights
            guard let currentMask = nsWindow.styleMask.asObject as? UInt,
                  let titledMask = Dynamic.NSWindowStyleMask.titled.asObject as? UInt
            else {
                logger.error("Failed to get window style masks")
                return
            }
            nsWindow.styleMask = currentMask | titledMask

            // Reposition traffic lights
            repositionTrafficLights(nsWindow, window: window)
        }

        private func repositionTrafficLights(_ nsWindow: Dynamic, window: UIWindow) {
            // Access the buttons (0=close, 1=minimize, 2=zoom)
            let closeButton = nsWindow.standardWindowButton(0)
            let minButton = nsWindow.standardWindowButton(1)
            let zoomButton = nsWindow.standardWindowButton(2)

            // Get button size
            let buttonFrame = closeButton.frame
            let buttonSize = (buttonFrame.size.width.asDouble ?? 14.0) as CGFloat

            // Calculate positions
            let yPosition = window.frame.height - trafficLightInset.y - buttonSize

            // Set new positions
            closeButton.setFrameOrigin(Dynamic.NSMakePoint(trafficLightInset.x, yPosition))
            minButton.setFrameOrigin(Dynamic.NSMakePoint(trafficLightInset.x + trafficLightSpacing, yPosition))
            zoomButton.setFrameOrigin(Dynamic.NSMakePoint(trafficLightInset.x + (trafficLightSpacing * 2), yPosition))

            // Make sure buttons are visible
            closeButton.isHidden = false
            minButton.isHidden = false
            zoomButton.isHidden = false

            // Update tracking areas for hover effects
            updateTrafficLightTrackingAreas(nsWindow)

            logger.debug("Repositioned traffic lights to inline positions")
        }

        private func resetTrafficLightPositions(_ nsWindow: Dynamic) {
            // Get the superview of the traffic lights
            let closeButton = nsWindow.standardWindowButton(0)
            if let superview = closeButton.superview {
                // Force layout update to reset positions
                superview.setNeedsLayout?.asObject = true
                superview.layoutIfNeeded()
            }
        }

        private func updateTrafficLightTrackingAreas(_ nsWindow: Dynamic) {
            // Update tracking areas for each button to ensure hover effects work
            for i in 0...2 {
                let button = nsWindow.standardWindowButton(i)

                // Remove old tracking areas
                if let trackingAreas = button.trackingAreas {
                    for area in trackingAreas.asArray ?? [] {
                        button.removeTrackingArea(area)
                    }
                }

                // Add new tracking area at the button's current position
                let trackingRect = button.bounds
                guard let mouseEnteredAndExited = Dynamic.NSTrackingAreaOptions.mouseEnteredAndExited.asObject as? UInt,
                      let activeAlways = Dynamic.NSTrackingAreaOptions.activeAlways.asObject as? UInt
                else {
                    logger.error("Failed to get tracking area options")
                    return
                }
                let options = mouseEnteredAndExited | activeAlways

                let trackingArea = Dynamic.NSTrackingArea.alloc()
                    .initWithRect(trackingRect, options: options, owner: button, userInfo: nil)

                button.addTrackingArea(trackingArea)
            }
        }

        private func setupWindowObservers() {
            // Clean up existing observers
            if let observer = windowResizeObserver {
                NotificationCenter.default.removeObserver(observer)
            }
            if let observer = windowDidBecomeKeyObserver {
                NotificationCenter.default.removeObserver(observer)
            }

            // Observe window resize events
            windowResizeObserver = NotificationCenter.default.addObserver(
                forName: NSNotification.Name("NSWindowDidResizeNotification"),
                object: nil,
                queue: .main
            ) { [weak self] notification in
                guard let self,
                      self.windowStyle == .inline,
                      let window = self.window,
                      let notificationWindow = notification.object as? NSObject,
                      let currentNSWindow = window.nsWindow,
                      notificationWindow == currentNSWindow else { return }

                // Reapply inline style on resize
                DispatchQueue.main.async {
                    self.applyWindowStyle(.inline)
                }
            }

            // Observe window becoming key
            windowDidBecomeKeyObserver = NotificationCenter.default.addObserver(
                forName: UIWindow.didBecomeKeyNotification,
                object: window,
                queue: .main
            ) { [weak self] _ in
                guard let self,
                      self.windowStyle == .inline else { return }

                // Reapply inline style when window becomes key
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                    self.applyWindowStyle(.inline)
                }
            }

            // Also observe the NS notification for tracking area updates
            NotificationCenter.default.addObserver(
                forName: NSNotification.Name("NSViewDidUpdateTrackingAreasNotification"),
                object: nil,
                queue: .main
            ) { [weak self] _ in
                guard let self,
                      self.windowStyle == .inline else { return }

                // Reposition if needed
                if let window = self.window,
                   let nsWindow = window.nsWindow
                {
                    self.repositionTrafficLights(Dynamic(nsWindow), window: window)
                }
            }
        }

        deinit {
            if let observer = windowResizeObserver {
                NotificationCenter.default.removeObserver(observer)
            }
            if let observer = windowDidBecomeKeyObserver {
                NotificationCenter.default.removeObserver(observer)
            }
        }
    }

    // MARK: - View Modifier

    /// View modifier for applying Mac Catalyst window styles.
    /// Configures window appearance when the view appears.
    struct MacCatalystWindowStyle: ViewModifier {
        let style: MacWindowStyle
        @StateObject private var windowManager = MacCatalystWindowManager.shared

        func body(content: Content) -> some View {
            content
                .onAppear {
                    setupWindow()
                }
        }

        private func setupWindow() {
            guard let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                  let window = windowScene.windows.first
            else {
                return
            }

            windowManager.configureWindow(window, style: style)
        }
    }

    // MARK: - View Extension

    /// View extension for Mac Catalyst window configuration.
    /// Enables views to configure window style on Mac Catalyst builds.
    extension View {
        /// Configure the Mac Catalyst window style
        func macCatalystWindowStyle(_ style: MacWindowStyle) -> some View {
            modifier(MacCatalystWindowStyle(style: style))
        }
    }

#endif
