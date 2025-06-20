import SwiftUI

struct SessionCardView: View {
    let session: Session
    let onTap: () -> Void
    let onKill: () -> Void
    let onCleanup: () -> Void
    
    @State private var isPressed = false
    
    private var displayWorkingDir: String {
        // Convert absolute paths back to ~ notation for display
        let homePrefix = "/Users/"
        if session.workingDir.hasPrefix(homePrefix),
           let userEndIndex = session.workingDir[homePrefix.endIndex...].firstIndex(of: "/") {
            let restOfPath = String(session.workingDir[userEndIndex...])
            return "~\(restOfPath)"
        }
        return session.workingDir
    }
    
    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: Theme.Spacing.md) {
                // Header with session ID/name and kill button
                HStack {
                    Text(session.name ?? String(session.id.prefix(8)))
                        .font(Theme.Typography.terminalSystem(size: 14))
                        .fontWeight(.medium)
                        .foregroundColor(Theme.Colors.primaryAccent)
                        .lineLimit(1)
                    
                    Spacer()
                    
                    Button(action: {
                        HapticFeedback.impact(.medium)
                        if session.isRunning {
                            onKill()
                        } else {
                            onCleanup()
                        }
                    }) {
                        Text(session.isRunning ? "kill" : "clean")
                            .font(Theme.Typography.terminalSystem(size: 12))
                            .foregroundColor(Theme.Colors.terminalForeground)
                            .padding(.horizontal, Theme.Spacing.sm)
                            .padding(.vertical, 4)
                            .background(
                                RoundedRectangle(cornerRadius: Theme.CornerRadius.small)
                                    .stroke(Theme.Colors.cardBorder, lineWidth: 1)
                            )
                    }
                    .buttonStyle(PlainButtonStyle())
                }
                
                // Terminal content area showing command and working directory
                RoundedRectangle(cornerRadius: Theme.CornerRadius.small)
                    .fill(Theme.Colors.terminalBackground)
                    .frame(height: 120)
                    .overlay(
                        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                            if session.isRunning {
                                // Show command and working directory info
                                VStack(alignment: .leading, spacing: 4) {
                                    HStack(spacing: 4) {
                                        Text("$")
                                            .font(Theme.Typography.terminalSystem(size: 12))
                                            .foregroundColor(Theme.Colors.primaryAccent)
                                        Text(session.command)
                                            .font(Theme.Typography.terminalSystem(size: 12))
                                            .foregroundColor(Theme.Colors.terminalForeground)
                                    }
                                    
                                    Text(displayWorkingDir)
                                        .font(Theme.Typography.terminalSystem(size: 10))
                                        .foregroundColor(Theme.Colors.terminalForeground.opacity(0.6))
                                        .lineLimit(1)
                                }
                                .padding(Theme.Spacing.sm)
                                
                                Spacer()
                            } else {
                                Text("Session exited")
                                    .font(Theme.Typography.terminalSystem(size: 12))
                                    .foregroundColor(Theme.Colors.terminalForeground.opacity(0.5))
                                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                            }
                        }
                    )
                
                // Status bar at bottom
                HStack(spacing: Theme.Spacing.sm) {
                    // Status indicator
                    HStack(spacing: 4) {
                        Circle()
                            .fill(session.isRunning ? Theme.Colors.successAccent : Theme.Colors.terminalForeground.opacity(0.3))
                            .frame(width: 6, height: 6)
                        Text(session.isRunning ? "running" : "exited")
                            .font(Theme.Typography.terminalSystem(size: 10))
                            .foregroundColor(session.isRunning ? Theme.Colors.successAccent : Theme.Colors.terminalForeground.opacity(0.5))
                    }
                    
                    Spacer()
                    
                    // PID info
                    if session.isRunning, let pid = session.pid {
                        Text("PID: \(pid)")
                            .font(Theme.Typography.terminalSystem(size: 10))
                            .foregroundColor(Theme.Colors.terminalForeground.opacity(0.5))
                            .onTapGesture {
                                UIPasteboard.general.string = String(pid)
                                HapticFeedback.notification(.success)
                            }
                    }
                }
            }
            .padding(Theme.Spacing.md)
            .background(
                RoundedRectangle(cornerRadius: Theme.CornerRadius.card)
                    .fill(Theme.Colors.cardBackground)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Theme.CornerRadius.card)
                    .stroke(Theme.Colors.cardBorder, lineWidth: 1)
            )
            .scaleEffect(isPressed ? 0.98 : 1.0)
        }
        .buttonStyle(PlainButtonStyle())
        .onLongPressGesture(
            minimumDuration: 0.1,
            maximumDistance: .infinity,
            pressing: { pressing in
                withAnimation(Theme.Animation.quick) {
                    isPressed = pressing
                }
            },
            perform: {}
        )
        .contextMenu {
            if session.isRunning {
                Button(action: onKill) {
                    Label("Kill Session", systemImage: "stop.circle")
                }
            } else {
                Button(action: onCleanup) {
                    Label("Clean Up", systemImage: "trash")
                }
            }
        }
    }
}