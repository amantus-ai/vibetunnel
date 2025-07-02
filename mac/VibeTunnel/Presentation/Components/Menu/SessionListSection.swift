import SwiftUI

/// Section header for grouping sessions by status.
///
/// Displays a section title (Active/Idle) with a count of sessions
/// in that category for better visual organization.
struct SessionSectionHeader: View {
    let title: String
    let count: Int

    @Environment(\.colorScheme)
    private var colorScheme

    var body: some View {
        HStack {
            Text(title)
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(.secondary)
            Text("(\(count))")
                .font(.system(size: 11))
                .foregroundColor(AppColors.Fallback.secondaryText(for: colorScheme).opacity(0.6))
            Spacer()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 4)
    }
}

/// Main session list section that groups and displays sessions.
///
/// Handles session organization by active/idle status, displays section headers,
/// and manages the empty state when no sessions are running.
struct SessionListSection: View {
    let activeSessions: [(key: String, value: ServerSessionInfo)]
    let idleSessions: [(key: String, value: ServerSessionInfo)]
    let hoveredSessionId: String?
    let focusedField: VibeTunnelMenuView.FocusField?
    let hasStartedKeyboardNavigation: Bool
    let onHover: (String?) -> Void
    let onFocus: (VibeTunnelMenuView.FocusField?) -> Void

    var body: some View {
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
                            onHover(hovering ? session.key : nil)
                        }
                        .focusable()
                        .transition(.asymmetric(
                            insertion: .opacity.combined(with: .move(edge: .top)),
                            removal: .opacity.combined(with: .scale)
                        ))
                    }
                }

                // Idle sessions section
                if !idleSessions.isEmpty {
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
                            onHover(hovering ? session.key : nil)
                        }
                        .focusable()
                        .transition(.asymmetric(
                            insertion: .opacity.combined(with: .move(edge: .top)),
                            removal: .opacity.combined(with: .scale)
                        ))
                    }
                }
            }
        }
    }
}
