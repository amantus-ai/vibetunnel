import SwiftUI

struct EmptyStateAction {
    let title: String
    let action: () -> Void
}

struct EmptyStateView: View {
    let title: String
    let message: String
    let systemImage: String
    let action: EmptyStateAction?
    
    init(
        title: String,
        message: String,
        systemImage: String,
        action: EmptyStateAction? = nil
    ) {
        self.title = title
        self.message = message
        self.systemImage = systemImage
        self.action = action
    }
    
    var body: some View {
        VStack(spacing: Theme.Spacing.lg) {
            Image(systemName: systemImage)
                .font(.system(size: 64))
                .foregroundStyle(Theme.Colors.tertiaryText)
                .symbolRenderingMode(.hierarchical)
            
            VStack(spacing: Theme.Spacing.sm) {
                Text(title)
                    .font(Theme.Typography.title2)
                    .foregroundStyle(Theme.Colors.text)
                
                Text(message)
                    .font(Theme.Typography.body)
                    .foregroundStyle(Theme.Colors.secondaryText)
                    .multilineTextAlignment(.center)
            }
            
            if let action {
                Button(action.title, action: action.action)
                    .primaryButtonStyle()
            }
        }
        .padding(Theme.Spacing.xxl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

#Preview {
    EmptyStateView(
        title: "No Sessions",
        message: "Create a new session to get started",
        systemImage: "terminal",
        action: EmptyStateAction(
            title: "New Session",
            action: {}
        )
    )
}