import SwiftUI

struct PrimaryButtonStyle: ButtonStyle {
    var fontSize: CGFloat = 13
    var padding: EdgeInsets = EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16)
    
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: fontSize, weight: .medium))
            .foregroundColor(.white)
            .padding(padding)
            .background(Theme.Colors.accent)
            .cornerRadius(Theme.Sizes.cornerRadius)
            .opacity(configuration.isPressed ? 0.8 : 1.0)
            .scaleEffect(configuration.isPressed ? 0.98 : 1.0)
    }
}

struct SecondaryButtonStyle: ButtonStyle {
    var fontSize: CGFloat = 13
    var padding: EdgeInsets = EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16)
    
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: fontSize, weight: .medium))
            .foregroundColor(Theme.Colors.text)
            .padding(padding)
            .background(Theme.Colors.secondaryBackground)
            .cornerRadius(Theme.Sizes.cornerRadius)
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Sizes.cornerRadius)
                    .stroke(Theme.Colors.tertiaryText.opacity(0.2), lineWidth: 1)
            )
            .opacity(configuration.isPressed ? 0.8 : 1.0)
            .scaleEffect(configuration.isPressed ? 0.98 : 1.0)
    }
}

struct GhostButtonStyle: ButtonStyle {
    var fontSize: CGFloat = 13
    var padding: EdgeInsets = EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16)
    
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: fontSize, weight: .medium))
            .foregroundColor(Theme.Colors.secondaryText)
            .padding(padding)
            .background(configuration.isPressed ? Theme.Colors.secondaryBackground.opacity(0.5) : Color.clear)
            .cornerRadius(Theme.Sizes.cornerRadius)
            .opacity(configuration.isPressed ? 0.8 : 1.0)
    }
}

// Extension for convenience
extension View {
    func primaryButtonStyle(fontSize: CGFloat = 13, padding: EdgeInsets = EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16)) -> some View {
        self.buttonStyle(PrimaryButtonStyle(fontSize: fontSize, padding: padding))
    }
    
    func secondaryButtonStyle(fontSize: CGFloat = 13, padding: EdgeInsets = EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16)) -> some View {
        self.buttonStyle(SecondaryButtonStyle(fontSize: fontSize, padding: padding))
    }
    
    func ghostButtonStyle(fontSize: CGFloat = 13, padding: EdgeInsets = EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16)) -> some View {
        self.buttonStyle(GhostButtonStyle(fontSize: fontSize, padding: padding))
    }
}