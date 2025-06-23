import SwiftUI

// MARK: - View Extensions

extension View {
    /// Applies standard padding used throughout the app.
    ///
    /// - Parameters:
    ///   - horizontal: Horizontal padding (default: 16)
    ///   - vertical: Vertical padding (default: 14)
    public func standardPadding(
        horizontal: CGFloat = 16,
        vertical: CGFloat = 14
    )
        -> some View
    {
        self
            .padding(.horizontal, horizontal)
            .padding(.vertical, vertical)
    }
}

// MARK: - Previews

#Preview("Standard Padding") {
    VStack(spacing: 16) {
        HStack {
            Text("Default Padding")
            Spacer()
            Text("16pt H, 14pt V")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .standardPadding()
        .background(Color.blue.opacity(0.1))

        HStack {
            Text("Custom Padding")
            Spacer()
            Text("24pt H, 20pt V")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .standardPadding(horizontal: 24, vertical: 20)
        .background(Color.green.opacity(0.1))
    }
    .padding()
    .frame(width: 400)
    .background(Color(NSColor.windowBackgroundColor))
}
