import SwiftUI
import Testing
@testable import VibeTunnel

@Suite("Settings View Tests")
@MainActor
struct SettingsViewTests {
    @Test("Selected tab binding writes through to parent")
    func selectedTabBindingWritesThrough() {
        var selectedTab: SettingsView.SettingsTab = .general
        let binding = Binding(
            get: { selectedTab },
            set: { selectedTab = $0 })

        var view = SettingsView(selectedTab: binding)

        #expect(view.test_selectedTab.wrappedValue == .general)
        view.test_selectedTab.wrappedValue = SettingsView.SettingsTab.tailscale
        #expect(selectedTab == .tailscale)
    }
}
