import SwiftUI
import WebKit

struct MonacoEditorView: NSViewRepresentable {
    let content: String
    let language: String
    let readOnly: Bool = true
    let fontSize: CGFloat = 13
    
    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        
        loadEditor(in: webView)
        return webView
    }
    
    func updateNSView(_ webView: WKWebView, context: Context) {
        // Update content if changed
        let escapedContent = content
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "`", with: "\\`")
            .replacingOccurrences(of: "$", with: "\\$")
        
        let script = """
        if (window.editor) {
            window.editor.setValue(`\(escapedContent)`);
            monaco.editor.setModelLanguage(window.editor.getModel(), '\(language)');
        }
        """
        
        webView.evaluateJavaScript(script)
    }
    
    func makeCoordinator() -> Coordinator {
        Coordinator()
    }
    
    private func loadEditor(in webView: WKWebView) {
        let html = """
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <style>
                body {
                    margin: 0;
                    padding: 0;
                    overflow: hidden;
                    background: #1e1e1e;
                }
                #container {
                    width: 100vw;
                    height: 100vh;
                }
            </style>
        </head>
        <body>
            <div id="container"></div>
            <script src="https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs/loader.js"></script>
            <script>
                require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' }});
                require(['vs/editor/editor.main'], function() {
                    const content = `\(content.replacingOccurrences(of: "\\", with: "\\\\")
                        .replacingOccurrences(of: "`", with: "\\`")
                        .replacingOccurrences(of: "$", with: "\\$"))`;
                    
                    window.editor = monaco.editor.create(document.getElementById('container'), {
                        value: content,
                        language: '\(language)',
                        theme: 'vs-dark',
                        readOnly: \(readOnly),
                        fontSize: \(fontSize),
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        wordWrap: 'on',
                        automaticLayout: true,
                        folding: true,
                        lineNumbers: 'on',
                        renderWhitespace: 'selection',
                        scrollbar: {
                            vertical: 'auto',
                            horizontal: 'auto'
                        }
                    });
                });
            </script>
        </body>
        </html>
        """
        
        webView.loadHTMLString(html, baseURL: nil)
    }
    
    class Coordinator: NSObject, WKNavigationDelegate {
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            // Editor loaded
        }
    }
}

// Language detection based on file extension
extension MonacoEditorView {
    static func detectLanguage(for filename: String) -> String {
        let ext = (filename as NSString).pathExtension.lowercased()
        
        switch ext {
        case "js", "mjs": return "javascript"
        case "ts", "mts": return "typescript"
        case "jsx": return "javascript"
        case "tsx": return "typescript"
        case "json": return "json"
        case "html", "htm": return "html"
        case "css": return "css"
        case "scss", "sass": return "scss"
        case "less": return "less"
        case "xml": return "xml"
        case "yaml", "yml": return "yaml"
        case "md", "markdown": return "markdown"
        case "py": return "python"
        case "rb": return "ruby"
        case "php": return "php"
        case "java": return "java"
        case "c": return "c"
        case "cpp", "cc", "cxx": return "cpp"
        case "h", "hpp": return "cpp"
        case "cs": return "csharp"
        case "go": return "go"
        case "rs": return "rust"
        case "swift": return "swift"
        case "m", "mm": return "objective-c"
        case "sh", "bash": return "shell"
        case "ps1": return "powershell"
        case "sql": return "sql"
        case "dockerfile": return "dockerfile"
        case "makefile": return "makefile"
        case "toml": return "toml"
        case "ini": return "ini"
        case "vim": return "vim"
        default: return "plaintext"
        }
    }
}