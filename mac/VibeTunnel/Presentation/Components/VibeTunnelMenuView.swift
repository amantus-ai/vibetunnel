import AppKit
import SwiftUI

/// Main menu view displayed when left-clicking the status bar item.
/// Shows server status, session list, and quick actions in a rich interface.
struct VibeTunnelMenuView: View {
    @Environment(SessionMonitor.self)
    var sessionMonitor
    @Environment(ServerManager.self)
    var serverManager
    @Environment(NgrokService.self)
    var ngrokService
    @Environment(TailscaleService.self)
    var tailscaleService
    @Environment(\.openWindow)
    private var openWindow

    @State private var hoveredSessionId: String?
    @State private var hasStartedKeyboardNavigation = false
    @FocusState private var focusedField: FocusField?

    enum FocusField: Hashable {
        case sessionRow(String)
        case settingsButton
        case quitButton
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header with server info
            ServerInfoHeader()
                .padding()
                .background(
                    LinearGradient(
                        colors: [
                            Color(NSColor.controlBackgroundColor).opacity(0.6),
                            Color(NSColor.controlBackgroundColor).opacity(0.3)
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )

            Divider()

            // Session list
            ScrollView {
                VStack(spacing: 1) {
                    if activeSessions.isEmpty && idleSessions.isEmpty {
                        EmptySessionsView()
                            .padding()
                            .transition(.opacity.combined(with: .scale(scale: 0.95)))
                    } else {
                        // Active sessions section
                        if !activeSessions.isEmpty {
                            SessionSectionHeader(title: "Active", count: activeSessions.count)
                                .transition(.opacity)
                            ForEach(activeSessions, id: \.key) { session in
                                SessionRow(
                                    session: session,
                                    isHovered: hoveredSessionId == session.key,
                                    isActive: true,
                                    isFocused: focusedField == .sessionRow(session.key) && hasStartedKeyboardNavigation
                                )
                                .onHover { hovering in
                                    hoveredSessionId = hovering ? session.key : nil
                                }
                                .focused($focusedField, equals: .sessionRow(session.key))
                                .transition(.asymmetric(
                                    insertion: .opacity.combined(with: .move(edge: .top)),
                                    removal: .opacity.combined(with: .move(edge: .bottom))
                                ))
                            }
                        }

                        // Idle sessions section
                        if !idleSessions.isEmpty {
                            if !activeSessions.isEmpty {
                                Divider()
                                    .padding(.vertical, 4)
                                    .transition(.opacity)
                            }

                            SessionSectionHeader(title: "Idle", count: idleSessions.count)
                                .transition(.opacity)
                            ForEach(idleSessions, id: \.key) { session in
                                SessionRow(
                                    session: session,
                                    isHovered: hoveredSessionId == session.key,
                                    isActive: false,
                                    isFocused: focusedField == .sessionRow(session.key) && hasStartedKeyboardNavigation
                                )
                                .onHover { hovering in
                                    hoveredSessionId = hovering ? session.key : nil
                                }
                                .focused($focusedField, equals: .sessionRow(session.key))
                                .transition(.asymmetric(
                                    insertion: .opacity.combined(with: .move(edge: .bottom)),
                                    removal: .opacity.combined(with: .move(edge: .top))
                                ))
                            }
                        }
                    }
                }
                .padding(.vertical, 4)
                .animation(.easeInOut(duration: 0.3), value: activeSessions.map(\.key))
                .animation(.easeInOut(duration: 0.3), value: idleSessions.map(\.key))
            }
            .frame(maxHeight: 400)

            Divider()

            // Bottom actions
            HStack {
                Button(action: {
                    SettingsOpener.openSettings()
                }) {
                    Label("Settings", systemImage: "gear")
                        .font(.system(size: 12))
                }
                .buttonStyle(.plain)
                .foregroundColor(.secondary)
                .focusable()
                .focused($focusedField, equals: .settingsButton)
                .overlay(
                    RoundedRectangle(cornerRadius: 4)
                        .strokeBorder(
                            focusedField == .settingsButton && hasStartedKeyboardNavigation ? Color.accentColor
                                .opacity(0.3) : Color.clear,
                            lineWidth: 1
                        )
                        .animation(.easeInOut(duration: 0.15), value: focusedField)
                )

                Spacer()

                Button(action: {
                    NSApplication.shared.terminate(nil)
                }) {
                    Label("Quit", systemImage: "power")
                        .font(.system(size: 12))
                }
                .buttonStyle(.plain)
                .foregroundColor(.secondary)
                .focusable()
                .focused($focusedField, equals: .quitButton)
                .overlay(
                    RoundedRectangle(cornerRadius: 4)
                        .strokeBorder(
                            focusedField == .quitButton && hasStartedKeyboardNavigation ? Color.accentColor
                                .opacity(0.3) : Color.clear,
                            lineWidth: 1
                        )
                        .animation(.easeInOut(duration: 0.15), value: focusedField)
                )
            }
            .padding()
        }
        .frame(width: 384)
        .background(Color.clear)
        .onAppear {
            // Clear any initial focus after a short delay
            Task {
                try? await Task.sleep(for: .milliseconds(50))
                await MainActor.run {
                    focusedField = nil
                }
            }
        }
        .onKeyPress { keyPress in
            if keyPress.key == .tab && !hasStartedKeyboardNavigation {
                hasStartedKeyboardNavigation = true
                // Let the system handle the Tab to actually move focus
                return .ignored
            }
            return .ignored
        }
    }

    private var activeSessions: [(key: String, value: ServerSessionInfo)] {
        sessionMonitor.sessions
            .filter { $0.value.isRunning && hasActivity($0.value) }
            .sorted { $0.value.startedAt > $1.value.startedAt }
    }

    private var idleSessions: [(key: String, value: ServerSessionInfo)] {
        sessionMonitor.sessions
            .filter { $0.value.isRunning && !hasActivity($0.value) }
            .sorted { $0.value.startedAt > $1.value.startedAt }
    }

    private func hasActivity(_ session: ServerSessionInfo) -> Bool {
        if let activityStatus = session.activityStatus?.specificStatus?.status {
            return !activityStatus.isEmpty
        }
        return false
    }
}

// MARK: - Server Info Header

struct ServerInfoHeader: View {
    @Environment(ServerManager.self)
    var serverManager
    @Environment(NgrokService.self)
    var ngrokService
    @Environment(TailscaleService.self)
    var tailscaleService

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Title and status
            HStack {
                HStack(spacing: 8) {
                    Image(nsImage: NSImage(named: "AppIcon") ?? NSImage())
                        .resizable()
                        .frame(width: 24, height: 24)
                        .cornerRadius(4)

                    Text("VibeTunnel")
                        .font(.system(size: 14, weight: .semibold))
                }

                Spacer()

                ServerStatusBadge(isRunning: serverManager.isRunning)
            }

            // Server address
            if serverManager.isRunning {
                VStack(alignment: .leading, spacing: 4) {
                    ServerAddressRow()

                    if ngrokService.isActive, let publicURL = ngrokService.publicUrl {
                        HStack(spacing: 4) {
                            Image(systemName: "network")
                                .font(.system(size: 10))
                                .foregroundColor(.purple)
                            Text("ngrok:")
                                .font(.system(size: 11))
                                .foregroundColor(.secondary)
                            Text(publicURL)
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundColor(.purple)
                                .lineLimit(1)
                                .truncationMode(.middle)
                        }
                    }

                    if tailscaleService.isRunning, let hostname = tailscaleService.tailscaleHostname {
                        HStack(spacing: 4) {
                            Image(systemName: "shield")
                                .font(.system(size: 10))
                                .foregroundColor(.blue)
                            Text("Tailscale:")
                                .font(.system(size: 11))
                                .foregroundColor(.secondary)
                            Button(action: {
                                if let url = URL(string: "http://\(hostname)") {
                                    NSWorkspace.shared.open(url)
                                }
                            }) {
                                Text(hostname)
                                    .font(.system(size: 11, design: .monospaced))
                                    .foregroundColor(.blue)
                                    .underline()
                            }
                            .buttonStyle(.plain)
                            .pointingHandCursor()
                        }
                    }
                }
            }
        }
    }
}

struct ServerAddressRow: View {
    @Environment(ServerManager.self)
    var serverManager

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "server.rack")
                .font(.system(size: 10))
                .foregroundColor(.green)
            Text("Local:")
                .font(.system(size: 11))
                .foregroundColor(.secondary)
            Button(action: {
                if let url = URL(string: "http://\(serverAddress)") {
                    NSWorkspace.shared.open(url)
                }
            }) {
                Text(serverAddress)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundColor(.accentColor)
                    .underline()
            }
            .buttonStyle(.plain)
            .pointingHandCursor()
        }
    }

    private var serverAddress: String {
        let bindAddress = serverManager.bindAddress
        if bindAddress == "127.0.0.1" {
            return "127.0.0.1:\(serverManager.port)"
        } else if let localIP = NetworkUtility.getLocalIPAddress() {
            return "\(localIP):\(serverManager.port)"
        } else {
            return "0.0.0.0:\(serverManager.port)"
        }
    }
}

struct ServerStatusBadge: View {
    let isRunning: Bool

    var body: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(isRunning ? Color.green : Color.red)
                .frame(width: 6, height: 6)
            Text(isRunning ? "Running" : "Stopped")
                .font(.system(size: 10, weight: .medium))
                .foregroundColor(isRunning ? .green : .red)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(
            Capsule()
                .fill(isRunning ? Color.green.opacity(0.1) : Color.red.opacity(0.1))
                .overlay(
                    Capsule()
                        .stroke(isRunning ? Color.green.opacity(0.3) : Color.red.opacity(0.3), lineWidth: 0.5)
                )
        )
    }
}

// MARK: - Session Components

struct SessionSectionHeader: View {
    let title: String
    let count: Int

    var body: some View {
        HStack {
            Text(title)
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(.secondary)
            Text("(\(count))")
                .font(.system(size: 11))
                .foregroundColor(Color.secondary.opacity(0.6))
            Spacer()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 4)
    }
}

struct SessionRow: View {
    let session: (key: String, value: ServerSessionInfo)
    let isHovered: Bool
    let isActive: Bool
    let isFocused: Bool

    @Environment(\.openWindow)
    private var openWindow

    var body: some View {
        Button(action: {
            WindowTracker.shared.focusWindow(for: session.key)
        }) {
            HStack(spacing: 8) {
                // Activity indicator with subtle glow
                ZStack {
                    Circle()
                        .fill(activityColor.opacity(0.3))
                        .frame(width: 8, height: 8)
                        .blur(radius: 2)
                        .animation(.easeInOut(duration: 0.4), value: activityColor)
                    Circle()
                        .fill(activityColor)
                        .frame(width: 4, height: 4)
                        .animation(.easeInOut(duration: 0.4), value: activityColor)
                }

                // Session info
                VStack(alignment: .leading, spacing: 2) {
                    HStack {
                        Text(sessionName)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(.primary)
                            .lineLimit(1)
                            .truncationMode(.middle)

                        Spacer()

                        if hasWindow {
                            Image(systemName: "macwindow")
                                .font(.system(size: 10))
                                .foregroundColor(.secondary)
                        }
                    }

                    if let activityStatus = session.value.activityStatus?.specificStatus?.status {
                        HStack(spacing: 4) {
                            Text(activityStatus)
                                .font(.system(size: 10))
                                .foregroundColor(.orange)

                            Spacer()

                            Text(compactPath)
                                .font(.system(size: 10))
                                .foregroundColor(.secondary)
                                .lineLimit(1)
                                .truncationMode(.middle)
                        }
                    } else {
                        Text(compactPath)
                            .font(.system(size: 10))
                            .foregroundColor(.secondary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                }

                // Duration
                Text(duration)
                    .font(.system(size: 10))
                    .foregroundColor(Color.secondary.opacity(0.6))
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .background(
            RoundedRectangle(cornerRadius: 6)
                .fill(isHovered ? Color.accentColor.opacity(0.08) : Color.clear)
                .animation(.easeInOut(duration: 0.15), value: isHovered)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 6)
                .strokeBorder(
                    isFocused ? Color.accentColor.opacity(0.3) : Color.clear,
                    lineWidth: 1
                )
                .animation(.easeInOut(duration: 0.15), value: isFocused)
        )
        .focusable()
        .contextMenu {
            if hasWindow {
                Button("Focus Terminal Window") {
                    WindowTracker.shared.focusWindow(for: session.key)
                }
            }

            Button("View Session Details") {
                openWindow(id: "session-detail", value: session.key)
            }

            Divider()

            Button("Copy Session ID") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(session.key, forType: .string)
            }
        }
    }

    private var sessionName: String {
        let workingDir = session.value.workingDir
        return (workingDir as NSString).lastPathComponent
    }

    private var compactPath: String {
        let path = session.value.workingDir
        let homeDir = NSHomeDirectory()

        if path.hasPrefix(homeDir) {
            let relativePath = String(path.dropFirst(homeDir.count))
            return "~" + relativePath
        }

        let components = (path as NSString).pathComponents
        if components.count > 2 {
            let lastTwo = components.suffix(2).joined(separator: "/")
            return ".../" + lastTwo
        }

        return path
    }

    private var activityColor: Color {
        if isActive {
            .orange
        } else {
            .green
        }
    }

    private var hasWindow: Bool {
        // Check if WindowTracker has a window registered for this session
        WindowTracker.shared.windowInfo(for: session.key) != nil
    }

    private var duration: String {
        // Parse ISO8601 date string with fractional seconds
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

        guard let startDate = formatter.date(from: session.value.startedAt) else {
            // Fallback: try without fractional seconds
            formatter.formatOptions = [.withInternetDateTime]
            guard let startDate = formatter.date(from: session.value.startedAt) else {
                return "" // Return empty string instead of "unknown"
            }
            return formatDuration(from: startDate)
        }

        return formatDuration(from: startDate)
    }

    private func formatDuration(from startDate: Date) -> String {
        let elapsed = Date().timeIntervalSince(startDate)

        if elapsed < 60 {
            return "just now"
        } else if elapsed < 3_600 {
            let minutes = Int(elapsed / 60)
            return "\(minutes)m"
        } else if elapsed < 86_400 {
            let hours = Int(elapsed / 3_600)
            return "\(hours)h"
        } else {
            let days = Int(elapsed / 86_400)
            return "\(days)d"
        }
    }
}

struct EmptySessionsView: View {
    @Environment(ServerManager.self)
    var serverManager
    @State private var isAnimating = false

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "terminal")
                .font(.system(size: 32))
                .foregroundStyle(
                    LinearGradient(
                        colors: [Color.secondary, Color.secondary.opacity(0.6)],
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
                    if let url = URL(string: "http://127.0.0.1:\(serverManager.port)") {
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
