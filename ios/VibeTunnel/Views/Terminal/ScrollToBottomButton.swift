import SwiftUI

private let logger = Logger(category: "ScrollToBottomButton")

/// Floating action button to scroll terminal to bottom
struct ScrollToBottomButton: View {
    let isVisible: Bool
    let action: () -> Void
    @State private var isHovered = false
    @State private var isPressed = false

    var body: some View {
        Button(action: {
            HapticFeedback.impact(.light)
            self.action()
        }, label: {
            Text("↓")
                .font(.system(size: 24, weight: .bold))
                .foregroundColor(self.isHovered ? Theme.Colors.primaryAccent : Theme.Colors.terminalForeground)
                .frame(width: 48, height: 48)
                .background(
                    Circle()
                        .fill(self.isHovered ? Theme.Colors.cardBackground : Theme.Colors.cardBackground.opacity(0.8))
                        .overlay(
                            Circle()
                                .stroke(
                                    self.isHovered ? Theme.Colors.primaryAccent : Theme.Colors.cardBorder,
                                    lineWidth: self.isHovered ? 2 : 1)))
                .shadow(
                    color: self.isHovered ? Theme.Colors.primaryAccent.opacity(0.3) : .black.opacity(0.3),
                    radius: self.isHovered ? 12 : 8,
                    x: 0,
                    y: self.isHovered ? 3 : 4)
                .scaleEffect(self.isPressed ? 0.95 : 1.0)
                .offset(y: self.isHovered && !self.isPressed ? -1 : 0)
        })
        .buttonStyle(PlainButtonStyle())
        .opacity(self.isVisible ? 1 : 0)
        .scaleEffect(self.isVisible ? 1 : 0.8)
        .animation(Theme.Animation.quick, value: self.isHovered)
        .animation(Theme.Animation.quick, value: self.isPressed)
        .animation(Theme.Animation.smooth, value: self.isVisible)
        .allowsHitTesting(self.isVisible)
        .onLongPressGesture(minimumDuration: 0, maximumDistance: .infinity) { pressing in
            self.isPressed = pressing
        } perform: {
            // Action handled by button
        }
        .onHover { hovering in
            self.isHovered = hovering
        }
    }
}

// Note: Use ScrollToBottomButton directly with overlay instead of this extension
// Example:
// .overlay(
//     ScrollToBottomButton(isVisible: showButton, action: { })
//         .padding(.bottom, Theme.Spacing.large)
//         .padding(.leading, Theme.Spacing.large),
//     alignment: .bottomLeading
// )

#Preview {
    ZStack {
        Theme.Colors.terminalBackground
            .ignoresSafeArea()

        ScrollToBottomButton(isVisible: true) {
            logger.debug("Scroll to bottom")
        }
    }
}
