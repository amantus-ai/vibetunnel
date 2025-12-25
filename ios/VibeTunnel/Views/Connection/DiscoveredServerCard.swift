import SwiftUI

/// Card view for displaying a discovered server
struct DiscoveredServerCard: View {
    let server: DiscoveredServer
    let onTap: () -> Void

    @State private var isPressed = false

    var body: some View {
        HStack(spacing: Theme.Spacing.medium) {
            // Bonjour icon
            Image(systemName: "bonjour")
                .font(.system(size: 24))
                .foregroundColor(Theme.Colors.secondaryAccent)
                .frame(width: 40, height: 40)
                .background(Theme.Colors.secondaryAccent.opacity(0.1))
                .cornerRadius(Theme.CornerRadius.small)

            // Server Info
            VStack(alignment: .leading, spacing: 2) {
                Text(self.server.displayName)
                    .font(Theme.Typography.terminalSystem(size: 16, weight: .medium))
                    .foregroundColor(Theme.Colors.terminalForeground)

                if !self.server.host.isEmpty {
                    Text("\(self.server.host):\(self.server.port)")
                        .font(Theme.Typography.terminalSystem(size: 12))
                        .foregroundColor(Theme.Colors.secondaryText)
                } else {
                    Text("Resolving...")
                        .font(Theme.Typography.terminalSystem(size: 12))
                        .foregroundColor(Theme.Colors.secondaryText.opacity(0.7))
                }

                HStack(spacing: 4) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 10))
                    Text("Discovered locally")
                        .font(Theme.Typography.terminalSystem(size: 11))
                }
                .foregroundColor(Theme.Colors.secondaryAccent)
            }

            Spacer()

            // Connect button
            Button(action: self.onTap) {
                Image(systemName: "plus.circle.fill")
                    .font(.system(size: 24))
                    .foregroundColor(Theme.Colors.primaryAccent)
            }
            .buttonStyle(.plain)
            .disabled(self.server.host.isEmpty)
        }
        .padding(Theme.Spacing.medium)
        .background(
            RoundedRectangle(cornerRadius: Theme.CornerRadius.card)
                .fill(Theme.Colors.cardBackground)
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.CornerRadius.card)
                        .stroke(Theme.Colors.secondaryAccent.opacity(0.3), lineWidth: 1)))
        .scaleEffect(self.isPressed ? 0.98 : 1.0)
        .animation(.easeInOut(duration: 0.1), value: self.isPressed)
        .onTapGesture {
            if !self.server.host.isEmpty {
                self.onTap()
            }
        }
        .simultaneousGesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in self.isPressed = true }
                .onEnded { _ in self.isPressed = false })
    }
}

/// Sheet view for showing all discovered servers
/// Detail sheet displaying comprehensive information about a discovered server.
/// Shows server details including hostname, addresses, and port information.
struct DiscoveryDetailSheet: View {
    let discoveredServers: [DiscoveredServer]
    let onConnect: (DiscoveredServer) -> Void

    @Environment(\.dismiss)
    private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: Theme.Spacing.small) {
                    ForEach(self.discoveredServers) { server in
                        DiscoveredServerCard(
                            server: server)
                        {
                            self.onConnect(server)
                        }
                    }
                }
                .padding()
            }
            .background(Theme.Colors.terminalBackground)
            .navigationTitle("Discovered Servers")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") {
                        self.dismiss()
                    }
                }
            }
        }
    }
}
