import SwiftUI

// MARK: - Credit Link Component

/// Credit link component for individual contributors.
///
/// This component displays a contributor's handle as a clickable link
/// that opens their website when clicked.
struct CreditLink: View {
    let name: String
    let url: String
    @State private var isHovering = false

    var body: some View {
        Button(action: {
            if let linkURL = URL(string: url) {
                NSWorkspace.shared.open(linkURL)
            }
        }, label: {
            Text(self.name)
                .font(.caption)
                .underline(self.isHovering, color: .accentColor)
        })
        .buttonStyle(.link)
        .pointingHandCursor()
        .onHover { hovering in
            withAnimation(.easeInOut(duration: 0.2)) {
                self.isHovering = hovering
            }
        }
    }
}
