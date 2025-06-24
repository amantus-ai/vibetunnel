import SwiftUI

struct FilePreviewView: View {
    let filePath: String
    @Environment(\.dismiss) private var dismiss
    @Environment(ConnectionManager.self) private var connectionManager
    @State private var fileContent: String?
    @State private var isLoading = true
    @State private var error: Error?
    @State private var fileSize: Int64 = 0
    @State private var showMonacoEditor = true
    
    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("File Preview")
                        .font(Theme.Typography.title3)
                    Text(URL(fileURLWithPath: filePath).lastPathComponent)
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Colors.secondaryText)
                        .lineLimit(1)
                }
                
                Spacer()
                
                if fileContent != nil {
                    Toggle("Syntax Highlighting", isOn: $showMonacoEditor)
                        .toggleStyle(.switch)
                        .controlSize(.small)
                }
                
                Button("Close") {
                    dismiss()
                }
                .keyboardShortcut(.escape)
            }
            .padding(Theme.Spacing.lg)
            
            Divider()
            
            // Content
            if isLoading {
                LoadingView(message: "Loading file...")
            } else if let error {
                ErrorView(error: error) {
                    Task {
                        await loadFile()
                    }
                }
            } else if let fileContent {
                if showMonacoEditor && fileSize < 1_000_000 { // Use Monaco for files < 1MB
                    MonacoEditorView(
                        content: fileContent,
                        language: MonacoEditorView.detectLanguage(for: filePath)
                    )
                } else {
                    // Fallback to plain text view for large files or when Monaco is disabled
                    ScrollView {
                        Text(fileContent)
                            .font(Theme.Typography.terminalFont)
                            .foregroundStyle(Theme.Colors.terminalText)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(Theme.Spacing.md)
                    }
                    .background(Theme.Colors.terminalBackground)
                }
            }
            
            Divider()
            
            // Footer
            HStack {
                if fileSize > 0 {
                    Text(formatFileSize(fileSize))
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Colors.secondaryText)
                }
                
                Spacer()
                
                Button("Copy Path") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(filePath, forType: .string)
                }
                .secondaryButtonStyle()
                
                if fileContent != nil {
                    Button("Copy Content") {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(fileContent!, forType: .string)
                    }
                    .primaryButtonStyle()
                }
            }
            .padding(Theme.Spacing.lg)
        }
        .frame(width: 900, height: 700)
        .background(Theme.Colors.background)
        .task {
            await loadFile()
        }
    }
    
    private func loadFile() async {
        isLoading = true
        error = nil
        
        // For local files, read directly
        do {
            let url = URL(fileURLWithPath: filePath)
            let attributes = try FileManager.default.attributesOfItem(atPath: filePath)
            fileSize = attributes[.size] as? Int64 ?? 0
            
            // Check file size before reading
            if fileSize > 10_000_000 { // 10MB limit
                throw CocoaError(.fileReadTooLarge)
            }
            
            let content = try String(contentsOf: url, encoding: .utf8)
            
            await MainActor.run {
                self.fileContent = content
                self.isLoading = false
            }
        } catch {
            // If local read fails, try server API
            await loadFileFromServer()
        }
    }
    
    private func loadFileFromServer() async {
        guard let serverURL = connectionManager.serverURL else { return }
        
        do {
            let url = serverURL.appendingPathComponent("api/fs/read")
            var components = URLComponents(url: url, resolvingAgainstBaseURL: false)!
            components.queryItems = [URLQueryItem(name: "path", value: filePath)]
            
            var request = URLRequest(url: components.url!)
            if let authHeader = connectionManager.authHeader {
                request.setValue(authHeader, forHTTPHeaderField: "Authorization")
            }
            
            let (data, response) = try await URLSession.shared.data(for: request)
            
            guard let httpResponse = response as? HTTPURLResponse,
                  httpResponse.statusCode == 200 else {
                throw URLError(.badServerResponse)
            }
            
            let content = String(data: data, encoding: .utf8) ?? ""
            fileSize = Int64(data.count)
            
            await MainActor.run {
                self.fileContent = content
                self.isLoading = false
            }
        } catch {
            await MainActor.run {
                self.error = error
                self.isLoading = false
            }
        }
    }
    
    private func formatFileSize(_ bytes: Int64) -> String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        return formatter.string(fromByteCount: bytes)
    }
}

#Preview {
    FilePreviewView(filePath: "/path/to/file.swift")
        .environment(ConnectionManager())
}