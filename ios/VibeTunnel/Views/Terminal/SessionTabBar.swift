import SwiftUI

/// Custom session tab bar for the terminal view.
///
/// Replaces SwiftUI's NavigationStack toolbar with a Termius-style
/// session bar showing back navigation, session name, and quick actions.
struct SessionTabBar<MenuContent: View>: View {
    let sessionName: String
    let onBack: () -> Void
    let onFileBrowser: () -> Void
    let onSessionGrid: () -> Void
    @ViewBuilder let menuContent: () -> MenuContent

    var body: some View {
        HStack(spacing: Theme.Spacing.medium) {
            // Back button
            Button(action: {
                HapticFeedback.impact(.light)
                self.onBack()
            }, label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 18, weight: .medium))
                    .foregroundColor(Theme.Colors.primaryAccent)
                    .frame(width: 44, height: 44)
            })

            Spacer()

            // Session name with icon
            HStack(spacing: Theme.Spacing.small) {
                Image(systemName: "terminal")
                    .font(.system(size: 12))
                    .foregroundColor(Theme.Colors.secondaryText)

                Text(self.sessionName)
                    .font(Theme.Typography.terminalSystem(size: 14, weight: .semibold))
                    .foregroundColor(Theme.Colors.terminalForeground)
                    .lineLimit(1)
            }

            Spacer()

            // Action buttons
            HStack(spacing: Theme.Spacing.extraSmall) {
                // File browser
                TabBarButton(systemImage: "folder") {
                    self.onFileBrowser()
                }

                // Menu (three dots)
                Menu {
                    self.menuContent()
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(Theme.Colors.primaryAccent)
                        .frame(width: 36, height: 36)
                        .background(
                            RoundedRectangle(cornerRadius: Theme.CornerRadius.small)
                                .fill(Theme.Colors.cardBackground))
                }

                // Session grid
                TabBarButton(systemImage: "square.grid.2x2") {
                    self.onSessionGrid()
                }
            }
        }
        .padding(.horizontal, Theme.Spacing.small)
        .padding(.vertical, Theme.Spacing.extraSmall)
        .background(Theme.Colors.headerBackground)
        .overlay(
            Rectangle()
                .fill(Theme.Colors.cardBorder)
                .frame(height: 1),
            alignment: .bottom)
    }
}

/// Button component for the session tab bar.
private struct TabBarButton: View {
    let systemImage: String
    let action: () -> Void

    var body: some View {
        Button(action: {
            HapticFeedback.impact(.light)
            self.action()
        }, label: {
            Image(systemName: self.systemImage)
                .font(.system(size: 16, weight: .medium))
                .foregroundColor(Theme.Colors.primaryAccent)
                .frame(width: 36, height: 36)
                .background(
                    RoundedRectangle(cornerRadius: Theme.CornerRadius.small)
                        .fill(Theme.Colors.cardBackground))
        })
    }
}

#Preview {
    VStack {
        SessionTabBar(
            sessionName: "fish - my-session",
            onBack: {},
            onFileBrowser: {},
            onSessionGrid: {},
            menuContent: {
                Button("Clear") {}
                Button("Settings") {}
            })
        Spacer()
    }
    .background(Theme.Colors.terminalBackground)
}
