import SwiftUI

/// Main settings window with tabbed interface.
///
/// Provides a macOS-style preferences window with multiple tabs for different
/// configuration aspects of VibeTunnel. Dynamically adjusts window size based
/// on the selected tab and conditionally shows debug settings when enabled.
struct SettingsView: View {
    @State private var selectedTab: SettingsTab = .general
    @State private var contentSize: CGSize = .zero
    @AppStorage(AppConstants.UserDefaultsKeys.debugMode)
    private var debugMode = false

    // MARK: - Constants

    private enum Layout {
        static let defaultTabSize = CGSize(width: 550, height: 710)
        static let fallbackTabSize = CGSize(width: 550, height: 450)
    }

    /// Define ideal sizes for each tab
    private let tabSizes: [SettingsTab: CGSize] = [
        .general: Layout.defaultTabSize,
        .notifications: Layout.defaultTabSize,
        .quickStart: Layout.defaultTabSize,
        .dashboard: Layout.defaultTabSize,
        .remoteAccess: Layout.defaultTabSize,
        .advanced: Layout.defaultTabSize,
        .debug: Layout.defaultTabSize,
        .about: Layout.defaultTabSize,
    ]

    var body: some View {
        TabView(selection: self.$selectedTab) {
            GeneralSettingsView()
                .tabItem {
                    Label(SettingsTab.general.displayName, systemImage: SettingsTab.general.icon)
                }
                .tag(SettingsTab.general)

            NotificationSettingsView()
                .tabItem {
                    Label(SettingsTab.notifications.displayName, systemImage: SettingsTab.notifications.icon)
                }
                .tag(SettingsTab.notifications)

            QuickStartSettingsView()
                .tabItem {
                    Label(SettingsTab.quickStart.displayName, systemImage: SettingsTab.quickStart.icon)
                }
                .tag(SettingsTab.quickStart)

            DashboardSettingsView()
                .tabItem {
                    Label(SettingsTab.dashboard.displayName, systemImage: SettingsTab.dashboard.icon)
                }
                .tag(SettingsTab.dashboard)

            RemoteAccessSettingsView()
                .tabItem {
                    Label(SettingsTab.remoteAccess.displayName, systemImage: SettingsTab.remoteAccess.icon)
                }
                .tag(SettingsTab.remoteAccess)

            AdvancedSettingsView()
                .tabItem {
                    Label(SettingsTab.advanced.displayName, systemImage: SettingsTab.advanced.icon)
                }
                .tag(SettingsTab.advanced)

            if self.debugMode {
                DebugSettingsView()
                    .tabItem {
                        Label(SettingsTab.debug.displayName, systemImage: SettingsTab.debug.icon)
                    }
                    .tag(SettingsTab.debug)
            }

            AboutView()
                .tabItem {
                    Label(SettingsTab.about.displayName, systemImage: SettingsTab.about.icon)
                }
                .tag(SettingsTab.about)
        }
        .frame(width: self.contentSize.width, height: self.contentSize.height)
        .onReceive(NotificationCenter.default.publisher(for: .openSettingsTab)) { notification in
            if let tab = notification.object as? SettingsTab {
                self.selectedTab = tab
            }
        }
        .onChange(of: self.selectedTab) { _, newTab in
            self.contentSize = self.tabSizes[newTab] ?? Layout.fallbackTabSize
        }
        .onAppear {
            self.contentSize = self.tabSizes[self.selectedTab] ?? Layout.fallbackTabSize
        }
        .onChange(of: self.debugMode) { _, _ in
            // If debug mode is disabled and we're on the debug tab, switch to general
            if !self.debugMode, self.selectedTab == .debug {
                self.selectedTab = .general
            }
        }
    }
}

#Preview {
    SettingsView()
}
