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
    @State private var brightness: Double = 0

    @Environment(\.livePreviewSubscription)
    private var livePreview

    private var displayWorkingDir: String {
        // Convert absolute paths back to ~ notation for display
        let homePrefix = "/Users/"
        if self.session.workingDir.hasPrefix(homePrefix),
           let userEndIndex = session.workingDir[homePrefix.endIndex...].firstIndex(of: "/")
        {
            let restOfPath = String(session.workingDir[userEndIndex...])
            return "~\(restOfPath)"
        }
        return self.session.workingDir
    }

    var body: some View {
        Button(action: self.onTap) {
            VStack(alignment: .leading, spacing: Theme.Spacing.medium) {
                // Header with session ID/name and kill button
                HStack {
                    Text(self.session.displayName)
                        .font(Theme.Typography.terminalSystem(size: 14))
                        .fontWeight(.medium)
                        .foregroundColor(Theme.Colors.primaryAccent)
                        .lineLimit(1)

                    Spacer()

                    Button(action: {
                        HapticFeedback.impact(.medium)
                        if self.session.isRunning {
                            self.animateKill()
                        } else {
                            self.animateCleanup()
                        }
                    }, label: {
                        if self.isKilling {
                            LoadingView(message: "", useUnicodeSpinner: true)
                                .scaleEffect(0.7)
                                .frame(width: 18, height: 18)
                        } else {
                            Image(systemName: self.session.isRunning ? "xmark.circle" : "trash.circle")
                                .font(.system(size: 18))
                                .foregroundColor(
                                    self.session.isRunning ? Theme.Colors.errorAccent : Theme.Colors
                                        .terminalForeground.opacity(0.6))
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
                            if self.session.isRunning {
                                // Show live preview if available
                                if let bufferSnapshot = livePreview?.latestSnapshot {
                                    CompactTerminalPreview(snapshot: bufferSnapshot)
                                        .animation(.easeInOut(duration: 0.2), value: bufferSnapshot.cursorY)
                                } else {
                                    // Show command and working directory info as fallback
                                    self.commandInfoView
                                }
                            } else {
                                // For exited sessions, show session info
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("Session exited")
                                        .font(Theme.Typography.terminalSystem(size: 12))
                                        .foregroundColor(Theme.Colors.errorAccent)

                                    Text("Exit code: \(self.session.exitCode ?? 0)")
                                        .font(Theme.Typography.terminalSystem(size: 10))
                                        .foregroundColor(Theme.Colors.terminalForeground.opacity(0.6))
                                }
                                .padding(Theme.Spacing.small)
                                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                            }
                        })

                // Status bar at bottom
                HStack(spacing: Theme.Spacing.small) {
                    // Status indicator
                    HStack(spacing: 4) {
                        Circle()
                            .fill(
                                self.session.isRunning ? Theme.Colors.successAccent : Theme.Colors.terminalForeground
                                    .opacity(0.3))
                            .frame(width: 6, height: 6)
                        Text(self.session.isRunning ? "running" : "exited")
                            .font(Theme.Typography.terminalSystem(size: 10))
                            .foregroundColor(
                                self.session.isRunning ? Theme.Colors.successAccent : Theme.Colors
                                    .terminalForeground.opacity(0.5))

                        // Live preview indicator
                        if self.session.isRunning, self.livePreview?.latestSnapshot != nil {
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
                                    .fill(Theme.Colors.primaryAccent.opacity(0.1)))
                        }
                    }

                    Spacer()

                    // PID info
                    if self.session.isRunning, let pid = session.pid {
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
                    .fill(Theme.Colors.cardBackground))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.CornerRadius.card)
                    .stroke(Theme.Colors.cardBorder, lineWidth: 1))
            .scaleEffect(self.isPressed ? 0.98 : self.scale)
            .opacity(self.opacity)
            .rotationEffect(.degrees(self.rotation))
            .brightness(self.brightness)
        }
        .buttonStyle(.plain)
        .onLongPressGesture(
            minimumDuration: 0.1,
            maximumDistance: .infinity,
            pressing: { pressing in
                withAnimation(Theme.Animation.quick) {
                    self.isPressed = pressing
                }
            },
            perform: {})
        .contextMenu {
            if self.session.isRunning {
                Button(action: self.animateKill) {
                    Label("Kill Session", systemImage: "stop.circle")
                }
            } else {
                Button(action: self.animateCleanup) {
                    Label("Clean Up", systemImage: "trash")
                }
            }
        }
    }

    private func animateKill() {
        guard !self.isKilling else { return }
        self.isKilling = true

        // Shake animation
        withAnimation(.linear(duration: 0.05).repeatCount(4, autoreverses: true)) {
            self.scale = 0.97
        }

        // Fade out after shake
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            withAnimation(.easeOut(duration: 0.3)) {
                self.opacity = 0.5
                self.scale = 0.95
            }
            self.onKill()

            // Reset after a delay
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                self.isKilling = false
                withAnimation(.easeIn(duration: 0.2)) {
                    self.opacity = 1.0
                    self.scale = 1.0
                }
            }
        }
    }

    private func animateCleanup() {
        // Black hole collapse animation matching web
        withAnimation(.easeInOut(duration: 0.3)) {
            self.scale = 0
            self.rotation = 360
            self.brightness = 0.3
            self.opacity = 0
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            self.onCleanup()
            // Reset values for potential reuse
            self.scale = 1.0
            self.rotation = 0
            self.brightness = 1.0
            self.opacity = 1.0
        }
    }

    // MARK: - View Components

    @ViewBuilder private var commandInfoView: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 4) {
                Text("$")
                    .font(Theme.Typography.terminalSystem(size: 12))
                    .foregroundColor(Theme.Colors.primaryAccent)
                Text(self.session.command.joined(separator: " "))
                    .font(Theme.Typography.terminalSystem(size: 12))
                    .foregroundColor(Theme.Colors.terminalForeground)
            }

            Text(self.displayWorkingDir)
                .font(Theme.Typography.terminalSystem(size: 10))
                .foregroundColor(Theme.Colors.terminalForeground.opacity(0.6))
                .lineLimit(1)
                .onTapGesture {
                    UIPasteboard.general.string = self.session.workingDir
                    HapticFeedback.notification(.success)
                }
        }
        .padding(Theme.Spacing.small)
    }
}
