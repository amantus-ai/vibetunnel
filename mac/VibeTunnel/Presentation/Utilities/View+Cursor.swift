import SwiftUI

/// Extensions for SwiftUI View to handle cursor and press events.
extension View {
    func pressEvents(onPress: @escaping () -> Void, onRelease: @escaping () -> Void) -> some View {
        modifier(PressEventModifier(onPress: onPress, onRelease: onRelease))
    }

    func pointingHandCursor() -> some View {
        modifier(PointingHandCursorModifier())
    }
}

/// View modifier for handling press events on buttons.
///
/// Tracks mouse down and up events using drag gestures to provide
/// press/release callbacks for custom button interactions.
struct PressEventModifier: ViewModifier {
    let onPress: () -> Void
    let onRelease: () -> Void

    func body(content: Content) -> some View {
        content
            .simultaneousGesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { _ in self.onPress() }
                    .onEnded { _ in self.onRelease() })
    }
}

/// View modifier for showing pointing hand cursor on hover.
///
/// Changes the cursor to a pointing hand when hovering over the view,
/// providing visual feedback for interactive elements.
struct PointingHandCursorModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .background(
                CursorTrackingView()
                    .allowsHitTesting(false))
    }
}

/// NSViewRepresentable that handles cursor changes properly.
///
/// Bridges AppKit's cursor tracking to SwiftUI views.
struct CursorTrackingView: NSViewRepresentable {
    func makeNSView(context _: Context) -> CursorTrackingNSView {
        CursorTrackingNSView()
    }

    func updateNSView(_: CursorTrackingNSView, context _: Context) {
        // No updates needed
    }
}

/// Custom NSView that properly handles cursor tracking.
///
/// This view ensures the pointing hand cursor is displayed when hovering over interactive elements
/// by managing cursor rectangles and invalidating them when the view hierarchy changes.
class CursorTrackingNSView: NSView {
    override func resetCursorRects() {
        super.resetCursorRects()
        addCursorRect(bounds, cursor: .pointingHand)
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        window?.invalidateCursorRects(for: self)
    }
}
