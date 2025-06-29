import SwiftUI
import WebKit

/// View for previewing files with syntax highlighting
struct FilePreviewView: View {
    let path: String
    @Environment(\.dismiss)
    var dismiss
    @State private var preview: FilePreview?
    @State private var isLoading = true
    @State private var presentedError: IdentifiableError?
    @State private var showingDiff = false
    @State private var gitDiff: FileDiff?

    var body: some View {
        NavigationStack {
            ZStack {
                Theme.Colors.terminalBackground
                    .ignoresSafeArea()

                if isLoading {
                    ProgressView("Loading...")
                        .progressViewStyle(CircularProgressViewStyle(tint: Theme.Colors.primaryAccent))
                } else if presentedError != nil {
                    ContentUnavailableView {
                        Label("Failed to Load File", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text("The file could not be loaded. Please try again.")
                    } actions: {
                        Button("Retry") {
                            Task {
                                await loadPreview()
                            }
                        }
                        .terminalButton()
                    }
                } else if let preview {
                    previewContent(for: preview)
                }
            }
            .navigationTitle(URL(fileURLWithPath: path).lastPathComponent)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Close") {
                        dismiss()
                    }
                    .foregroundColor(Theme.Colors.primaryAccent)
                }

                if let preview, preview.type == .text {
                    ToolbarItem(placement: .navigationBarTrailing) {
                        Button("Diff") {
                            showingDiff = true
                        }
                        .foregroundColor(Theme.Colors.primaryAccent)
                    }
                }
            }
        }
        .task {
            await loadPreview()
        }
        .sheet(isPresented: $showingDiff) {
            if let diff = gitDiff {
                GitDiffView(diff: diff)
            } else {
                ProgressView("Loading diff...")
                    .task {
                        await loadDiff()
                    }
            }
        }
        .errorAlert(item: $presentedError)
    }

    @ViewBuilder
    private func previewContent(for preview: FilePreview) -> some View {
        switch preview.type {
        case .text:
            if let content = preview.content {
                SyntaxHighlightedView(
                    content: content,
                    language: preview.language ?? "text"
                )
            }
        case .image:
            if let content = preview.content,
               let data = Data(base64Encoded: content),
               let uiImage = UIImage(data: data)
            {
                Image(uiImage: uiImage)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .padding()
            }
        case .binary:
            VStack(spacing: Theme.Spacing.large) {
                Image(systemName: "doc.zipper")
                    .font(.system(size: 64))
                    .foregroundColor(Theme.Colors.terminalForeground.opacity(0.5))

                Text("Binary File")
                    .font(.headline)
                    .foregroundColor(Theme.Colors.terminalForeground)

                if let size = preview.size {
                    Text(formatFileSize(size))
                        .font(.caption)
                        .foregroundColor(Theme.Colors.terminalForeground.opacity(0.7))
                }
            }
        }
    }

    private func loadPreview() async {
        isLoading = true
        presentedError = nil

        do {
            preview = try await APIClient.shared.previewFile(path: path)
            isLoading = false
        } catch {
            presentedError = IdentifiableError(error: error)
            isLoading = false
        }
    }

    private func loadDiff() async {
        do {
            gitDiff = try await APIClient.shared.getGitDiff(path: path)
        } catch {
            // Silently fail - diff might not be available
        }
    }

    private func formatFileSize(_ size: Int64) -> String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .binary
        return formatter.string(fromByteCount: size)
    }
}

/// WebView-based syntax highlighted text view
struct SyntaxHighlightedView: UIViewRepresentable {
    let content: String
    let language: String

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.isOpaque = false
        webView.backgroundColor = UIColor(Theme.Colors.cardBackground)
        webView.scrollView.backgroundColor = UIColor(Theme.Colors.cardBackground)

        loadContent(in: webView)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        // Content is static, no updates needed
    }

    private func loadContent(in webView: WKWebView) {
        let escapedContent = content
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "'", with: "&#39;")

        let html = """
        <!DOCTYPE html>
        <html>
        <head>
            <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes">
            <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/styles/github-dark.min.css">
            <style>
                body {
                    margin: 0;
                    padding: 16px;
                    background: #1a1a1a;
                    color: #e0e0e0;
                    font-family: 'SF Mono', Menlo, Monaco, 'Courier New', monospace;
                    font-size: 14px;
                    line-height: 1.5;
                    -webkit-text-size-adjust: 100%;
                }
                pre {
                    margin: 0;
                    white-space: pre-wrap;
                    word-wrap: break-word;
                }
                code {
                    font-family: inherit;
                }
                .hljs {
                    background: transparent;
                    padding: 0;
                }
            </style>
        </head>
        <body>
            <pre><code class="\(language)">\(escapedContent)</code></pre>
            <script src="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/highlight.min.js"></script>
            <script>
                hljs.highlightAll();
            </script>
        </body>
        </html>
        """

        webView.loadHTMLString(html, baseURL: nil)
    }
}

/// View for displaying git diffs
struct GitDiffView: View {
    let diff: FileDiff
    @Environment(\.dismiss)
    var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                Theme.Colors.terminalBackground
                    .ignoresSafeArea()

                DiffWebView(content: diff.diff)
            }
            .navigationTitle("Git Diff")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Close") {
                        dismiss()
                    }
                    .foregroundColor(Theme.Colors.primaryAccent)
                }
            }
        }
    }
}

/// WebView for displaying diffs with syntax highlighting
struct DiffWebView: UIViewRepresentable {
    let content: String

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.isOpaque = false
        webView.backgroundColor = UIColor(Theme.Colors.cardBackground)

        loadDiff(in: webView)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        // Content is static
    }

    private func loadDiff(in webView: WKWebView) {
        let escapedContent = content
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")

        let html = """
        <!DOCTYPE html>
        <html>
        <head>
            <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes">
            <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/styles/github-dark.min.css">
            <style>
                body {
                    margin: 0;
                    padding: 16px;
                    background: #1a1a1a;
                    color: #e0e0e0;
                    font-family: 'SF Mono', Menlo, Monaco, 'Courier New', monospace;
                    font-size: 14px;
                    line-height: 1.5;
                }
                pre {
                    margin: 0;
                    white-space: pre-wrap;
                    word-wrap: break-word;
                }
                .hljs-addition {
                    background-color: rgba(80, 250, 123, 0.1);
                    color: #50fa7b;
                }
                .hljs-deletion {
                    background-color: rgba(255, 85, 85, 0.1);
                    color: #ff5555;
                }
            </style>
        </head>
        <body>
            <pre><code class="diff">\(escapedContent)</code></pre>
            <script src="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/highlight.min.js"></script>
            <script>hljs.highlightAll();</script>
        </body>
        </html>
        """

        webView.loadHTMLString(html, baseURL: nil)
    }
}
