import SwiftUI

/// Placeholder view shown when no sessions are active.
///
/// Displays a friendly message with an animated terminal icon
/// and optional link to open the dashboard when the server is running.
struct EmptySessionsView: View {
    @Environment(ServerManager.self)
    var serverManager
    @Environment(\.colorScheme)
    private var colorScheme
    @State private var isAnimating = false

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "terminal")
                .font(.system(size: 32))
                .foregroundStyle(
                    LinearGradient(
                        colors: [
                            AppColors.Fallback.secondaryText(for: colorScheme),
                            AppColors.Fallback.secondaryText(for: colorScheme).opacity(0.6)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .scaleEffect(isAnimating ? 1.05 : 1.0)
                .animation(.easeInOut(duration: 2).repeatForever(autoreverses: true), value: isAnimating)
                .onAppear { isAnimating = true }

            Text("No active sessions")
                .font(.system(size: 12))
                .foregroundColor(.secondary)

            if serverManager.isRunning {
                Button("Open Dashboard") {
                    if let url = DashboardURLBuilder.dashboardURL(port: serverManager.port) {
                        NSWorkspace.shared.open(url)
                    }
                }
                .buttonStyle(.link)
                .font(.system(size: 11))
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 20)
    }
}
