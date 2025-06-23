import SwiftUI

private let logger = Logger(category: "FileBrowserFAB")

/// Floating action button for opening file browser
struct FileBrowserFAB: View {
    let isVisible: Bool
    let action: () -> Void

    var body: some View {
        Button(action: {
            Task { @MainActor in
                HapticFeedback.impact(.medium)
            }
            action()
        }, label: {
            Image(systemName: "folder.fill")
                .font(.system(size: 20, weight: .medium))
                .foregroundColor(Theme.Colors.terminalBackground)
                .frame(width: 56, height: 56)
                .background(
                    Circle()
                        .fill(Theme.Colors.primaryAccent)
                        .overlay(
                            Circle()
                                .stroke(Theme.Colors.primaryAccent.opacity(0.3), lineWidth: 1)
                        )
                )
                .shadow(color: .black.opacity(0.3), radius: 8, x: 0, y: 4)
        })
        .opacity(isVisible ? 1 : 0)
        .scaleEffect(isVisible ? 1 : 0.8)
        .animation(Theme.Animation.smooth, value: isVisible)
        .allowsHitTesting(isVisible)
    }
}

// Note: Use FileBrowserFAB directly with overlay instead of this extension
// Example:
// .overlay(
//     FileBrowserFAB(isVisible: showFAB, action: { })
//         .padding(.bottom, Theme.Spacing.extraLarge)
//         .padding(.trailing, Theme.Spacing.large),
//     alignment: .bottomTrailing
// )

#Preview {
    ZStack {
        Theme.Colors.terminalBackground
            .ignoresSafeArea()

        FileBrowserFAB(isVisible: true) {
            logger.debug("Open file browser")
        }
    }
}
