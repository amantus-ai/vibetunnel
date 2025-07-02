import SwiftUI

/// Common styling constants and modifiers for the VibeTunnel menu.
enum MenuStyles {
    static let menuWidth: CGFloat = 384
    static let cornerRadius: CGFloat = 6
    static let smallCornerRadius: CGFloat = 4
    static let padding: CGFloat = 12
    static let smallPadding: CGFloat = 8
    static let animationDuration: Double = 0.15

    static let headerGradientLight: [Color] = [
        AppColors.Fallback.controlBackground(for: .light),
        AppColors.Fallback.controlBackground(for: .light).opacity(0.8)
    ]

    static let headerGradientDark: [Color] = [
        AppColors.Fallback.controlBackground(for: .dark).opacity(0.6),
        AppColors.Fallback.controlBackground(for: .dark).opacity(0.3)
    ]
}

// MARK: - View Modifiers

extension View {
    /// Applies standard hover effect for menu items
    func menuItemHover(isHovered: Bool, colorScheme: ColorScheme) -> some View {
        self
            .background(
                RoundedRectangle(cornerRadius: MenuStyles.cornerRadius)
                    .fill(isHovered ? AppColors.Fallback.accentHover(for: colorScheme).opacity(0.1) : Color.clear)
                    .animation(.easeInOut(duration: MenuStyles.animationDuration), value: isHovered)
            )
    }

    /// Applies standard focus ring for keyboard navigation
    func menuItemFocus(isFocused: Bool, colorScheme: ColorScheme) -> some View {
        self
            .overlay(
                RoundedRectangle(cornerRadius: MenuStyles.smallCornerRadius)
                    .strokeBorder(
                        isFocused ? AppColors.Fallback.accentHover(for: colorScheme).opacity(2) : Color.clear,
                        lineWidth: 1
                    )
                    .animation(.easeInOut(duration: MenuStyles.animationDuration), value: isFocused)
            )
    }
}
