import SwiftUI

/// Focus field enum that matches the one in VibeTunnelMenuView
enum MenuFocusField: Hashable {
    case sessionRow(String)
    case settingsButton
    case newSessionButton
    case quitButton
}

/// Bottom action bar for the menu with New Session, Settings, and Quit buttons.
///
/// Provides quick access to common actions with keyboard navigation support
/// and visual feedback for hover and focus states.
struct MenuActionBar: View {
    @Binding var showingNewSession: Bool
    @Binding var focusedField: MenuFocusField?
    let hasStartedKeyboardNavigation: Bool

    @Environment(\.openWindow)
    private var openWindow
    @Environment(\.colorScheme)
    private var colorScheme

    @State private var isHoveringNewSession = false
    @State private var isHoveringSettings = false
    @State private var isHoveringQuit = false

    var body: some View {
        HStack(spacing: 8) {
            Button(action: {
                self.showingNewSession = true
            }, label: {
                Label("New Session", systemImage: "plus.circle")
                    .font(.system(size: 12))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 10)
                    .background(
                        RoundedRectangle(cornerRadius: 8)
                            .fill(
                                self.isHoveringNewSession ? AppColors.Fallback.controlBackground(for: self.colorScheme)
                                    .opacity(self.colorScheme == .light ? 0.6 : 0.7) : Color.clear)
                            .scaleEffect(self.isHoveringNewSession ? 1.08 : 1.0)
                            .animation(.easeInOut(duration: 0.15), value: self.isHoveringNewSession))
            })
            .buttonStyle(.plain)
            .foregroundColor(.primary)
            .onHover { hovering in
                self.isHoveringNewSession = hovering
            }
            .focusable()
            .overlay(
                RoundedRectangle(cornerRadius: 4)
                    .strokeBorder(
                        self.focusedField == .newSessionButton && self.hasStartedKeyboardNavigation ? AppColors.Fallback
                            .accentHover(for: self.colorScheme).opacity(2) : Color.clear,
                        lineWidth: 1)
                    .animation(.easeInOut(duration: 0.15), value: self.focusedField))

            Button(action: {
                SettingsOpener.openSettings()
            }, label: {
                Label("Settings", systemImage: "gearshape")
                    .font(.system(size: 12))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 10)
                    .background(
                        RoundedRectangle(cornerRadius: 8)
                            .fill(
                                self.isHoveringSettings ? AppColors.Fallback.controlBackground(for: self.colorScheme)
                                    .opacity(self.colorScheme == .light ? 0.6 : 0.7) : Color.clear)
                            .scaleEffect(self.isHoveringSettings ? 1.08 : 1.0)
                            .animation(.easeInOut(duration: 0.15), value: self.isHoveringSettings))
            })
            .buttonStyle(.plain)
            .foregroundColor(.secondary)
            .onHover { hovering in
                self.isHoveringSettings = hovering
            }
            .focusable()
            .overlay(
                RoundedRectangle(cornerRadius: 4)
                    .strokeBorder(
                        self.focusedField == .settingsButton && self.hasStartedKeyboardNavigation ? AppColors.Fallback
                            .accentHover(for: self.colorScheme).opacity(2) : Color.clear,
                        lineWidth: 1)
                    .animation(.easeInOut(duration: 0.15), value: self.focusedField))

            Spacer()

            Button(action: {
                NSApplication.shared.terminate(nil)
            }, label: {
                Label("Quit", systemImage: "power")
                    .font(.system(size: 12))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 10)
                    .background(
                        RoundedRectangle(cornerRadius: 8)
                            .fill(
                                self.isHoveringQuit ? AppColors.Fallback.controlBackground(for: self.colorScheme)
                                    .opacity(self.colorScheme == .light ? 0.6 : 0.7) : Color.clear)
                            .scaleEffect(self.isHoveringQuit ? 1.08 : 1.0)
                            .animation(.easeInOut(duration: 0.15), value: self.isHoveringQuit))
            })
            .buttonStyle(.plain)
            .foregroundColor(.secondary)
            .onHover { hovering in
                self.isHoveringQuit = hovering
            }
            .focusable()
            .overlay(
                RoundedRectangle(cornerRadius: 4)
                    .strokeBorder(
                        self.focusedField == .quitButton && self.hasStartedKeyboardNavigation ? AppColors.Fallback
                            .accentHover(for: self.colorScheme).opacity(2) : Color.clear,
                        lineWidth: 1)
                    .animation(.easeInOut(duration: 0.15), value: self.focusedField))
        }
        .padding(.horizontal)
        .padding(.vertical, 12)
    }
}
