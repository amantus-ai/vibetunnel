import SwiftUI
import WebKit

/// WebView-based terminal using xterm.js
struct XtermWebView: UIViewRepresentable {
    let session: Session
    @Binding var fontSize: CGFloat
    let theme: TerminalTheme
    let onInput: (String) -> Void
    let onResize: (Int, Int) -> Void
    var viewModel: TerminalViewModel

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.userContentController = WKUserContentController()

        // Add message handlers
        configuration.userContentController.add(context.coordinator, name: "terminalInput")
        configuration.userContentController.add(context.coordinator, name: "terminalResize")
        configuration.userContentController.add(context.coordinator, name: "terminalReady")
        configuration.userContentController.add(context.coordinator, name: "terminalLog")

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.isOpaque = false
        webView.backgroundColor = UIColor(theme.background)
        webView.scrollView.isScrollEnabled = false

        context.coordinator.webView = webView
        context.coordinator.loadTerminal()

        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        // Update font size
        context.coordinator.updateFontSize(fontSize)

        // Update theme
        context.coordinator.updateTheme(theme)
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        let parent: XtermWebView
        weak var webView: WKWebView?
        private var bufferWebSocketClient: BufferWebSocketClient?
        private let logger = Logger(category: "XtermWebView")
        private var sseClient: SSEClient?

        init(_ parent: XtermWebView) {
            self.parent = parent
            super.init()
        }

        func loadTerminal() {
            guard let webView else { return }

            let html = """
            <!DOCTYPE html>
            <html>
            <head>
                <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
                <style>
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    body {
                        background: #000;
                        overflow: hidden;
                        -webkit-user-select: none;
                        -webkit-touch-callout: none;
                    }
                    #terminal {
                        width: 100vw;
                        height: 100vh;
                    }
                    .xterm { height: 100%; }
                    .xterm-viewport { overflow-y: auto !important; }
                </style>
                <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css">
            </head>
            <body>
                <div id="terminal"></div>
                <script src="https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.js"></script>
                <script src="https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.js"></script>
                <script src="https://cdn.jsdelivr.net/npm/xterm-addon-web-links@0.9.0/lib/xterm-addon-web-links.js"></script>
                <script>
                    let term;
                    let fitAddon;
                    let buffer = [];
                    let isReady = false;

                    function log(message) {
                        window.webkit.messageHandlers.terminalLog.postMessage(message);
                    }

                    function initTerminal() {
                        term = new Terminal({
                            fontSize: \(parent.fontSize),
                            fontFamily: 'Menlo, Monaco, "Courier New", monospace',
                            theme: {
                                background: '#1a1a1a',
                                foreground: '#e0e0e0',
                                cursor: '#00ff00',
                                cursorAccent: '#000000',
                                selection: 'rgba(255, 255, 255, 0.3)',
                                black: '#000000',
                                red: '#ff5555',
                                green: '#50fa7b',
                                yellow: '#f1fa8c',
                                blue: '#6272a4',
                                magenta: '#ff79c6',
                                cyan: '#8be9fd',
                                white: '#bfbfbf',
                                brightBlack: '#4d4d4d',
                                brightRed: '#ff6e6e',
                                brightGreen: '#69ff94',
                                brightYellow: '#ffffa5',
                                brightBlue: '#7b8dbd',
                                brightMagenta: '#ff92df',
                                brightCyan: '#a4ffff',
                                brightWhite: '#e6e6e6'
                            },
                            allowTransparency: false,
                            cursorBlink: true,
                            scrollback: 10000
                        });

                        fitAddon = new FitAddon.FitAddon();
                        term.loadAddon(fitAddon);

                        const webLinksAddon = new WebLinksAddon.WebLinksAddon();
                        term.loadAddon(webLinksAddon);

                        term.open(document.getElementById('terminal'));

                        // Fit terminal to container
                        setTimeout(() => {
                            fitAddon.fit();
                            const dims = fitAddon.proposeDimensions();
                            if (dims) {
                                window.webkit.messageHandlers.terminalResize.postMessage({
                                    cols: dims.cols,
                                    rows: dims.rows
                                });
                            }
                        }, 0);

                        // Handle input
                        term.onData(data => {
                            window.webkit.messageHandlers.terminalInput.postMessage(data);
                        });

                        // Handle resize
                        term.onResize(({ cols, rows }) => {
                            window.webkit.messageHandlers.terminalResize.postMessage({ cols, rows });
                        });

                        // Process buffered data
                        isReady = true;
                        buffer.forEach(data => writeToTerminal(data));
                        buffer = [];

                        // Notify ready
                        window.webkit.messageHandlers.terminalReady.postMessage({});

                        log('Terminal initialized');
                    }

                    function writeToTerminal(data) {
                        if (!isReady) {
                            buffer.push(data);
                            return;
                        }
                        term.write(data);
                    }

                    function updateFontSize(size) {
                        if (term) {
                            term.options.fontSize = size;
                            fitAddon.fit();
                        }
                    }

                    function updateTheme(theme) {
                        if (term && theme) {
                            term.options.theme = theme;
                        }
                    }

                    function scrollToBottom() {
                        if (term) {
                            term.scrollToBottom();
                        }
                    }

                    function clear() {
                        if (term) {
                            term.clear();
                        }
                    }

                    function resize() {
                        if (fitAddon) {
                            fitAddon.fit();
                        }
                    }

                    // Expose functions to native
                    window.xtermAPI = {
                        writeToTerminal,
                        updateFontSize,
                        updateTheme,
                        scrollToBottom,
                        clear,
                        resize
                    };

                    // Initialize terminal when page loads
                    window.addEventListener('load', initTerminal);

                    // Handle window resize
                    window.addEventListener('resize', () => {
                        if (fitAddon) {
                            setTimeout(() => {
                                fitAddon.fit();
                            }, 100);
                        }
                    });
                </script>
            </body>
            </html>
            """

            webView.loadHTMLString(html, baseURL: nil)
            webView.navigationDelegate = self
        }

        func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage
        ) {
            switch message.name {
            case "terminalInput":
                if let data = message.body as? String {
                    parent.onInput(data)
                }

            case "terminalResize":
                if let dict = message.body as? [String: Any],
                   let cols = dict["cols"] as? Int,
                   let rows = dict["rows"] as? Int
                {
                    parent.onResize(cols, rows)
                }

            case "terminalReady":
                setupDataStreaming()

            case "terminalLog":
                if let log = message.body as? String {
                    logger.debug(log)
                }

            default:
                break
            }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation?) {
            logger.info("Page loaded")
        }

        private func setupDataStreaming() {
            // Subscribe to WebSocket buffer updates
            if bufferWebSocketClient == nil {
                bufferWebSocketClient = parent.viewModel.bufferWebSocketClient
            }

            bufferWebSocketClient?.subscribe(to: parent.session.id) { [weak self] event in
                self?.handleWebSocketEvent(event)
            }

            // Also set up SSE as fallback
            if let streamURL = APIClient.shared.streamURL(for: parent.session.id) {
                sseClient = SSEClient(url: streamURL)
                sseClient?.delegate = self
                sseClient?.start()
            }
        }

        private func handleWebSocketEvent(_ event: TerminalWebSocketEvent) {
            switch event {
            case .bufferUpdate(let snapshot):
                // Convert buffer snapshot to terminal output
                renderBufferSnapshot(snapshot)

            case .output(_, let data):
                writeToTerminal(data)

            case .resize:
                // Handle resize if needed
                break

            case .bell:
                // Could play a sound or visual bell
                break

            default:
                break
            }
        }

        private func renderBufferSnapshot(_ snapshot: BufferSnapshot) {
            // For now, we'll just write the text content
            // In a full implementation, we'd convert the buffer cells to ANSI sequences
            var output = ""
            for row in snapshot.cells {
                for cell in row {
                    output += cell.char
                }
                output += "\r\n"
            }
            writeToTerminal(output)
        }

        private func writeToTerminal(_ data: String) {
            let escaped = data
                .replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "'", with: "\\'")
                .replacingOccurrences(of: "\n", with: "\\n")
                .replacingOccurrences(of: "\r", with: "\\r")

            webView?.evaluateJavaScript("window.xtermAPI.writeToTerminal('\(escaped)')") { _, error in
                if let error {
                    self.logger.error("Error writing to terminal: \(error)")
                }
            }
        }

        func updateFontSize(_ size: CGFloat) {
            webView?.evaluateJavaScript("window.xtermAPI.updateFontSize(\(size))")
        }

        func updateTheme(_ theme: TerminalTheme) {
            // Convert theme to xterm.js format
            let themeJS = """
            {
                background: '\(theme.background.hex)',
                foreground: '\(theme.foreground.hex)',
                cursor: '\(theme.cursor.hex)',
                selection: 'rgba(255, 255, 255, 0.3)'
            }
            """
            webView?.evaluateJavaScript("window.xtermAPI.updateTheme(\(themeJS))")
        }

        func scrollToBottom() {
            webView?.evaluateJavaScript("window.xtermAPI.scrollToBottom()")
        }

        func clear() {
            webView?.evaluateJavaScript("window.xtermAPI.clear()")
        }
    }
}

// MARK: - SSEClientDelegate

@MainActor
extension XtermWebView.Coordinator: SSEClientDelegate {
    nonisolated func sseClient(_ client: SSEClient, didReceiveEvent event: SSEClient.SSEEvent) {
        Task { @MainActor in
            switch event {
            case .terminalOutput(_, let type, let data):
                if type == "o" { // output
                    writeToTerminal(data)
                }
            case .exit(let exitCode, _):
                writeToTerminal("\r\n[Process exited with code \(exitCode)]\r\n")
            case .error(let error):
                logger.error("SSE error: \(error)")
            }
        }
    }
}

/// Helper extension for Color to hex
extension Color {
    var hex: String {
        let uiColor = UIColor(self)
        var red: CGFloat = 0
        var green: CGFloat = 0
        var blue: CGFloat = 0
        var alpha: CGFloat = 0

        uiColor.getRed(&red, green: &green, blue: &blue, alpha: &alpha)

        return String(
            format: "#%02X%02X%02X",
            Int(red * 255),
            Int(green * 255),
            Int(blue * 255)
        )
    }
}
