import Highlightr
import SwiftUI

struct GitDiffView: View {
    let filePath: String
    @Environment(\.dismiss)
    private var dismiss
    @Environment(ConnectionManager.self)
    private var connectionManager
    @State private var diffContent: String?
    @State private var isLoading = true
    @State private var error: Error?
    
    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Git Diff")
                        .font(Theme.Typography.title3)
                    Text(filePath)
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Colors.secondaryText)
                        .lineLimit(1)
                }
                
                Spacer()
                
                Button("Close") {
                    dismiss()
                }
                .keyboardShortcut(.escape)
            }
            .padding(Theme.Spacing.lg)
            
            Divider()
            
            // Content
            if isLoading {
                LoadingView(message: "Loading diff...")
            } else if let error {
                ErrorView(error: error) {
                    Task {
                        await loadDiff()
                    }
                }
            } else if let diffContent {
                ScrollView {
                    DiffContentView(diffContent: diffContent)
                        .padding(Theme.Spacing.md)
                }
                .background(Theme.Colors.terminalBackground)
            } else {
                EmptyStateView(
                    title: "No Changes",
                    message: "This file has no uncommitted changes",
                    systemImage: "checkmark.circle"
                )
            }
        }
        .frame(width: 800, height: 600)
        .background(Theme.Colors.background)
        .task {
            await loadDiff()
        }
    }
    
    private func loadDiff() async {
        guard let serverURL = connectionManager.serverURL else { return }
        
        isLoading = true
        error = nil
        
        do {
            let url = serverURL.appendingPathComponent("api/fs/diff")
            var components = URLComponents(url: url, resolvingAgainstBaseURL: false)!
            components.queryItems = [URLQueryItem(name: "path", value: filePath)]
            
            var request = URLRequest(url: components.url!)
            if let authHeader = connectionManager.authHeader {
                request.setValue(authHeader, forHTTPHeaderField: "Authorization")
            }
            
            let (data, response) = try await URLSession.shared.data(for: request)
            
            guard let httpResponse = response as? HTTPURLResponse else {
                throw URLError(.badServerResponse)
            }
            
            if httpResponse.statusCode == 404 {
                // No diff available
                await MainActor.run {
                    self.diffContent = nil
                    self.isLoading = false
                }
                return
            }
            
            guard httpResponse.statusCode == 200 else {
                throw URLError(.badServerResponse)
            }
            
            let content = String(data: data, encoding: .utf8) ?? ""
            
            await MainActor.run {
                self.diffContent = content
                self.isLoading = false
            }
        } catch {
            await MainActor.run {
                self.error = error
                self.isLoading = false
            }
        }
    }
}

struct DiffContentView: View {
    let diffContent: String
    
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(parseDiffLines(), id: \.id) { line in
                DiffLineView(line: line)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    
    private func parseDiffLines() -> [DiffLine] {
        let lines = diffContent.components(separatedBy: .newlines)
        return lines.enumerated().map { index, content in
            DiffLine(id: index, content: content, type: getDiffLineType(content))
        }
    }
    
    private func getDiffLineType(_ line: String) -> DiffLineType {
        if line.hasPrefix("+") && !line.hasPrefix("+++") {
            return .addition
        } else if line.hasPrefix("-") && !line.hasPrefix("---") {
            return .deletion
        } else if line.hasPrefix("@@") {
            return .hunk
        } else if line.hasPrefix("diff --git") || line.hasPrefix("index ") {
            return .header
        } else {
            return .context
        }
    }
}

struct DiffLine: Identifiable {
    let id: Int
    let content: String
    let type: DiffLineType
}

enum DiffLineType {
    case addition
    case deletion
    case context
    case hunk
    case header
}

struct DiffLineView: View {
    let line: DiffLine
    
    var body: some View {
        HStack(spacing: 0) {
            // Line marker
            Text(lineMarker)
                .font(Theme.Typography.terminalFont)
                .foregroundStyle(markerColor)
                .frame(width: 20, alignment: .center)
            
            // Line content
            Text(line.content)
                .font(Theme.Typography.terminalFont)
                .foregroundStyle(textColor)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 1)
        .background(backgroundColor)
    }
    
    private var lineMarker: String {
        switch line.type {
        case .addition: return "+"
        case .deletion: return "-"
        case .context: return " "
        case .hunk, .header: return ""
        }
    }
    
    private var markerColor: Color {
        switch line.type {
        case .addition: return Theme.Colors.success
        case .deletion: return Theme.Colors.error
        case .context: return Theme.Colors.tertiaryText
        case .hunk: return Theme.Colors.accent
        case .header: return Theme.Colors.secondaryText
        }
    }
    
    private var textColor: Color {
        switch line.type {
        case .addition: return Theme.Colors.success
        case .deletion: return Theme.Colors.error
        case .hunk: return Theme.Colors.accent
        case .header: return Theme.Colors.secondaryText
        case .context: return Theme.Colors.terminalText
        }
    }
    
    private var backgroundColor: Color {
        switch line.type {
        case .addition: return Theme.Colors.success.opacity(0.1)
        case .deletion: return Theme.Colors.error.opacity(0.1)
        case .hunk: return Theme.Colors.accent.opacity(0.1)
        default: return Color.clear
        }
    }
}

#Preview {
    GitDiffView(filePath: "/path/to/file.swift")
        .environment(ConnectionManager())
}
