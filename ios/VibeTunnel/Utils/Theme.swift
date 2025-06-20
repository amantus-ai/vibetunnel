import SwiftUI

struct Theme {
    // MARK: - Colors
    struct Colors {
        // Terminal-inspired colors
        static let terminalBackground = Color(hex: "0A0E14")
        static let terminalForeground = Color(hex: "B3B1AD")
        static let terminalSelection = Color(hex: "273747")
        
        // Accent colors
        static let primaryAccent = Color(hex: "39BAE6")
        static let secondaryAccent = Color(hex: "59C2FF")
        static let successAccent = Color(hex: "AAD94C")
        static let warningAccent = Color(hex: "FFB454")
        static let errorAccent = Color(hex: "F07178")
        
        // UI colors
        static let cardBackground = Color(hex: "0D1117")
        static let cardBorder = Color(hex: "1C2128")
        static let headerBackground = Color(hex: "010409")
        static let overlayBackground = Color.black.opacity(0.7)
        
        // Terminal ANSI colors
        static let ansiBlack = Color(hex: "01060E")
        static let ansiRed = Color(hex: "EA6C73")
        static let ansiGreen = Color(hex: "91B362")
        static let ansiYellow = Color(hex: "F9AF4F")
        static let ansiBlue = Color(hex: "53BDFA")
        static let ansiMagenta = Color(hex: "FAE994")
        static let ansiCyan = Color(hex: "90E1C6")
        static let ansiWhite = Color(hex: "C7C7C7")
        
        // Bright ANSI colors
        static let ansiBrightBlack = Color(hex: "686868")
        static let ansiBrightRed = Color(hex: "F07178")
        static let ansiBrightGreen = Color(hex: "C2D94C")
        static let ansiBrightYellow = Color(hex: "FFB454")
        static let ansiBrightBlue = Color(hex: "59C2FF")
        static let ansiBrightMagenta = Color(hex: "FFEE99")
        static let ansiBrightCyan = Color(hex: "95E6CB")
        static let ansiBrightWhite = Color(hex: "FFFFFF")
    }
    
    // MARK: - Typography
    struct Typography {
        static let terminalFont = "SF Mono"
        static let terminalFontFallback = "Menlo"
        static let uiFont = "SF Pro Display"
        
        static func terminal(size: CGFloat) -> Font {
            return Font.custom(terminalFont, size: size)
                .monospaced()
        }
        
        static func terminalSystem(size: CGFloat) -> Font {
            return Font.system(size: size, design: .monospaced)
        }
    }
    
    // MARK: - Spacing
    struct Spacing {
        static let xs: CGFloat = 4
        static let sm: CGFloat = 8
        static let md: CGFloat = 12
        static let lg: CGFloat = 16
        static let xl: CGFloat = 24
        static let xxl: CGFloat = 32
    }
    
    // MARK: - Corner Radius
    struct CornerRadius {
        static let small: CGFloat = 6
        static let medium: CGFloat = 10
        static let large: CGFloat = 16
        static let card: CGFloat = 12
    }
    
    // MARK: - Animation
    struct Animation {
        static let quick = SwiftUI.Animation.easeInOut(duration: 0.2)
        static let standard = SwiftUI.Animation.easeInOut(duration: 0.3)
        static let smooth = SwiftUI.Animation.spring(response: 0.4, dampingFraction: 0.8)
    }
    
    // MARK: - Shadows
    struct Shadow {
        static let card = SwiftUI.Shadow(
            color: Color.black.opacity(0.3),
            radius: 8,
            x: 0,
            y: 2
        )
        
        static let button = SwiftUI.Shadow(
            color: Color.black.opacity(0.2),
            radius: 4,
            x: 0,
            y: 1
        )
    }
}

// MARK: - Color Extension
extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 3: // RGB (12-bit)
            (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6: // RGB (24-bit)
            (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8: // ARGB (32-bit)
            (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default:
            (a, r, g, b) = (255, 0, 0, 0)
        }
        
        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue: Double(b) / 255,
            opacity: Double(a) / 255
        )
    }
}

// MARK: - View Modifiers
extension View {
    func terminalCard() -> some View {
        self
            .background(Theme.Colors.cardBackground)
            .cornerRadius(Theme.CornerRadius.card)
            .overlay(
                RoundedRectangle(cornerRadius: Theme.CornerRadius.card)
                    .stroke(Theme.Colors.cardBorder, lineWidth: 1)
            )
            .shadow(color: Color.black.opacity(0.3), radius: 8, x: 0, y: 2)
    }
    
    func glowEffect(color: Color = Theme.Colors.primaryAccent) -> some View {
        self
            .shadow(color: color.opacity(0.5), radius: 10)
            .shadow(color: color.opacity(0.3), radius: 20)
    }
    
    func terminalButton() -> some View {
        self
            .foregroundColor(Theme.Colors.terminalForeground)
            .padding(.horizontal, Theme.Spacing.lg)
            .padding(.vertical, Theme.Spacing.md)
            .background(Theme.Colors.primaryAccent.opacity(0.1))
            .cornerRadius(Theme.CornerRadius.medium)
            .overlay(
                RoundedRectangle(cornerRadius: Theme.CornerRadius.medium)
                    .stroke(Theme.Colors.primaryAccent, lineWidth: 1)
            )
    }
}

// MARK: - Haptic Feedback
struct HapticFeedback {
    static func impact(_ style: UIImpactFeedbackGenerator.FeedbackStyle) {
        let generator = UIImpactFeedbackGenerator(style: style)
        generator.impactOccurred()
    }
    
    static func selection() {
        let generator = UISelectionFeedbackGenerator()
        generator.selectionChanged()
    }
    
    static func notification(_ type: UINotificationFeedbackGenerator.FeedbackType) {
        let generator = UINotificationFeedbackGenerator()
        generator.notificationOccurred(type)
    }
}