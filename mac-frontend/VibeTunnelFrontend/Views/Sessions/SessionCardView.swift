import SwiftUI

struct SessionCardView: View {
    let session: Session
    let onSelect: () -> Void
    let onKill: () -> Void
    
    @State private var isHovering = false
    @State private var hasActivity = false
    @State private var isKilling = false
    @State private var showKillConfirmation = false
    
    var body: some View {
        Button(action: onSelect) {
            VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                // Header with session name and kill button
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(session.displayName)
                            .font(Theme.Typography.headline)
                            .foregroundStyle(Theme.Colors.accent)
                            .lineLimit(1)
                        
                        // Command
                        HStack(spacing: Theme.Spacing.xs) {
                            Image(systemName: "terminal")
                                .font(Theme.Typography.caption)
                                .foregroundStyle(Theme.Colors.secondaryText)
                            
                            Text(session.command)
                                .font(Theme.Typography.terminalFont)
                                .foregroundStyle(Theme.Colors.secondaryText)
                                .lineLimit(1)
                        }
                    }
                    
                    Spacer()
                    
                    if session.isRunning && isHovering {
                        Button {
                            withAnimation(Theme.Animation.quick) {
                                isKilling = true
                            }
                            onKill()
                            
                            // Reset after animation
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                                isKilling = false
                            }
                        } label: {
                            Image(systemName: isKilling ? "xmark.circle.fill" : "stop.circle.fill")
                                .foregroundStyle(Theme.Colors.error)
                                .rotationEffect(.degrees(isKilling ? 90 : 0))
                                .scaleEffect(isKilling ? 0.8 : 1.0)
                        }
                        .buttonStyle(.plain)
                        .transition(.asymmetric(
                            insertion: .scale.combined(with: .opacity),
                            removal: .scale(scale: 0.5).combined(with: .opacity)
                        ))
                    }
                }
                
                // Terminal preview (larger)
                if session.isRunning {
                    TerminalPreviewView(sessionId: session.id, hasActivity: $hasActivity)
                        .frame(height: 150) // Increased from 100
                        .background(Theme.Colors.terminalBackground)
                        .cornerRadius(Theme.Sizes.cornerRadiusSmall)
                        .overlay(
                            RoundedRectangle(cornerRadius: Theme.Sizes.cornerRadiusSmall)
                                .stroke(
                                    hasActivity ? Theme.Colors.accent.opacity(0.5) : Color.clear,
                                    lineWidth: 2
                                )
                        )
                        .animation(Theme.Animation.quick, value: hasActivity)
                } else {
                    // Show exited state
                    ZStack {
                        Rectangle()
                            .fill(Theme.Colors.terminalBackground.opacity(0.5))
                            .frame(height: 150) // Increased from 100
                            .cornerRadius(Theme.Sizes.cornerRadiusSmall)
                        
                        Text("Session Exited")
                            .font(Theme.Typography.caption)
                            .foregroundStyle(Theme.Colors.secondaryText)
                    }
                }
                
                // Footer with status, PID, and directory
                VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                    // Status row
                    HStack {
                        HStack(spacing: Theme.Spacing.xs) {
                            // Animated status indicator
                            ZStack {
                                Circle()
                                    .fill(session.isRunning ? Theme.Colors.success : Theme.Colors.secondaryText)
                                    .frame(width: 8, height: 8)
                                
                                if session.isRunning {
                                    Circle()
                                        .stroke(Theme.Colors.success.opacity(0.5), lineWidth: 2)
                                        .frame(width: 12, height: 12)
                                        .scaleEffect(1.5)
                                        .opacity(0)
                                        .animation(
                                            Animation.easeOut(duration: 2)
                                                .repeatForever(autoreverses: false),
                                            value: session.isRunning
                                        )
                                }
                            }
                            
                            Text(session.isRunning ? "Running" : "Exited")
                                .font(Theme.Typography.caption)
                                .foregroundStyle(session.isRunning ? Theme.Colors.success : Theme.Colors.secondaryText)
                            
                            // Activity pulse indicator
                            if session.isRunning && hasActivity {
                                Circle()
                                    .fill(Theme.Colors.accent)
                                    .frame(width: 6, height: 6)
                                    .overlay(
                                        Circle()
                                            .stroke(Theme.Colors.accent.opacity(0.3), lineWidth: 4)
                                            .scaleEffect(hasActivity ? 2.5 : 1.0)
                                            .opacity(hasActivity ? 0 : 1)
                                            .animation(
                                                Animation.easeOut(duration: 0.6)
                                                    .repeatCount(1, autoreverses: false),
                                                value: hasActivity
                                            )
                                    )
                                    .transition(.scale.combined(with: .opacity))
                            }
                        }
                        
                        Spacer()
                        
                        // Duration badge
                        if session.isRunning {
                            Text(formatDuration(session.createdAt))
                                .font(Theme.Typography.caption)
                                .foregroundStyle(Theme.Colors.secondaryText)
                                .padding(.horizontal, Theme.Spacing.xs)
                                .padding(.vertical, 2)
                                .background(Theme.Colors.secondaryBackground)
                                .cornerRadius(4)
                                .transition(.scale.combined(with: .opacity))
                        }
                    }
                    
                    // PID and folder row
                    HStack(spacing: Theme.Spacing.md) {
                        // PID if running
                        if session.isRunning, let pid = session.pid {
                            HStack(spacing: Theme.Spacing.xs) {
                                Image(systemName: "number")
                                    .font(.system(size: 10))
                                    .foregroundStyle(Theme.Colors.tertiaryText)
                                
                                Text("PID: \(pid)")
                                    .font(.system(size: 11))
                                    .foregroundStyle(Theme.Colors.tertiaryText)
                                
                                if isHovering {
                                    Button {
                                        NSPasteboard.general.clearContents()
                                        NSPasteboard.general.setString(String(pid), forType: .string)
                                    } label: {
                                        Image(systemName: "doc.on.doc")
                                            .font(.system(size: 10))
                                            .foregroundStyle(Theme.Colors.secondaryText)
                                    }
                                    .buttonStyle(.plain)
                                    .help("Copy PID")
                                    .transition(.scale.combined(with: .opacity))
                                }
                            }
                        }
                        
                        // Working directory
                        HStack(spacing: Theme.Spacing.xs) {
                            Image(systemName: "folder")
                                .font(.system(size: 10))
                                .foregroundStyle(Theme.Colors.tertiaryText)
                            
                            Text(abbreviatedPath(session.cwd))
                                .font(.system(size: 11))
                                .foregroundStyle(Theme.Colors.tertiaryText)
                                .lineLimit(1)
                            
                            if isHovering {
                                Button {
                                    NSPasteboard.general.clearContents()
                                    NSPasteboard.general.setString(session.cwd, forType: .string)
                                } label: {
                                    Image(systemName: "doc.on.doc")
                                        .font(.system(size: 10))
                                        .foregroundStyle(Theme.Colors.secondaryText)
                                }
                                .buttonStyle(.plain)
                                .help("Copy path")
                                .transition(.scale.combined(with: .opacity))
                            }
                        }
                        
                        Spacer()
                    }
                    
                    // Exit code if exited
                    if !session.isRunning, let exitCode = session.exitCode {
                        HStack {
                            Image(systemName: exitCode == 0 ? "checkmark.circle" : "xmark.circle")
                                .font(Theme.Typography.caption)
                                .foregroundStyle(exitCode == 0 ? Theme.Colors.success : Theme.Colors.error)
                            
                            Text("Exit code: \(exitCode)")
                                .font(Theme.Typography.caption)
                                .foregroundStyle(Theme.Colors.tertiaryText)
                        }
                    }
                }
            }
            .padding(Theme.Spacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(isHovering ? Theme.Colors.secondaryBackground : Theme.Colors.background)
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Sizes.cornerRadius)
                    .stroke(
                        isHovering ? Theme.Colors.accent : (hasActivity ? Theme.Colors.accent.opacity(0.3) : Color.clear),
                        lineWidth: Theme.Sizes.borderWidth
                    )
            )
        }
        .buttonStyle(.plain)
        .cardStyle()
        .scaleEffect(isHovering ? 1.02 : 1.0)
        .shadow(
            color: isHovering ? Theme.Colors.accent.opacity(0.1) : Color.black.opacity(0.05),
            radius: isHovering ? 12 : 8,
            x: 0,
            y: isHovering ? 4 : 2
        )
        .animation(Theme.Animation.quick, value: isHovering)
        .onHover { hovering in
            withAnimation(Theme.Animation.quick) {
                isHovering = hovering
            }
        }
    }
    
    private func abbreviatedPath(_ path: String) -> String {
        let homeDirectory = FileManager.default.homeDirectoryForCurrentUser.path
        if path.hasPrefix(homeDirectory) {
            return path.replacingOccurrences(of: homeDirectory, with: "~")
        }
        return path
    }
    
    private func formatDuration(_ startDate: Date) -> String {
        let duration = Date().timeIntervalSince(startDate)
        let hours = Int(duration) / 3600
        let minutes = Int(duration) % 3600 / 60
        let seconds = Int(duration) % 60
        
        if hours > 0 {
            return String(format: "%dh %dm", hours, minutes)
        } else if minutes > 0 {
            return String(format: "%dm %ds", minutes, seconds)
        } else {
            return String(format: "%ds", seconds)
        }
    }
}

#Preview {
    VStack {
        SessionCardView(
            session: Session(
                id: "1",
                name: "Development Server",
                command: "npm run dev",
                cwd: "/Users/user/Projects/app",
                createdAt: Date(),
                status: .running,
                exitCode: nil,
                pid: 12345
            ),
            onSelect: {},
            onKill: {}
        )
        
        SessionCardView(
            session: Session(
                id: "2",
                name: nil,
                command: "python3 script.py",
                cwd: "/Users/user/Desktop",
                createdAt: Date().addingTimeInterval(-3600),
                status: .exited,
                exitCode: 0
            ),
            onSelect: {},
            onKill: {}
        )
    }
    .padding()
    .frame(width: 400)
}