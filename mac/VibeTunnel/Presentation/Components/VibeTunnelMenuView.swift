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
    @Environment(GitRepositoryMonitor.self)
    var gitRepositoryMonitor
    @Environment(\.openWindow)
    private var openWindow
    @Environment(\.colorScheme)
    private var colorScheme

    @State private var hoveredSessionId: String?
    @State private var hasStartedKeyboardNavigation = false
    @State private var showingNewSession = false
    @FocusState private var focusedField: MenuFocusField?

    /// Binding to allow external control of new session state
    @Binding var isNewSessionActive: Bool

    init(isNewSessionActive: Binding<Bool> = .constant(false)) {
        self._isNewSessionActive = isNewSessionActive
    }

    var body: some View {
        if showingNewSession {
            NewSessionForm(isPresented: Binding(
                get: { showingNewSession },
                set: { newValue in
                    showingNewSession = newValue
                    isNewSessionActive = newValue
                }
            ))
            .transition(.asymmetric(
                insertion: .move(edge: .bottom).combined(with: .opacity),
                removal: .move(edge: .bottom).combined(with: .opacity)
            ))
        } else {
            mainContent
                .transition(.asymmetric(
                    insertion: .opacity,
                    removal: .opacity
                ))
        }
    }

    private var mainContent: some View {
        VStack(spacing: 0) {
            // Header with server info
            ServerInfoHeader()
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
                .background(
                    LinearGradient(
                        colors: colorScheme == .dark ? MenuStyles.headerGradientDark : MenuStyles.headerGradientLight,
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )

            Divider()

            // Session list
            ScrollView {
                SessionListSection(
                    activeSessions: activeSessions,
                    idleSessions: idleSessions,
                    hoveredSessionId: hoveredSessionId,
                    focusedField: focusedField,
                    hasStartedKeyboardNavigation: hasStartedKeyboardNavigation,
                    onHover: { sessionId in
                        hoveredSessionId = sessionId
                    },
                    onFocus: { field in
                        focusedField = field
                    }
                )
            }
            .frame(maxHeight: 600)

            Divider()

            // Bottom action bar
            MenuActionBar(
                showingNewSession: $showingNewSession,
                focusedField: Binding(
                    get: { focusedField },
                    set: { focusedField = $0 }
                ),
                hasStartedKeyboardNavigation: hasStartedKeyboardNavigation
            )
        }
        .frame(width: MenuStyles.menuWidth)
        .background(Color.clear)
        .focusable() // Enable keyboard focus
        .focusEffectDisabled() // Remove blue focus ring
        .onKeyPress { keyPress in
            // Handle Tab key for focus indication
            if keyPress.key == .tab && !hasStartedKeyboardNavigation {
                hasStartedKeyboardNavigation = true
                // Let the system handle the Tab to actually move focus
                return .ignored
            }

            // Handle arrow keys for navigation
            if keyPress.key == .upArrow || keyPress.key == .downArrow {
                hasStartedKeyboardNavigation = true
                return handleArrowKeyNavigation(keyPress.key == .upArrow)
            }

            // Handle Enter key to activate focused item
            if keyPress.key == .return {
                return handleEnterKey()
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

    // MARK: - Keyboard Navigation

    private func handleArrowKeyNavigation(_ isUpArrow: Bool) -> KeyPress.Result {
        let allSessions = activeSessions + idleSessions
        let focusableFields: [MenuFocusField] = allSessions.map { .sessionRow($0.key) } +
            [.newSessionButton, .settingsButton, .quitButton]

        guard let currentFocus = focusedField,
              let currentIndex = focusableFields.firstIndex(of: currentFocus)
        else {
            // No current focus, focus first item
            if !focusableFields.isEmpty {
                focusedField = focusableFields[0]
            }
            return .handled
        }

        let newIndex: Int = if isUpArrow {
            currentIndex > 0 ? currentIndex - 1 : focusableFields.count - 1
        } else {
            currentIndex < focusableFields.count - 1 ? currentIndex + 1 : 0
        }

        focusedField = focusableFields[newIndex]
        return .handled
    }

    private func handleEnterKey() -> KeyPress.Result {
        guard let currentFocus = focusedField else { return .ignored }

        switch currentFocus {
        case .sessionRow(let sessionId):
            // Find the session and trigger the appropriate action
            if sessionMonitor.sessions[sessionId] != nil {
                let hasWindow = WindowTracker.shared.windowInfo(for: sessionId) != nil

                if hasWindow {
                    // Focus the terminal window
                    WindowTracker.shared.focusWindow(for: sessionId)
                } else {
                    // Open in browser
                    if let url = DashboardURLBuilder.dashboardURL(port: serverManager.port, sessionId: sessionId) {
                        NSWorkspace.shared.open(url)
                    }
                }

                // Close the menu after action
                NSApp.windows.first { $0.className == "VibeTunnelMenuWindow" }?.close()
            }
            return .handled

        case .newSessionButton:
            showingNewSession = true
            return .handled

        case .settingsButton:
            SettingsOpener.openSettings()
            // Close the menu after action
            NSApp.windows.first { $0.className == "VibeTunnelMenuWindow" }?.close()
            return .handled

        case .quitButton:
            NSApplication.shared.terminate(nil)
            return .handled
        }
    }
}
