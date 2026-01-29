import SwiftUI

/// Theme selection is removed - using system light/dark mode only.
/// This stub exists for backward compatibility.
struct TerminalThemeSheet: View {
    @Binding var selectedTheme: TerminalTheme
    @Environment(\.dismiss) var dismiss

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                Text("Theme follows system appearance")
                    .font(.headline)
                Text("Light mode → Light theme\nDark mode → Dark theme")
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
            }
            .navigationTitle("Theme")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium])
    }
}
