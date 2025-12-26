import SwiftUI

/// Quick Keys settings tab for customizing mobile keyboard shortcuts
struct QuickKeysSettingsView: View {
    var body: some View {
        NavigationStack {
            Form {
                QuickKeysEditorView()
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
            .navigationTitle("Quick Keys")
        }
    }
}

#Preview {
    QuickKeysSettingsView()
        .environment(QuickKeysService.shared)
}
