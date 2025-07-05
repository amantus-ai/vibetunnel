import SwiftUI
import UIKit

/// Design system for the VibeTunnel app.
/// Centralizes all visual styling including colors, typography,
/// spacing, corner radii, and animations for consistent UI.
enum Theme {
    // MARK: - Colors

    /// Color palette for the app with automatic light/dark mode support.
    enum Colors {
        /// Background colors
        static let terminalBackground = Color(light: Color(hex: "FFFFFF"), dark: Color(hex: "0A0E14"))
        static let cardBackground = Color(light: Color(hex: "F8F9FA"), dark: Color(hex: "0D1117"))
        static let headerBackground = Color(light: Color(hex: "FFFFFF"), dark: Color(hex: "010409"))

        /// Border colors
        static let cardBorder = Color(light: Color(hex: "E1E4E8"), dark: Color(hex: "1C2128"))

        /// Text colors
        static let terminalForeground = Color(light: Color(hex: "24292E"), dark: Color(hex: "B3B1AD"))

        /// Accent colors (same for both modes)
        static let primaryAccent = Color(hex: "007AFF") // iOS system blue
        static let secondaryAccent = Color(hex: "59C2FF")
        static let successAccent = Color(hex: "AAD94C")
        static let warningAccent = Color(hex: "FFB454")
        static let errorAccent = Color(hex: "F07178")

        /// Selection colors
        static let terminalSelection = Color(light: Color(hex: "E1E4E8"), dark: Color(hex: "273747"))

        /// Overlay colors
        static let overlayBackground = Color(light: Color.black.opacity(0.5), dark: Color.black.opacity(0.7))

        /// Additional UI colors
        static let secondaryText = Color(light: Color(hex: "6E7781"), dark: Color(hex: "8B949E"))
        static let secondaryBackground = Color(light: Color(hex: "F6F8FA"), dark: Color(hex: "161B22"))
        static let success = successAccent
        static let error = errorAccent

        /// Additional UI colors for FileBrowser
        static let terminalAccent = primaryAccent
        static let terminalGray = Color(light: Color(hex: "586069"), dark: Color(hex: "8B949E"))
        static let terminalDarkGray = Color(light: Color(hex: "F6F8FA"), dark: Color(hex: "161B22"))
        static let terminalWhite = Color(light: Color(hex: "000000"), dark: Color.white)

        /// Terminal ANSI colors - using slightly adjusted colors for light mode
        static let ansiBlack = Color(light: Color(hex: "24292E"), dark: Color(hex: "01060E"))
        static let ansiRed = Color(light: Color(hex: "D73A49"), dark: Color(hex: "EA6C73"))
        static let ansiGreen = Color(light: Color(hex: "28A745"), dark: Color(hex: "91B362"))
        static let ansiYellow = Color(light: Color(hex: "DBAB09"), dark: Color(hex: "F9AF4F"))
        static let ansiBlue = Color(light: Color(hex: "0366D6"), dark: Color(hex: "53BDFA"))
        static let ansiMagenta = Color(light: Color(hex: "6F42C1"), dark: Color(hex: "FAE994"))
        static let ansiCyan = Color(light: Color(hex: "0598BC"), dark: Color(hex: "90E1C6"))
        static let ansiWhite = Color(light: Color(hex: "586069"), dark: Color(hex: "C7C7C7"))

        /// Bright ANSI colors
        static let ansiBrightBlack = Color(light: Color(hex: "959DA5"), dark: Color(hex: "686868"))
        static let ansiBrightRed = Color(light: Color(hex: "CB2431"), dark: Color(hex: "F07178"))
        static let ansiBrightGreen = Color(light: Color(hex: "22863A"), dark: Color(hex: "C2D94C"))
        static let ansiBrightYellow = Color(light: Color(hex: "B08800"), dark: Color(hex: "FFB454"))
        static let ansiBrightBlue = Color(light: Color(hex: "005CC5"), dark: Color(hex: "59C2FF"))
        static let ansiBrightMagenta = Color(light: Color(hex: "5A32A3"), dark: Color(hex: "FFEE99"))
        static let ansiBrightCyan = Color(light: Color(hex: "0598BC"), dark: Color(hex: "95E6CB"))
        static let ansiBrightWhite = Color(light: Color(hex: "24292E"), dark: Color(hex: "FFFFFF"))

        /// File type colors
        static let fileTypeJS = Color(light: Color(hex: "B08800"), dark: Color(hex: "FFB454"))
        static let fileTypeTS = Color(light: Color(hex: "0366D6"), dark: Color(hex: "007ACC"))
        static let fileTypeJSON = Color(light: Color(hex: "E36209"), dark: Color(hex: "FF8C42"))
        static let fileTypeCSS = Color(light: Color(hex: "563D7C"), dark: Color(hex: "7B68EE"))
        static let fileTypePython = Color(light: Color(hex: "3776AB"), dark: Color(hex: "4B8BBE"))
        static let fileTypeGo = Color(light: Color(hex: "00ADD8"), dark: Color(hex: "00ADD8"))
        static let fileTypeImage = Color(light: Color(hex: "28A745"), dark: Color(hex: "91B362"))
    }

    // MARK: - Typography

    /// Typography styles for the app.
    enum Typography {
        static let terminalFont = "SF Mono"
        static let terminalFontFallback = "Menlo"
        static let uiFont = "SF Pro Display"

        static func terminal(size: CGFloat) -> Font {
            Font.custom(terminalFont, size: size)
                .monospaced()
        }

        static func terminalSystem(size: CGFloat) -> Font {
            Font.system(size: size, design: .monospaced)
        }

        static func terminalSystem(size: CGFloat, weight: Font.Weight) -> Font {
            Font.system(size: size, weight: weight, design: .monospaced)
        }

        static func largeTitle() -> Font {
            Font.largeTitle.weight(.semibold)
        }

        static func title() -> Font {
            Font.title2.weight(.medium)
        }
    }

    // MARK: - Spacing

    /// Consistent spacing values.
    enum Spacing {
        static let extraSmall: CGFloat = 4
        static let small: CGFloat = 8
        static let medium: CGFloat = 12
        static let large: CGFloat = 16
        static let extraLarge: CGFloat = 24
        static let xlarge: CGFloat = 24 // Alias for extraLarge
        static let extraExtraLarge: CGFloat = 32
    }

    // MARK: - Corner Radius

    /// Standard corner radius values.
    enum CornerRadius {
        static let small: CGFloat = 6
        static let medium: CGFloat = 10
        static let large: CGFloat = 16
        static let card: CGFloat = 12
    }

    // MARK: - Layout

    /// Layout constants
    enum Layout {
        static let cornerRadius: CGFloat = 10
    }

    // MARK: - Animation

    /// Animation presets.
    enum Animation {
        static let quick = SwiftUI.Animation.easeInOut(duration: 0.2)
        static let standard = SwiftUI.Animation.easeInOut(duration: 0.3)
        static let smooth = SwiftUI.Animation.spring(response: 0.4, dampingFraction: 0.8)
    }

    // MARK: - Shadows

    enum CardShadow {
        static let color = Color(light: Color.black.opacity(0.1), dark: Color.black.opacity(0.3))
        static let radius: CGFloat = 8
        static let xOffset: CGFloat = 0
        static let yOffset: CGFloat = 2
    }

    enum ButtonShadow {
        static let color = Color(light: Color.black.opacity(0.08), dark: Color.black.opacity(0.2))
        static let radius: CGFloat = 4
        static let xOffset: CGFloat = 0
        static let yOffset: CGFloat = 1
    }
}

// MARK: - Color Extensions

/// Color extension for hex initialization and dark mode support.
/// Provides convenience initializers for creating colors from hex strings and adaptive colors.
extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let alpha, red, green, blue: UInt64
        switch hex.count {
        case 3: // RGB (12-bit)
            (alpha, red, green, blue) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6: // RGB (24-bit)
            (alpha, red, green, blue) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8: // ARGB (32-bit)
            (alpha, red, green, blue) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default:
            (alpha, red, green, blue) = (255, 0, 0, 0)
        }

        self.init(
            .sRGB,
            red: Double(red) / 255,
            green: Double(green) / 255,
            blue: Double(blue) / 255,
            opacity: Double(alpha) / 255
        )
    }

    /// Creates a color that automatically adapts to light/dark mode
    init(light: Color, dark: Color) {
        self.init(UIColor { traitCollection in
            switch traitCollection.userInterfaceStyle {
            case .dark:
                UIColor(dark)
            default:
                UIColor(light)
            }
        })
    }
}

// MARK: - View Modifiers

/// View extension for terminal UI styling.
/// Provides pre-configured modifiers for consistent terminal app appearance.
extension View {
    func terminalCard() -> some View {
        self
            .background(Theme.Colors.cardBackground)
            .cornerRadius(Theme.CornerRadius.card)
            .overlay(
                RoundedRectangle(cornerRadius: Theme.CornerRadius.card)
                    .stroke(Theme.Colors.cardBorder, lineWidth: 1)
            )
            .shadow(
                color: Theme.CardShadow.color,
                radius: Theme.CardShadow.radius,
                x: Theme.CardShadow.xOffset,
                y: Theme.CardShadow.yOffset
            )
    }

    func glowEffect(color: Color = Theme.Colors.primaryAccent) -> some View {
        self
            .shadow(color: color.opacity(0.5), radius: 10)
            .shadow(color: color.opacity(0.3), radius: 20)
    }

    func terminalButton() -> some View {
        self
            .foregroundColor(Theme.Colors.terminalForeground)
            .padding(.horizontal, Theme.Spacing.large)
            .padding(.vertical, Theme.Spacing.medium)
            .background(Theme.Colors.primaryAccent.opacity(0.1))
            .cornerRadius(Theme.CornerRadius.medium)
            .overlay(
                RoundedRectangle(cornerRadius: Theme.CornerRadius.medium)
                    .stroke(Theme.Colors.primaryAccent, lineWidth: 1)
            )
    }

    // Removed: interactiveButton - use explicit scaleEffect and animation instead
}

// MARK: - Haptic Feedback

/// Protocol for haptic feedback functionality.
/// Provides methods for various types of tactile feedback.
@MainActor
protocol HapticFeedbackProtocol {
    func impact(_ style: HapticFeedback.ImpactStyle)
    func selection()
    func notification(_ type: HapticFeedback.NotificationType)
}

/// Provides haptic feedback for user interactions.
/// Wraps UIKit haptic generators with a SwiftUI-friendly API.
@MainActor
struct HapticFeedback: HapticFeedbackProtocol {
    static let shared: HapticFeedbackProtocol = Self()

    func impact(_ style: ImpactStyle) {
        let generator = UIImpactFeedbackGenerator(style: style.uiKitStyle)
        generator.impactOccurred()
    }

    func selection() {
        let generator = UISelectionFeedbackGenerator()
        generator.selectionChanged()
    }

    func notification(_ type: NotificationType) {
        let generator = UINotificationFeedbackGenerator()
        generator.notificationOccurred(type.uiKitType)
    }

    static func impact(_ style: ImpactStyle) {
        shared.impact(style)
    }

    static func selection() {
        shared.selection()
    }

    static func notification(_ type: NotificationType) {
        shared.notification(type)
    }

    /// SwiftUI-native style enums
    enum ImpactStyle {
        case light
        case medium
        case heavy
        case soft
        case rigid

        var uiKitStyle: UIImpactFeedbackGenerator.FeedbackStyle {
            switch self {
            case .light: .light
            case .medium: .medium
            case .heavy: .heavy
            case .soft: .soft
            case .rigid: .rigid
            }
        }
    }

    enum NotificationType {
        case success
        case warning
        case error

        var uiKitType: UINotificationFeedbackGenerator.FeedbackType {
            switch self {
            case .success: .success
            case .warning: .warning
            case .error: .error
            }
        }
    }
}

// Note: Call HapticFeedback methods directly instead of using view modifiers
// Example: HapticFeedback.impact(.light) or HapticFeedback.selection()
