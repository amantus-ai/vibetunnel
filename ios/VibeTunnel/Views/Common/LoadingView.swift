import SwiftUI

/// Reusable loading indicator with message.
///
/// Displays an animated spinner with a customizable message,
/// styled to match the terminal theme.
struct LoadingView: View {
    let message: String
    let useUnicodeSpinner: Bool

    @State private var isAnimating = false
    @State private var spinnerFrame = 0

    /// Unicode spinner frames matching web UI
    private let spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

    init(message: String, useUnicodeSpinner: Bool = false) {
        self.message = message
        self.useUnicodeSpinner = useUnicodeSpinner
    }

    var body: some View {
        VStack(spacing: Theme.Spacing.large) {
            if useUnicodeSpinner {
                Text(spinnerFrames[spinnerFrame])
                    .font(Theme.Typography.terminalSystem(size: 24))
                    .foregroundColor(Theme.Colors.primaryAccent)
                    .onAppear {
                        startUnicodeAnimation()
                    }
            } else {
                ZStack {
                    Circle()
                        .stroke(Theme.Colors.cardBorder, lineWidth: 3)
                        .frame(width: 50, height: 50)

                    Circle()
                        .trim(from: 0, to: 0.2)
                        .stroke(Theme.Colors.primaryAccent, lineWidth: 3)
                        .frame(width: 50, height: 50)
                        .rotationEffect(Angle(degrees: isAnimating ? 360 : 0))
                        .animation(
                            Animation.linear(duration: 1)
                                .repeatForever(autoreverses: false),
                            value: isAnimating
                        )
                }
            }

            Text(message)
                .font(Theme.Typography.terminalSystem(size: 14))
                .foregroundColor(Theme.Colors.terminalForeground.opacity(0.7))
        }
        .onAppear {
            if !useUnicodeSpinner {
                isAnimating = true
            }
        }
    }

    private func startUnicodeAnimation() {
        Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { _ in
            Task { @MainActor in
                spinnerFrame = (spinnerFrame + 1) % spinnerFrames.count
            }
        }
    }
}
