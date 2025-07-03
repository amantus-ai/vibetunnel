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
    @FocusState private var focusedField: FocusField?

    /// Binding to allow external control of new session state
    @Binding var isNewSessionActive: Bool

    init(isNewSessionActive: Binding<Bool> = .constant(false)) {
        self._isNewSessionActive = isNewSessionActive
    }

    enum FocusField: Hashable {
        case sessionRow(String)
        case settingsButton
        case newSessionButton
        case quitButton
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
