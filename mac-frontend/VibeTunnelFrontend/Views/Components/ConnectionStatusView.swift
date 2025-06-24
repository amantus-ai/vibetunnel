import SwiftUI

struct ConnectionStatusView: View {
    @Environment(ConnectionManager.self) private var connectionManager
    @State private var isHovering = false
    
    var body: some View {
        HStack(spacing: Theme.Spacing.xs) {
            Circle()
                .fill(connectionManager.isConnected ? Theme.Colors.success : Theme.Colors.secondaryText)
                .frame(width: 8, height: 8)
                .overlay(
                    Circle()
                        .fill(connectionManager.isConnected ? Theme.Colors.success.opacity(0.3) : Color.clear)
                        .frame(width: 12, height: 12)
                        .scaleEffect(connectionManager.isConnecting ? 1.2 : 1.0)
                        .animation(connectionManager.isConnecting ? .easeInOut(duration: 0.8).repeatForever(autoreverses: true) : .default, value: connectionManager.isConnecting)
                )
            
            if isHovering || connectionManager.isConnecting {
                VStack(alignment: .leading, spacing: 0) {
                    Text(statusText)
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Colors.primaryText)
                    
                    if let serverURL = connectionManager.serverURL {
                        Text(serverURL.host ?? serverURL.absoluteString)
                            .font(Theme.Typography.smallCaption)
                            .foregroundStyle(Theme.Colors.secondaryText)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                }
                .transition(.asymmetric(
                    insertion: .move(edge: .leading).combined(with: .opacity),
                    removal: .move(edge: .trailing).combined(with: .opacity)
                ))
            }
        }
        .padding(.horizontal, Theme.Spacing.sm)
        .padding(.vertical, Theme.Spacing.xs)
        .background(
            RoundedRectangle(cornerRadius: Theme.Sizes.smallCornerRadius)
                .fill(Theme.Colors.secondaryBackground.opacity(isHovering ? 1 : 0))
        )
        .onHover { hovering in
            withAnimation(.easeInOut(duration: 0.2)) {
                isHovering = hovering
            }
        }
        .help(helpText)
    }
    
    private var statusText: String {
        if connectionManager.isConnecting {
            return "Connecting..."
        } else if connectionManager.isConnected {
            return "Connected"
        } else {
            return "Disconnected"
        }
    }
    
    private var helpText: String {
        if let error = connectionManager.error {
            return "Connection failed: \(error.localizedDescription)"
        } else if let serverURL = connectionManager.serverURL {
            return "Connected to \(serverURL.absoluteString)"
        } else {
            return "Not connected to any server"
        }
    }
}

#Preview {
    HStack {
        ConnectionStatusView()
            .environment(ConnectionManager())
        
        ConnectionStatusView()
            .environment({
                let manager = ConnectionManager()
                manager.serverURL = URL(string: "http://localhost:4020")
                return manager
            }())
    }
    .padding()
}