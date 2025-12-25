import SwiftUI

/// Sheet for selecting terminal color themes.
struct TerminalThemeSheet: View {
    @Binding var selectedTheme: TerminalTheme
    @Environment(\.dismiss)
    var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: Theme.Spacing.large) {
                    // Current theme preview
                    VStack(alignment: .leading, spacing: Theme.Spacing.small) {
                        Text("Preview")
                            .font(.caption)
                            .foregroundColor(Theme.Colors.terminalForeground.opacity(0.7))

                        TerminalThemePreview(theme: self.selectedTheme)
                            .frame(height: 120)
                    }
                    .padding(.horizontal)
                    .padding(.top)

                    // Theme list
                    VStack(spacing: Theme.Spacing.medium) {
                        ForEach(TerminalTheme.allThemes) { theme in
                            Button(action: {
                                self.selectedTheme = theme
                                HapticFeedback.impact(.light)
                                // Save to UserDefaults
                                TerminalTheme.selected = theme
                            }, label: {
                                HStack(spacing: Theme.Spacing.medium) {
                                    // Color preview
                                    HStack(spacing: 2) {
                                        ForEach(
                                            [theme.red, theme.green, theme.yellow, theme.blue],
                                            id: \.self)
                                        { color in
                                            Rectangle()
                                                .fill(color)
                                                .frame(width: 8, height: 32)
                                        }
                                    }
                                    .cornerRadius(4)
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 4)
                                            .stroke(Theme.Colors.cardBorder, lineWidth: 1))

                                    // Theme info
                                    VStack(alignment: .leading, spacing: Theme.Spacing.extraSmall) {
                                        Text(theme.name)
                                            .font(.headline)
                                            .foregroundColor(Theme.Colors.terminalForeground)

                                        Text(theme.description)
                                            .font(.caption)
                                            .foregroundColor(Theme.Colors.terminalForeground.opacity(0.7))
                                            .fixedSize(horizontal: false, vertical: true)
                                    }

                                    Spacer()

                                    // Selection indicator
                                    if self.selectedTheme.id == theme.id {
                                        Image(systemName: "checkmark.circle.fill")
                                            .font(.system(size: 20))
                                            .foregroundColor(Theme.Colors.successAccent)
                                    }
                                }
                                .padding()
                                .background(
                                    RoundedRectangle(cornerRadius: Theme.CornerRadius.medium)
                                        .fill(
                                            self.selectedTheme.id == theme.id
                                                ? Theme.Colors.primaryAccent.opacity(0.1)
                                                : Theme.Colors.cardBorder.opacity(0.1)))
                                .overlay(
                                    RoundedRectangle(cornerRadius: Theme.CornerRadius.medium)
                                        .stroke(
                                            self.selectedTheme.id == theme.id
                                                ? Theme.Colors.primaryAccent
                                                : Theme.Colors.cardBorder,
                                            lineWidth: 1))
                            })
                            .buttonStyle(PlainButtonStyle())
                        }
                    }
                    .padding(.horizontal)

                    Spacer(minLength: Theme.Spacing.large)
                }
            }
            .background(Theme.Colors.cardBackground)
            .navigationTitle("Terminal Theme")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") {
                        self.dismiss()
                    }
                    .foregroundColor(Theme.Colors.primaryAccent)
                }
            }
        }
    }
}

/// Preview of a terminal theme showing sample text with colors.
/// Preview component for terminal color themes.
/// Shows a sample of how text will appear with the selected theme.
struct TerminalThemePreview: View {
    let theme: TerminalTheme

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            // Terminal prompt with colors
            HStack(spacing: 0) {
                Text("user")
                    .foregroundColor(self.theme.green)
                Text("@")
                    .foregroundColor(self.theme.foreground)
                Text("vibetunnel")
                    .foregroundColor(self.theme.blue)
                Text(":")
                    .foregroundColor(self.theme.foreground)
                Text("~/projects")
                    .foregroundColor(self.theme.cyan)
                Text(" $ ")
                    .foregroundColor(self.theme.foreground)
            }
            .font(Theme.Typography.terminal(size: 12))

            // Sample command
            Text("git status")
                .foregroundColor(self.theme.foreground)
                .font(Theme.Typography.terminal(size: 12))

            // Sample output with different colors
            Text("On branch ")
                .foregroundColor(self.theme.foreground) +
                Text("main")
                .foregroundColor(self.theme.green)

            Text("Changes not staged for commit:")
                .foregroundColor(self.theme.red)
                .font(Theme.Typography.terminal(size: 12))

            HStack(spacing: 0) {
                Text("  modified:   ")
                    .foregroundColor(self.theme.red)
                Text("file.swift")
                    .foregroundColor(self.theme.foreground)
            }
            .font(Theme.Typography.terminal(size: 12))
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(self.theme.background)
        .cornerRadius(Theme.CornerRadius.medium)
        .overlay(
            RoundedRectangle(cornerRadius: Theme.CornerRadius.medium)
                .stroke(Theme.Colors.cardBorder, lineWidth: 1))
    }
}

#Preview {
    TerminalThemeSheet(selectedTheme: .constant(TerminalTheme.vibeTunnel))
}
