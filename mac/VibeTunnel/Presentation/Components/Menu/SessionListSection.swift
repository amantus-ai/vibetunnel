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
            Text(self.title)
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(.secondary)
            Text("(\(self.count))")
                .font(.system(size: 11))
                .foregroundColor(AppColors.Fallback.secondaryText(for: self.colorScheme).opacity(0.6))
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
    let focusedField: MenuFocusField?
    let hasStartedKeyboardNavigation: Bool
    let onHover: (String?) -> Void
    let onFocus: (MenuFocusField?) -> Void

    var body: some View {
        VStack(spacing: 1) {
            if self.activeSessions.isEmpty, self.idleSessions.isEmpty {
                EmptySessionsView()
                    .padding()
                    .transition(.opacity.combined(with: .scale(scale: 0.95)))
            } else {
                // Active sessions section
                if !self.activeSessions.isEmpty {
                    SessionSectionHeader(title: "Active", count: self.activeSessions.count)
                        .transition(.opacity)
                    ForEach(self.activeSessions, id: \.key) { session in
                        SessionRow(
                            session: session,
                            isHovered: self.hoveredSessionId == session.key,
                            isActive: true,
                            isFocused: self.focusedField == .sessionRow(session.key) && self
                                .hasStartedKeyboardNavigation)
                            .onHover { hovering in
                                self.onHover(hovering ? session.key : nil)
                            }
                            .focusable()
                            .transition(.asymmetric(
                                insertion: .opacity.combined(with: .move(edge: .top)),
                                removal: .opacity.combined(with: .scale)))
                    }
                }

                // Idle sessions section
                if !self.idleSessions.isEmpty {
                    SessionSectionHeader(title: "Idle", count: self.idleSessions.count)
                        .transition(.opacity)
                    ForEach(self.idleSessions, id: \.key) { session in
                        SessionRow(
                            session: session,
                            isHovered: self.hoveredSessionId == session.key,
                            isActive: false,
                            isFocused: self.focusedField == .sessionRow(session.key) && self
                                .hasStartedKeyboardNavigation)
                            .onHover { hovering in
                                self.onHover(hovering ? session.key : nil)
                            }
                            .focusable()
                            .transition(.asymmetric(
                                insertion: .opacity.combined(with: .move(edge: .top)),
                                removal: .opacity.combined(with: .scale)))
                    }
                }
            }
        }
    }
}
