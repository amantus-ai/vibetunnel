import SwiftUI

/// Quick Start settings tab for managing quick start commands
struct QuickStartSettingsView: View {
    var body: some View {
        NavigationStack {
            Form {
                QuickStartSettingsSection()
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
            .navigationTitle("Quick Start Settings")
        }
    }
}

#Preview {
    QuickStartSettingsView()
}
