import SwiftUI

/// Main settings window with tabbed interface.
///
/// Provides a macOS-style preferences window with multiple tabs for different
/// configuration aspects of VibeTunnel. Dynamically adjusts window size based
/// on the selected tab and conditionally shows debug settings when enabled.
struct SettingsView: View {
    @State private var selectedTab: SettingsTab = .general
    @State private var contentSize: CGSize = .zero
    @AppStorage("debugMode")
    private var debugMode = false

    /// Define ideal sizes for each tab
    private let tabSizes: [SettingsTab: CGSize] = [
        .general: CGSize(width: 500, height: 620),
        .dashboard: CGSize(width: 500, height: 620),
        .advanced: CGSize(width: 500, height: 620),
        .debug: CGSize(width: 500, height: 620),
        .about: CGSize(width: 500, height: 620)
    ]

    var body: some View {
        TabView(selection: $selectedTab) {
            GeneralSettingsView()
                .tabItem {
                    Label(SettingsTab.general.displayName, systemImage: SettingsTab.general.icon)
                }
                .tag(SettingsTab.general)

            DashboardSettingsView()
                .tabItem {
                    Label(SettingsTab.dashboard.displayName, systemImage: SettingsTab.dashboard.icon)
                }
                .tag(SettingsTab.dashboard)

            AdvancedSettingsView()
                .tabItem {
                    Label(SettingsTab.advanced.displayName, systemImage: SettingsTab.advanced.icon)
                }
                .tag(SettingsTab.advanced)

            if debugMode {
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
        .frame(width: contentSize.width, height: contentSize.height)
        .onReceive(NotificationCenter.default.publisher(for: .openSettingsTab)) { notification in
            if let tab = notification.object as? SettingsTab {
                selectedTab = tab
            }
        }
        .onChange(of: selectedTab) { _, newTab in
            contentSize = tabSizes[newTab] ?? CGSize(width: 500, height: 400)
        }
        .onAppear {
            contentSize = tabSizes[selectedTab] ?? CGSize(width: 500, height: 400)
        }
        .onChange(of: debugMode) { _, _ in
            // If debug mode is disabled and we're on the debug tab, switch to general
            if !debugMode && selectedTab == .debug {
                selectedTab = .general
            }
        }
    }
}

#Preview {
    SettingsView()
}
