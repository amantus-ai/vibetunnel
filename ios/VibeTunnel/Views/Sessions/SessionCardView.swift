import SwiftUI

struct SessionCardView: View {
    let session: Session
    let onTap: () -> Void
    let onKill: () -> Void
    let onCleanup: () -> Void
    
    @State private var isPressed = false
    
    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: Theme.Spacing.md) {
                // Header
                HStack {
                    HStack(spacing: Theme.Spacing.sm) {
                        Image(systemName: "terminal")
                            .font(.system(size: 16))
                            .foregroundColor(session.isRunning ? Theme.Colors.primaryAccent : Theme.Colors.terminalForeground.opacity(0.5))
                        
                        Text(session.displayName)
                            .font(Theme.Typography.terminalSystem(size: 16))
                            .fontWeight(.medium)
                            .foregroundColor(Theme.Colors.terminalForeground)
                            .lineLimit(1)
                    }
                    
                    Spacer()
                    
                    statusBadge
                }
                
                // Working Directory
                HStack(spacing: Theme.Spacing.sm) {
                    Image(systemName: "folder")
                        .font(.system(size: 12))
                        .foregroundColor(Theme.Colors.primaryAccent.opacity(0.7))
                    
                    Text(session.workingDir)
                        .font(Theme.Typography.terminalSystem(size: 12))
                        .foregroundColor(Theme.Colors.terminalForeground.opacity(0.7))
                        .lineLimit(1)
                }
                
                // Info Row
                HStack(spacing: Theme.Spacing.lg) {
                    if let pid = session.pid {
                        HStack(spacing: 4) {
                            Text("PID")
                                .font(Theme.Typography.terminalSystem(size: 10))
                                .foregroundColor(Theme.Colors.terminalForeground.opacity(0.5))
                            Text(String(pid))
                                .font(Theme.Typography.terminalSystem(size: 10))
                                .foregroundColor(Theme.Colors.successAccent)
                        }
                    }
                    
                    if let exitCode = session.exitCode {
                        HStack(spacing: 4) {
                            Text("EXIT")
                                .font(Theme.Typography.terminalSystem(size: 10))
                                .foregroundColor(Theme.Colors.terminalForeground.opacity(0.5))
                            Text(String(exitCode))
                                .font(Theme.Typography.terminalSystem(size: 10))
                                .foregroundColor(exitCode == 0 ? Theme.Colors.successAccent : Theme.Colors.errorAccent)
                        }
                    }
                    
                    Spacer()
                    
                    Text(session.formattedStartTime)
                        .font(Theme.Typography.terminalSystem(size: 10))
                        .foregroundColor(Theme.Colors.terminalForeground.opacity(0.5))
                }
            }
            .padding(Theme.Spacing.lg)
            .background(
                RoundedRectangle(cornerRadius: Theme.CornerRadius.card)
                    .fill(Theme.Colors.cardBackground)
                    .shadow(color: Color.black.opacity(0.2), radius: isPressed ? 2 : 6, y: isPressed ? 1 : 3)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Theme.CornerRadius.card)
                    .stroke(session.isRunning ? Theme.Colors.primaryAccent.opacity(0.3) : Theme.Colors.cardBorder, lineWidth: 1)
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
    
    private var statusBadge: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(session.isRunning ? Theme.Colors.successAccent : Theme.Colors.terminalForeground.opacity(0.3))
                .frame(width: 8, height: 8)
                .overlay(
                    Circle()
                        .fill(session.isRunning ? Theme.Colors.successAccent : .clear)
                        .frame(width: 16, height: 16)
                        .blur(radius: 6)
                        .opacity(session.isRunning ? 0.5 : 0)
                )
            
            Text(session.status.rawValue.uppercased())
                .font(Theme.Typography.terminalSystem(size: 10))
                .fontWeight(.medium)
                .foregroundColor(session.isRunning ? Theme.Colors.successAccent : Theme.Colors.terminalForeground.opacity(0.5))
                .tracking(1)
        }
        .padding(.horizontal, Theme.Spacing.sm)
        .padding(.vertical, 4)
        .background(
            Capsule()
                .fill(session.isRunning ? Theme.Colors.successAccent.opacity(0.1) : Theme.Colors.cardBorder.opacity(0.3))
        )
        .overlay(
            Capsule()
                .stroke(session.isRunning ? Theme.Colors.successAccent.opacity(0.3) : Theme.Colors.cardBorder, lineWidth: 1)
        )
    }
}