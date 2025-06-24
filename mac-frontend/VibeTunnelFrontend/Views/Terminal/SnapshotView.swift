import SwiftUI
import UniformTypeIdentifiers

struct SnapshotView: View {
    let content: String
    @Environment(\.dismiss) private var dismiss
    @State private var selectedText = ""
    
    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text("Terminal Snapshot")
                    .font(Theme.Typography.title3)
                
                Spacer()
                
                HStack(spacing: Theme.Spacing.sm) {
                    Button {
                        copyToClipboard()
                    } label: {
                        Label("Copy", systemImage: "doc.on.doc")
                    }
                    
                    Button {
                        saveSnapshot()
                    } label: {
                        Label("Save", systemImage: "square.and.arrow.down")
                    }
                    
                    Button("Close") {
                        dismiss()
                    }
                    .keyboardShortcut(.escape)
                }
            }
            .padding(Theme.Spacing.lg)
            
            Divider()
            
            // Content
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(content.components(separatedBy: .newlines).indices, id: \.self) { index in
                        let line = content.components(separatedBy: .newlines)[index]
                        Text(line.isEmpty ? " " : line)
                            .font(Theme.Typography.terminalFont)
                            .foregroundStyle(Theme.Colors.terminalText)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding(Theme.Spacing.md)
            }
            .background(Theme.Colors.terminalBackground)
        }
        .frame(width: 800, height: 600)
        .background(Theme.Colors.background)
    }
    
    private func copyToClipboard() {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(content, forType: .string)
    }
    
    private func saveSnapshot() {
        let savePanel = NSSavePanel()
        savePanel.title = "Save Terminal Snapshot"
        savePanel.nameFieldStringValue = "terminal-snapshot-\(Date().ISO8601Format()).txt"
        savePanel.allowedContentTypes = [.plainText]
        
        if savePanel.runModal() == .OK,
           let url = savePanel.url {
            do {
                try content.write(to: url, atomically: true, encoding: .utf8)
            } catch {
                print("Failed to save snapshot: \(error)")
            }
        }
    }
}

#Preview {
    SnapshotView(content: """
    Last login: Mon Jan 15 10:23:45 on ttys001
    user@machine ~ % ls -la
    total 16
    drwxr-xr-x   5 user  staff   160 Jan 15 10:23 .
    drwxr-xr-x  20 user  staff   640 Jan 15 10:23 ..
    -rw-r--r--   1 user  staff   220 Jan 15 10:23 .bashrc
    -rw-r--r--   1 user  staff  1024 Jan 15 10:23 README.md
    user@machine ~ %
    """)
}