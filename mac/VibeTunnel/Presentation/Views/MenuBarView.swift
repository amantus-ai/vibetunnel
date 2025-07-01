import SwiftUI

/// Main menu bar view displaying session status and app controls.
///
/// Appears in the macOS menu bar and provides quick access to VibeTunnel's
/// key features including server status, dashboard access, session monitoring,
/// and application preferences. Updates in real-time to reflect server state.
struct MenuBarView: View {
    @Environment(SessionMonitor.self)
    var sessionMonitor
    @Environment(ServerManager.self)
    var serverManager
    @AppStorage("showInDock")
    private var showInDock = false
    @Environment(\.openWindow)
    private var openWindow

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Server status header
            ServerStatusView(isRunning: serverManager.isRunning, port: Int(serverManager.port) ?? 4_020)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)

            // Open Dashboard button
            Button(action: {
                if let dashboardURL = URL(string: "http://127.0.0.1:\(serverManager.port)") {
                    NSWorkspace.shared.open(dashboardURL)
                }
            }, label: {
                Label("Open Dashboard", systemImage: "safari")
            })
            .buttonStyle(MenuButtonStyle())
            .disabled(!serverManager.isRunning)

            Divider()
                .padding(.vertical, 4)

            // Session count header
            SessionCountView(count: sessionMonitor.sessionCount)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)

            // Session list with clickable items
            if !sessionMonitor.sessions.isEmpty {
                SessionListView(sessions: sessionMonitor.sessions)
                    .padding(.horizontal, 4)
            } else {
                Text("No sessions")
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 4)
            }

            Divider()
                .padding(.vertical, 4)

            // Help menu with submenu indicator
            HStack {
                Menu {
                    // Show Tutorial
                    Button(action: {
                        #if !SWIFT_PACKAGE
                            AppDelegate.showWelcomeScreen()
                        #endif
                    }, label: {
                        HStack {
                            Image(systemName: "book")
                            Text("Show Tutorial")
                        }
                    })

                    Divider()

                    // Website
                    Button(action: {
                        if let url = URL(string: "http://vibetunnel.sh") {
                            NSWorkspace.shared.open(url)
                        }
                    }, label: {
                        HStack {
                            Image(systemName: "globe")
                            Text("Website")
                        }
                    })

                    // Report Issue
                    Button(action: {
                        if let url = URL(string: "https://github.com/amantus-ai/vibetunnel/issues") {
                            NSWorkspace.shared.open(url)
                        }
                    }, label: {
                        HStack {
                            Image(systemName: "exclamationmark.triangle")
                            Text("Report Issue")
                        }
                    })

                    Divider()

                    // Check for Updates
                    Button(action: {
                        SparkleUpdaterManager.shared.checkForUpdates()
                    }, label: {
                        HStack {
                            Image(systemName: "arrow.down.circle")
                            Text("Check for Updates…")
                        }
                    })

                    // Version (non-interactive)
                    HStack {
                        Color.clear
                            .frame(width: 16, height: 16) // Match the typical SF Symbol size
                        Text("Version \(appVersion)")
                            .foregroundColor(.secondary)
                    }

                    Divider()

                    // About
                    Button(
                        action: {
                            SettingsOpener.openSettings()
                            // Navigate to About tab after settings opens
                            Task {
                                try? await Task.sleep(for: .milliseconds(100))
                                NotificationCenter.default.post(
                                    name: .openSettingsTab,
                                    object: SettingsTab.about
                                )
                            }
                        },
                        label: {
                            HStack {
                                Image(systemName: "info.circle")
                                Text("About VibeTunnel")
                            }
                        }
                    )
                } label: {
                    Label("Help", systemImage: "questionmark.circle")
                }
                .menuStyle(BorderlessButtonMenuStyle())
                .fixedSize()
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 4)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 4)
                    .fill(Color.accentColor.opacity(0.001))
            )

            // New Session button
            Button(
                action: {
                    // Close menu and show custom window with new session form
                    NSApp.sendAction(#selector(NSWindow.performClose(_:)), to: nil, from: nil)
                    if let statusBarController = (NSApp.delegate as? AppDelegate)?.statusBarController {
                        statusBarController.showCustomWindow()
                        // Navigate to new session form
                    }
                },
                label: {
                    Label("New Session…", systemImage: "plus.square")
                }
            )
            .buttonStyle(MenuButtonStyle())
            .keyboardShortcut("n", modifiers: .command)

            // Settings button
            Button(
                action: {
                    SettingsOpener.openSettings()
                },
                label: {
                    Label("Settings…", systemImage: "gear")
                }
            )
            .buttonStyle(MenuButtonStyle())
            .keyboardShortcut(",", modifiers: .command)

            Divider()
                .padding(.vertical, 4)

            // Quit button
            Button(action: {
                NSApplication.shared.terminate(nil)
            }, label: {
                Label("Quit", systemImage: "power")
            })
            .buttonStyle(MenuButtonStyle())
            .keyboardShortcut("q", modifiers: .command)
        }
        .frame(minWidth: 200)
        .task {
            // Wait for server to be running before fetching sessions
            while !serverManager.isRunning {
                try? await Task.sleep(for: .milliseconds(500))
            }

            // Give the server a moment to fully initialize after starting
            try? await Task.sleep(for: .milliseconds(100))

            // Force initial refresh
            await sessionMonitor.refresh()

            // Update sessions periodically while view is visible
            while true {
                _ = await sessionMonitor.getSessions()
                try? await Task.sleep(for: .seconds(3))
            }
        }
    }

    private var appVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
    }
}

// MARK: - Server Status View

/// Displays the HTTP server status
struct ServerStatusView: View {
    let isRunning: Bool
    let port: Int
    @Environment(ServerManager.self)
    var serverManager

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                Circle()
                    .fill(isRunning ? Color.green : Color.red)
                    .frame(width: 8, height: 8)

                Text(statusText)
                    .font(.system(size: 13))
                    .foregroundColor(.primary)
                    .lineLimit(1)
            }

            if isRunning {
                Text(accessText)
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)
                    .lineLimit(1)
                    .padding(.leading, 14) // Align with the status text
            }
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private var statusText: String {
        if isRunning {
            "Server running"
        } else {
            "Server stopped"
        }
    }

    private var accessText: String {
        let bindAddress = serverManager.bindAddress
        if bindAddress == "127.0.0.1" {
            return "127.0.0.1:\(port)"
        } else {
            // Network mode - show local IP if available
            if let localIP = NetworkUtility.getLocalIPAddress() {
                return "\(localIP):\(port)"
            } else {
                return "0.0.0.0:\(port)"
            }
        }
    }
}

// MARK: - Session Count View

/// Displays the count of active SSH sessions
struct SessionCountView: View {
    let count: Int

    var body: some View {
        HStack(spacing: 6) {
            Text(sessionText)
                .font(.system(size: 13))
                .foregroundColor(.secondary)
                .lineLimit(1)
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private var sessionText: String {
        count == 1 ? "1 active session" : "\(count) active sessions"
    }
}

// MARK: - Session List View

/// Lists active SSH sessions with truncation for large lists
struct SessionListView: View {
    let sessions: [String: ServerSessionInfo]
    @Environment(\.openWindow)
    private var openWindow

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(Array(activeSessions.prefix(5)), id: \.key) { session in
                SessionRowView(session: session, openWindow: openWindow)
            }

            if activeSessions.count > 5 {
                HStack {
                    Text("  • ...")
                        .font(.system(size: 12))
                        .foregroundColor(.secondary)
                }
                .padding(.vertical, 2)
            }
        }
    }

    private var activeSessions: [(key: String, value: ServerSessionInfo)] {
        sessions.filter(\.value.isRunning)
            .sorted { $0.value.startedAt > $1.value.startedAt }
    }
}

// MARK: - Session Row View

/// Individual row displaying session information
struct SessionRowView: View {
    let session: (key: String, value: ServerSessionInfo)
    let openWindow: OpenWindowAction
    @State private var isHovered = false

    var body: some View {
        Button(action: {
            // Focus the terminal window for this session
            WindowTracker.shared.focusWindow(for: session.key)
        }, label: {
            VStack(alignment: .leading, spacing: 2) {
                // Main session row
                HStack {
                    Text("  • \(sessionName)")
                        .font(.system(size: 12))
                        .foregroundColor(.primary)
                        .lineLimit(1)
                        .truncationMode(.middle)

                    Spacer()

                    if let pid = session.value.pid {
                        Text("PID: \(pid)")
                            .font(.system(size: 11))
                            .foregroundColor(.secondary)
                    }
                }

                // Activity status and path row
                HStack(spacing: 4) {
                    Text("    ")
                        .font(.system(size: 11))

                    if let activityStatus {
                        Text(activityStatus)
                            .font(.system(size: 11))
                            .foregroundColor(Color(red: 0.8, green: 0.4, blue: 0.0))

                        Text("·")
                            .font(.system(size: 11))
                            .foregroundColor(.secondary.opacity(0.5))
                    }

                    Text(compactPath)
                        .font(.system(size: 11))
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)

                    Spacer()
                }
            }
            .padding(.vertical, 2)
            .padding(.horizontal, 8)
            .contentShape(Rectangle())
        })
        .buttonStyle(PlainButtonStyle())
        .background(
            RoundedRectangle(cornerRadius: 4)
                .fill(isHovered ? Color.accentColor.opacity(0.1) : Color.clear)
        )
        .onHover { hovering in
            isHovered = hovering
        }
        .contextMenu {
            Button("Focus Terminal Window") {
                WindowTracker.shared.focusWindow(for: session.key)
            }

            Button("View Session Details") {
                openWindow(id: "session-detail", value: session.key)
            }

            Button("Show in Finder") {
                NSWorkspace.shared.selectFile(nil, inFileViewerRootedAtPath: session.value.workingDir)
            }

            Divider()

            Button("Copy Session ID") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(session.key, forType: .string)
            }
        }
    }

    private var sessionName: String {
        // Extract the working directory name as the session name
        let workingDir = session.value.workingDir
        let name = (workingDir as NSString).lastPathComponent

        // Truncate long session names
        if name.count > 30 {
            let prefix = String(name.prefix(15))
            let suffix = String(name.suffix(10))
            return "\(prefix)...\(suffix)"
        }
        return name
    }

    private var activityStatus: String? {
        if let specificStatus = session.value.activityStatus?.specificStatus {
            return specificStatus.status
        }
        return nil
    }

    private var compactPath: String {
        let path = session.value.workingDir
        let homeDir = NSHomeDirectory()

        // Replace home directory with ~
        if path.hasPrefix(homeDir) {
            let relativePath = String(path.dropFirst(homeDir.count))
            return "~" + relativePath
        }

        // For other paths, show last two components
        let components = (path as NSString).pathComponents
        if components.count > 2 {
            let lastTwo = components.suffix(2).joined(separator: "/")
            return ".../" + lastTwo
        }

        return path
    }
}

// MARK: - Menu Button Style

/// Custom button style for menu items with hover effects
struct MenuButtonStyle: ButtonStyle {
    @State private var isHovered = false

    func makeBody(configuration: ButtonStyle.Configuration) -> some View {
        configuration.label
            .font(.system(size: 13))
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12)
            .padding(.vertical, 4)
            .background(
                RoundedRectangle(cornerRadius: 4)
                    .fill(isHovered ? Color.accentColor.opacity(0.1) : Color.clear)
            )
            .onHover { hovering in
                isHovered = hovering
            }
    }
}
