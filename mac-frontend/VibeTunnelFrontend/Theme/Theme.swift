import SwiftUI

enum Theme {
    // MARK: - Colors
    enum Colors {
        static let background = Color(nsColor: .windowBackgroundColor)
        static let secondaryBackground = Color(nsColor: .controlBackgroundColor)
        static let tertiaryBackground = Color(nsColor: .underPageBackgroundColor)
        
        static let text = Color(nsColor: .labelColor)
        static let secondaryText = Color(nsColor: .secondaryLabelColor)
        static let tertiaryText = Color(nsColor: .tertiaryLabelColor)
        
        static let accent = Color.accentColor
        static let accentBlue = Color.blue
        static let success = Color.green
        static let warning = Color.orange
        static let error = Color.red
        static let primaryText = Color(nsColor: .labelColor)
        
        static let terminalBackground = Color.black
        static let terminalText = Color(white: 0.9)
        
        // Terminal ANSI colors
        static let ansiBlack = Color(red: 0, green: 0, blue: 0)
        static let ansiRed = Color(red: 0.8, green: 0, blue: 0)
        static let ansiGreen = Color(red: 0, green: 0.8, blue: 0)
        static let ansiYellow = Color(red: 0.8, green: 0.8, blue: 0)
        static let ansiBlue = Color(red: 0, green: 0, blue: 0.8)
        static let ansiMagenta = Color(red: 0.8, green: 0, blue: 0.8)
        static let ansiCyan = Color(red: 0, green: 0.8, blue: 0.8)
        static let ansiWhite = Color(red: 0.8, green: 0.8, blue: 0.8)
        
        // Bright ANSI colors
        static let ansiBrightBlack = Color(red: 0.4, green: 0.4, blue: 0.4)
        static let ansiBrightRed = Color(red: 1, green: 0, blue: 0)
        static let ansiBrightGreen = Color(red: 0, green: 1, blue: 0)
        static let ansiBrightYellow = Color(red: 1, green: 1, blue: 0)
        static let ansiBrightBlue = Color(red: 0, green: 0, blue: 1)
        static let ansiBrightMagenta = Color(red: 1, green: 0, blue: 1)
        static let ansiBrightCyan = Color(red: 0, green: 1, blue: 1)
        static let ansiBrightWhite = Color(red: 1, green: 1, blue: 1)
    }
    
    // MARK: - Spacing
    enum Spacing {
        static let xs: CGFloat = 4
        static let sm: CGFloat = 8
        static let md: CGFloat = 16
        static let lg: CGFloat = 24
        static let xl: CGFloat = 32
        static let xxl: CGFloat = 48
    }
    
    // MARK: - Typography
    enum Typography {
        static let largeTitle = Font.largeTitle
        static let title = Font.title
        static let title2 = Font.title2
        static let title3 = Font.title3
        static let headline = Font.headline
        static let body = Font.body
        static let callout = Font.callout
        static let subheadline = Font.subheadline
        static let footnote = Font.footnote
        static let caption = Font.caption
        static let caption2 = Font.caption2
        static let smallCaption = Font.system(size: 10)
        
        static let terminalFont = Font.custom("SF Mono", size: 13)
            .monospaced()
    }
    
    // MARK: - Animation
    enum Animation {
        static let standard = SwiftUI.Animation.easeInOut(duration: 0.25)
        static let quick = SwiftUI.Animation.easeInOut(duration: 0.15)
        static let slow = SwiftUI.Animation.easeInOut(duration: 0.35)
        static let spring = SwiftUI.Animation.spring(response: 0.3, dampingFraction: 0.8)
    }
    
    // MARK: - Sizes
    enum Sizes {
        static let buttonHeight: CGFloat = 32
        static let textFieldHeight: CGFloat = 28
        static let cornerRadius: CGFloat = 6
        static let cornerRadiusSmall: CGFloat = 4
        static let smallCornerRadius: CGFloat = 4
        static let borderWidth: CGFloat = 1
        static let iconSize: CGFloat = 16
        static let sidebarWidth: CGFloat = 250
        static let minWindowWidth: CGFloat = 1000
        static let minWindowHeight: CGFloat = 700
    }
}

// MARK: - View Modifiers
extension View {
    func terminalStyle() -> some View {
        self
            .font(Theme.Typography.terminalFont)
            .foregroundColor(Theme.Colors.terminalText)
            .background(Theme.Colors.terminalBackground)
    }
    
    func cardStyle() -> some View {
        self
            .background(Theme.Colors.secondaryBackground)
            .cornerRadius(Theme.Sizes.cornerRadius)
            .shadow(color: .black.opacity(0.1), radius: 2, x: 0, y: 1)
    }
    
    func primaryButtonStyle() -> some View {
        self
            .buttonStyle(.borderedProminent)
            .controlSize(.regular)
    }
    
    func secondaryButtonStyle() -> some View {
        self
            .buttonStyle(.bordered)
            .controlSize(.regular)
    }
}