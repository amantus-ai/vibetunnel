import SwiftUI

/// Card component displaying session information in the list.
///
/// Shows session details including status, command, working directory,
/// and provides quick actions for managing the session.
struct SessionCardView: View {
    let session: Session
    let onTap: () -> Void
    let onKill: () -> Void
    let onCleanup: () -> Void

    @State private var isPressed = false
    @State private var isKilling = false
    @State private var opacity: Double = 1.0
    @State private var scale: CGFloat = 1.0
    @State private var rotation: Double = 0
    @State private var brightness: Double = 1.0

    @Environment(\.livePreviewSubscription) private var livePreview

    private var displayWorkingDir: String {
        // Convert absolute paths back to ~ notation for display
        let homePrefix = "/Users/"
        if session.workingDir.hasPrefix(homePrefix),
           let userEndIndex = session.workingDir[homePrefix.endIndex...].firstIndex(of: "/")
        {
            let restOfPath = String(session.workingDir[userEndIndex...])
            return "~\(restOfPath)"
        }
        return session.workingDir
    }

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: Theme.Spacing.medium) {
                // Header with session ID/name and kill button
                HStack {
                    Text(session.displayName)
                        .font(Theme.Typography.terminalSystem(size: 14))
                        .fontWeight(.medium)
                        .foregroundColor(Theme.Colors.primaryAccent)
                        .lineLimit(1)

                    Spacer()

                    Button(action: {
                        HapticFeedback.impact(.medium)
                        if session.isRunning {
                            animateKill()
                        } else {
                            animateCleanup()
                        }
                    }, label: {
                        if isKilling {
                            LoadingView(message: "", useUnicodeSpinner: true)
                                .scaleEffect(0.7)
                                .frame(width: 18, height: 18)
                        } else {
                            Image(systemName: session.isRunning ? "xmark.circle" : "trash.circle")
                                .font(.system(size: 18))
                                .foregroundColor(session.isRunning ? Theme.Colors.errorAccent : Theme.Colors
                                    .terminalForeground.opacity(0.6)
                                )
                        }
                    })
                    .buttonStyle(.plain)
                }

                // Terminal content area showing command and terminal output preview
                RoundedRectangle(cornerRadius: Theme.CornerRadius.small)
                    .fill(Theme.Colors.terminalBackground)
                    .frame(height: 120)
                    .overlay(
                        Group {
                            if session.isRunning {
                                // Show live preview if available
                                if let bufferSnapshot = livePreview?.latestSnapshot {
                                    CompactTerminalPreview(snapshot: bufferSnapshot)
                                        .animation(.easeInOut(duration: 0.2), value: bufferSnapshot.cursorY)
                                } else {
                                    // Show command and working directory info as fallback
                                    commandInfoView
                                }
                            } else {
                                // For exited sessions, show session info
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("Session exited")
                                        .font(Theme.Typography.terminalSystem(size: 12))
                                        .foregroundColor(Theme.Colors.errorAccent)
                                    
                                    Text("Exit code: \(session.exitCode ?? 0)")
                                        .font(Theme.Typography.terminalSystem(size: 10))
                                        .foregroundColor(Theme.Colors.terminalForeground.opacity(0.6))
                                }
                                .padding(Theme.Spacing.small)
                                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                            }
                        }
                    )

                // Status bar at bottom
                HStack(spacing: Theme.Spacing.small) {
                    // Status indicator
                    HStack(spacing: 4) {
                        Circle()
                            .fill(session.isRunning ? Theme.Colors.successAccent : Theme.Colors.terminalForeground
                                .opacity(0.3)
                            )
                            .frame(width: 6, height: 6)
                        Text(session.isRunning ? "running" : "exited")
                            .font(Theme.Typography.terminalSystem(size: 10))
                            .foregroundColor(session.isRunning ? Theme.Colors.successAccent : Theme.Colors
                                .terminalForeground.opacity(0.5)
                            )

                        // Live preview indicator
                        if session.isRunning && livePreview?.latestSnapshot != nil {
                            HStack(spacing: 2) {
                                Image(systemName: "dot.radiowaves.left.and.right")
                                    .font(.system(size: 8))
                                    .foregroundColor(Theme.Colors.primaryAccent)
                                    .symbolEffect(.pulse)
                                Text("live")
                                    .font(Theme.Typography.terminalSystem(size: 9))
                                    .foregroundColor(Theme.Colors.primaryAccent)
                            }
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(
                                Capsule()
                                    .fill(Theme.Colors.primaryAccent.opacity(0.1))
                            )
                        }
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
            .padding(Theme.Spacing.medium)
            .background(
                RoundedRectangle(cornerRadius: Theme.CornerRadius.card)
                    .fill(Theme.Colors.cardBackground)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Theme.CornerRadius.card)
                    .stroke(Theme.Colors.cardBorder, lineWidth: 1)
            )
            .scaleEffect(isPressed ? 0.98 : scale)
            .opacity(opacity)
            .rotationEffect(.degrees(rotation))
            .brightness(brightness)
        }
        .buttonStyle(.plain)
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
                Button(action: animateKill) {
                    Label("Kill Session", systemImage: "stop.circle")
                }
            } else {
                Button(action: animateCleanup) {
                    Label("Clean Up", systemImage: "trash")
                }
            }
        }
    }


    private func animateKill() {
        guard !isKilling else { return }
        isKilling = true

        // Shake animation
        withAnimation(.linear(duration: 0.05).repeatCount(4, autoreverses: true)) {
            scale = 0.97
        }

        // Fade out after shake
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            withAnimation(.easeOut(duration: 0.3)) {
                opacity = 0.5
                scale = 0.95
            }
            onKill()

            // Reset after a delay
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                isKilling = false
                withAnimation(.easeIn(duration: 0.2)) {
                    opacity = 1.0
                    scale = 1.0
                }
            }
        }
    }

    private func animateCleanup() {
        // Black hole collapse animation matching web
        withAnimation(.easeInOut(duration: 0.3)) {
            scale = 0
            rotation = 360
            brightness = 0.3
            opacity = 0
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            onCleanup()
            // Reset values for potential reuse
            scale = 1.0
            rotation = 0
            brightness = 1.0
            opacity = 1.0
        }
    }

    // MARK: - View Components

    @ViewBuilder
    private var commandInfoView: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 4) {
                Text("$")
                    .font(Theme.Typography.terminalSystem(size: 12))
                    .foregroundColor(Theme.Colors.primaryAccent)
                Text(session.command.joined(separator: " "))
                    .font(Theme.Typography.terminalSystem(size: 12))
                    .foregroundColor(Theme.Colors.terminalForeground)
            }

            Text(displayWorkingDir)
                .font(Theme.Typography.terminalSystem(size: 10))
                .foregroundColor(Theme.Colors.terminalForeground.opacity(0.6))
                .lineLimit(1)
                .onTapGesture {
                    UIPasteboard.general.string = session.workingDir
                    HapticFeedback.notification(.success)
                }
        }
        .padding(Theme.Spacing.small)
    }

}
