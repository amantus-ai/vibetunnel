import SwiftUI

/// Quick font size adjustment buttons
struct QuickFontSizeButtons: View {
    @Binding var fontSize: CGFloat
    let minSize: CGFloat = 8
    let maxSize: CGFloat = 32

    var body: some View {
        HStack(spacing: 0) {
            // Decrease button
            Button(action: self.decreaseFontSize) {
                Image(systemName: "minus")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(
                        self.fontSize > self.minSize ? Theme.Colors.primaryAccent : Theme.Colors.secondaryText
                            .opacity(0.5))
                    .frame(width: 30, height: 30)
                    .background(Theme.Colors.cardBackground)
                    .overlay(
                        RoundedRectangle(cornerRadius: Theme.CornerRadius.small)
                            .stroke(Theme.Colors.cardBorder, lineWidth: 1))
            }
            .disabled(self.fontSize <= self.minSize)

            // Current size display
            Text("\(Int(self.fontSize))")
                .font(Theme.Typography.terminalSystem(size: 12, weight: .medium))
                .foregroundColor(Theme.Colors.terminalForeground)
                .frame(width: 32)
                .overlay(
                    VStack(spacing: 0) {
                        Divider()
                            .background(Theme.Colors.cardBorder)
                        Spacer()
                        Divider()
                            .background(Theme.Colors.cardBorder)
                    })

            // Increase button
            Button(action: self.increaseFontSize) {
                Image(systemName: "plus")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(
                        self.fontSize < self.maxSize ? Theme.Colors.primaryAccent : Theme.Colors.secondaryText
                            .opacity(0.5))
                    .frame(width: 30, height: 30)
                    .background(Theme.Colors.cardBackground)
                    .overlay(
                        RoundedRectangle(cornerRadius: Theme.CornerRadius.small)
                            .stroke(Theme.Colors.cardBorder, lineWidth: 1))
            }
            .disabled(self.fontSize >= self.maxSize)
        }
        .background(Theme.Colors.cardBackground)
        .cornerRadius(Theme.CornerRadius.small)
        .shadow(color: Theme.CardShadow.color, radius: 2, y: 1)
    }

    private func decreaseFontSize() {
        self.fontSize = max(self.minSize, self.fontSize - 1)
        HapticFeedback.impact(.light)
    }

    private func increaseFontSize() {
        self.fontSize = min(self.maxSize, self.fontSize + 1)
        HapticFeedback.impact(.light)
    }
}

// MARK: - Preview

#Preview {
    QuickFontSizeButtons(fontSize: .constant(14))
        .padding()
        .background(Theme.Colors.terminalBackground)
}
