import AppKit
import SwiftUI

/// Simple NSWindow-based dropdown for autocomplete
struct AutocompleteWindowView: NSViewRepresentable {
    let suggestions: [PathSuggestion]
    @Binding var selectedIndex: Int
    let keyboardNavigating: Bool
    let onSelect: (String) -> Void
    let width: CGFloat
    @Binding var isShowing: Bool

    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        view.wantsLayer = true
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        if isShowing && !suggestions.isEmpty {
            context.coordinator.showDropdown(
                on: nsView,
                suggestions: suggestions,
                selectedIndex: selectedIndex,
                keyboardNavigating: keyboardNavigating,
                width: width
            )
        } else {
            context.coordinator.hideDropdown()
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(onSelect: onSelect, isShowing: $isShowing, selectedIndex: $selectedIndex)
    }

    @MainActor
    class Coordinator: NSObject {
        private var dropdownWindow: NSWindow?
        private var hostingView: NSHostingView<AnyView>?
        private let onSelect: (String) -> Void
        @Binding var isShowing: Bool
        @Binding var selectedIndex: Int
        private nonisolated(unsafe) var clickMonitor: Any?

        init(onSelect: @escaping (String) -> Void, isShowing: Binding<Bool>, selectedIndex: Binding<Int>) {
            self.onSelect = onSelect
            self._isShowing = isShowing
            self._selectedIndex = selectedIndex
            super.init()
        }

        deinit {
            if let monitor = clickMonitor {
                DispatchQueue.main.async {
                    NSEvent.removeMonitor(monitor)
                }
            }
        }

        @MainActor
        private func cleanupClickMonitor() {
            if let monitor = clickMonitor {
                NSEvent.removeMonitor(monitor)
                clickMonitor = nil
            }
        }

        @MainActor
        func showDropdown(
            on view: NSView,
            suggestions: [PathSuggestion],
            selectedIndex: Int,
            keyboardNavigating: Bool,
            width: CGFloat
        ) {
            guard let parentWindow = view.window else { return }

            // Create window if needed
            if dropdownWindow == nil {
                let window = NSWindow(
                    contentRect: NSRect(x: 0, y: 0, width: width, height: 200),
                    styleMask: [.borderless],
                    backing: .buffered,
                    defer: false
                )

                window.isOpaque = false
                window.backgroundColor = .clear
                window.hasShadow = true
                window.level = .floating
                window.isReleasedWhenClosed = false

                let hostingView = NSHostingView(rootView: AnyView(EmptyView()))
                window.contentView = hostingView

                self.dropdownWindow = window
                self.hostingView = hostingView
            }

            guard let window = dropdownWindow,
                  let hostingView else { return }

            // Update content with proper binding
            let content = VStack(spacing: 0) {
                AutocompleteViewWithKeyboard(
                    suggestions: suggestions,
                    selectedIndex: $selectedIndex,
                    keyboardNavigating: keyboardNavigating
                ) { [weak self] suggestion in
                    self?.onSelect(suggestion)
                    self?.isShowing = false
                }
            }
            .frame(width: width)
            .frame(maxHeight: 200)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 6))
            .shadow(color: .black.opacity(0.1), radius: 4, x: 0, y: 2)
            .overlay(
                RoundedRectangle(cornerRadius: 6)
                    .stroke(Color.primary.opacity(0.1), lineWidth: 1)
            )

            hostingView.rootView = AnyView(content)

            // Position window below the text field
            let viewFrame = view.convert(view.bounds, to: nil)
            let screenFrame = parentWindow.convertToScreen(viewFrame)

            // Calculate window position
            let windowFrame = NSRect(
                x: screenFrame.minX,
                y: screenFrame.minY - 204, // dropdown height + spacing
                width: width,
                height: 200
            )

            window.setFrame(windowFrame, display: false)

            // Show window
            if window.parent == nil {
                parentWindow.addChildWindow(window, ordered: .above)
            }
            window.makeKeyAndOrderFront(nil)

            // Setup click monitoring
            if clickMonitor == nil {
                clickMonitor = NSEvent.addLocalMonitorForEvents(
                    matching: [.leftMouseDown, .rightMouseDown]
                ) { [weak self] event in
                    if event.window != window {
                        self?.isShowing = false
                    }
                    return event
                }
            }
        }

        @MainActor
        func hideDropdown() {
            cleanupClickMonitor()

            if let window = dropdownWindow {
                if let parent = window.parent {
                    parent.removeChildWindow(window)
                }
                window.orderOut(nil)
            }
        }
    }
}
