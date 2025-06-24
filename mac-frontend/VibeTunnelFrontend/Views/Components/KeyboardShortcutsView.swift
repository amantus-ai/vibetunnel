import SwiftUI

struct KeyboardShortcutsView: View {
    @Environment(\.dismiss) private var dismiss
    
    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text("Keyboard Shortcuts")
                    .font(Theme.Typography.title2)
                
                Spacer()
                
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(Theme.Colors.secondaryText)
                }
                .buttonStyle(.plain)
                .keyboardShortcut(.escape)
            }
            .padding(Theme.Spacing.lg)
            
            Divider()
            
            // Shortcuts list
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Spacing.lg) {
                    ShortcutSection(title: "General") {
                        ShortcutRow(keys: ["⌘", "N"], description: "New session")
                        ShortcutRow(keys: ["⌘", "⇧", "K"], description: "Kill all sessions")
                        ShortcutRow(keys: ["⌘", ","], description: "Settings")
                        ShortcutRow(keys: ["⌘", "?"], description: "Show keyboard shortcuts")
                    }
                    
                    ShortcutSection(title: "Terminal") {
                        ShortcutRow(keys: ["⌘", "O"], description: "Open file browser")
                        ShortcutRow(keys: ["⌘", "K"], description: "Clear terminal")
                        ShortcutRow(keys: ["⌘", "+"], description: "Increase font size")
                        ShortcutRow(keys: ["⌘", "-"], description: "Decrease font size")
                        ShortcutRow(keys: ["⌘", "0"], description: "Reset font size")
                        ShortcutRow(keys: ["⌘", "C"], description: "Copy selection")
                        ShortcutRow(keys: ["⌘", "V"], description: "Paste")
                    }
                    
                    ShortcutSection(title: "Navigation") {
                        ShortcutRow(keys: ["⌘", "1"], description: "Sessions view")
                        ShortcutRow(keys: ["⌘", "2"], description: "Logs view")
                        ShortcutRow(keys: ["⌘", "W"], description: "Close window")
                        ShortcutRow(keys: ["⌘", "⇧", "L"], description: "Show logs window")
                    }
                    
                    ShortcutSection(title: "Session List") {
                        ShortcutRow(keys: ["⌘", "R"], description: "Refresh sessions")
                        ShortcutRow(keys: ["⌘", "F"], description: "Search sessions")
                        ShortcutRow(keys: ["↵"], description: "Open selected session")
                        ShortcutRow(keys: ["⌫"], description: "Kill selected session")
                    }
                }
                .padding(Theme.Spacing.lg)
            }
        }
        .frame(width: 600, height: 500)
        .background(Theme.Colors.background)
    }
}

struct ShortcutSection<Content: View>: View {
    let title: String
    @ViewBuilder let content: () -> Content
    
    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            Text(title)
                .font(Theme.Typography.headline)
                .foregroundStyle(Theme.Colors.text)
            
            VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                content()
            }
            .padding(.leading, Theme.Spacing.md)
        }
    }
}

struct ShortcutRow: View {
    let keys: [String]
    let description: String
    
    var body: some View {
        HStack(spacing: Theme.Spacing.md) {
            // Keys
            HStack(spacing: 4) {
                ForEach(keys.indices, id: \.self) { index in
                    if index > 0 {
                        Text("+")
                            .font(Theme.Typography.caption)
                            .foregroundStyle(Theme.Colors.tertiaryText)
                    }
                    
                    Text(keys[index])
                        .font(Theme.Typography.terminalFont)
                        .foregroundStyle(Theme.Colors.text)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Theme.Colors.secondaryBackground)
                        .cornerRadius(4)
                        .overlay(
                            RoundedRectangle(cornerRadius: 4)
                                .stroke(Theme.Colors.tertiaryText.opacity(0.3), lineWidth: 1)
                        )
                }
            }
            .frame(width: 150, alignment: .leading)
            
            // Description
            Text(description)
                .font(Theme.Typography.body)
                .foregroundStyle(Theme.Colors.secondaryText)
            
            Spacer()
        }
    }
}

#Preview {
    KeyboardShortcutsView()
}