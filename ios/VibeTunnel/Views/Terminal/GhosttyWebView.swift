import SwiftUI
import WebKit

/// WebView-based terminal using ghostty-web (WASM + canvas).
struct GhosttyWebView: UIViewRepresentable {
    struct TerminalSize: Equatable {
        let cols: Int
        let rows: Int
    }

    @Binding var fontSize: CGFloat
    let theme: TerminalTheme
    let onInput: ((String) -> Void)?
    let onResize: ((Int, Int) -> Void)?
    var viewModel: TerminalViewModel?
    var disableInput = false
    var terminalSize: TerminalSize?
    var onReady: ((Coordinator) -> Void)?

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.userContentController = WKUserContentController()

        configuration.userContentController.add(context.coordinator, name: "terminalInput")
        configuration.userContentController.add(context.coordinator, name: "terminalResize")
        configuration.userContentController.add(context.coordinator, name: "terminalReady")
        configuration.userContentController.add(context.coordinator, name: "terminalScroll")
        configuration.userContentController.add(context.coordinator, name: "terminalLog")

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.isOpaque = false
        webView.backgroundColor = UIColor(self.theme.background)
        webView.scrollView.isScrollEnabled = false

        context.coordinator.webView = webView
        context.coordinator.loadTerminal()

        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        webView.backgroundColor = UIColor(self.theme.background)
        context.coordinator.updateFontSize(self.fontSize)
        context.coordinator.updateTheme(self.theme)
        context.coordinator.updateTerminalSize(self.terminalSize)
        context.coordinator.requestFit()
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    @MainActor
    class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate, TerminalCoordinating {
        let parent: GhosttyWebView
        weak var webView: WKWebView?
        private let logger = Logger(category: "GhosttyWebView")
        private var bufferRenderer = TerminalBufferRenderer()
        private var isReady = false
        private var pendingTerminalSize: TerminalSize?
        private var lastTerminalSize: TerminalSize?

        init(_ parent: GhosttyWebView) {
            self.parent = parent
            super.init()

            if let viewModel = parent.viewModel {
                viewModel.terminalCoordinator = self
            }
            parent.onReady?(self)
        }

        func loadTerminal() {
            guard let webView else { return }

            let themeJSON = self.makeThemeJSON(self.parent.theme)
            let fontFamilyJSON = self.makeFontFamilyJSON()
            let disableInput = self.parent.disableInput ? "true" : "false"

            let html = """
            <!DOCTYPE html>
            <html>
            <head>
                <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no\">
                <style>
                    html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }
                    body { background: transparent; -webkit-user-select: none; -webkit-touch-callout: none; }
                    #terminal { width: 100vw; height: 100vh; }
                    canvas { display: block; }
                </style>
            </head>
            <body>
                <div id=\"terminal\"></div>
                <script src=\"ghostty-web.js\"></script>
                <script>
                    const initialTheme = \(themeJSON);
                    const fontFamily = \(fontFamilyJSON);
                    const initialFontSize = \(parent.fontSize);
                    const disableInput = \(disableInput);

                    let term;
                    let fitAddon;
                    let ready = false;
                    let suppressResizeEvent = false;
                    const bufferQueue = [];

                    function post(name, payload) {
                        window.webkit.messageHandlers[name].postMessage(payload);
                    }

                    async function loadGhostty() {
                        try {
                            return await GhosttyWeb.Ghostty.load('ghostty-vt.wasm');
                        } catch (err) {
                            post('terminalLog', 'ghostty wasm load failed, falling back to embedded: ' + err);
                            return await GhosttyWeb.Ghostty.load();
                        }
                    }

                    async function initTerminal() {
                        try {
                            const ghostty = await loadGhostty();
                            term = new GhosttyWeb.Terminal({
                                cols: 80,
                                rows: 24,
                                fontSize: initialFontSize,
                                fontFamily,
                                theme: initialTheme,
                                cursorBlink: true,
                                scrollback: 10000,
                                disableStdin: disableInput,
                                ghostty
                            });

                            fitAddon = new GhosttyWeb.FitAddon();
                            term.loadAddon(fitAddon);

                            term.onData((data) => {
                                if (!disableInput) {
                                    post('terminalInput', data);
                                }
                            });

                            term.onResize(({ cols, rows }) => {
                                if (suppressResizeEvent) {
                                    suppressResizeEvent = false;
                                    return;
                                }
                                post('terminalResize', { cols, rows });
                            });

                            term.onScroll(() => {
                                const atBottom = term.getViewportY() <= 0.5;
                                post('terminalScroll', { atBottom });
                            });

                            term.open(document.getElementById('terminal'));

                            fitAddon.fit();
                            const dims = fitAddon.proposeDimensions();
                            if (dims) {
                                post('terminalResize', { cols: dims.cols, rows: dims.rows });
                            }

                            ready = true;
                            bufferQueue.forEach(({ data, followCursor }) => writeToTerminal(data, followCursor));
                            bufferQueue.length = 0;

                            post('terminalReady', {});
                        } catch (err) {
                            post('terminalLog', 'ghostty init failed: ' + err);
                        }
                    }

                    function writeToTerminal(data, followCursor = true) {
                        if (!ready) {
                            bufferQueue.push({ data, followCursor });
                            return;
                        }
                        term.write(data, () => {
                            if (followCursor) term.scrollToBottom();
                        });
                    }

                    function updateFontSize(size) {
                        if (!term) return;
                        term.options.fontSize = size;
                        if (fitAddon) fitAddon.fit();
                    }

                    function updateTheme(theme) {
                        if (!term || !theme) return;
                        term.options.theme = theme;
                    }

                    function scrollToBottom() {
                        if (term) term.scrollToBottom();
                    }

                    function clear() {
                        if (term) term.clear();
                    }

                    function resize() {
                        if (fitAddon) fitAddon.fit();
                    }

                    function setTerminalSize(cols, rows) {
                        if (!term) return;
                        suppressResizeEvent = true;
                        term.resize(cols, rows);
                    }

                    window.ghosttyAPI = {
                        writeToTerminal,
                        updateFontSize,
                        updateTheme,
                        scrollToBottom,
                        clear,
                        resize,
                        setTerminalSize
                    };

                    window.addEventListener('load', initTerminal);
                    window.addEventListener('resize', () => {
                        if (fitAddon) {
                            setTimeout(() => fitAddon.fit(), 100);
                        }
                    });
                </script>
            </body>
            </html>
            """

            guard let ghosttyURL = Bundle.main.url(
                forResource: "ghostty-web",
                withExtension: "js",
                subdirectory: "ghostty")
            else {
                self.logger.error("ghostty-web.js missing from bundle")
                return
            }

            let baseURL = ghosttyURL.deletingLastPathComponent()
            webView.loadHTMLString(html, baseURL: baseURL)
            webView.navigationDelegate = self
        }

        func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage)
        {
            switch message.name {
            case "terminalInput":
                if let data = message.body as? String {
                    self.parent.onInput?(data)
                }

            case "terminalResize":
                if let dict = message.body as? [String: Any],
                   let cols = dict["cols"] as? Int,
                   let rows = dict["rows"] as? Int
                {
                    self.parent.onResize?(cols, rows)
                }

            case "terminalScroll":
                if let dict = message.body as? [String: Any],
                   let atBottom = dict["atBottom"] as? Bool
                {
                    self.parent.viewModel?.updateScrollState(isAtBottom: atBottom)
                }

            case "terminalReady":
                self.handleTerminalReady()

            case "terminalLog":
                if let log = message.body as? String {
                    self.logger.debug(log)
                }

            default:
                break
            }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation?) {
            self.logger.info("Ghostty terminal page loaded")
        }

        func updateTerminalSize(_ size: TerminalSize?) {
            guard let size else { return }
            if size == self.lastTerminalSize { return }
            self.lastTerminalSize = size

            if self.isReady {
                self.setTerminalSize(cols: size.cols, rows: size.rows)
            } else {
                self.pendingTerminalSize = size
            }
        }

        func handleTerminalReady() {
            self.isReady = true
            if let size = pendingTerminalSize {
                self.setTerminalSize(cols: size.cols, rows: size.rows)
                self.pendingTerminalSize = nil
            }
        }

        func updateFontSize(_ size: CGFloat) {
            self.webView?.evaluateJavaScript("window.ghosttyAPI.updateFontSize(\(size))")
        }

        func updateTheme(_ theme: TerminalTheme) {
            let themeJSON = self.makeThemeJSON(theme)
            self.webView?.evaluateJavaScript("window.ghosttyAPI.updateTheme(\(themeJSON))")
        }

        func requestFit() {
            self.webView?.evaluateJavaScript("window.ghosttyAPI.resize()")
        }

        private func setTerminalSize(cols: Int, rows: Int) {
            self.webView?.evaluateJavaScript("window.ghosttyAPI.setTerminalSize(\(cols), \(rows))")
        }

        func feedData(_ data: String) {
            let followCursor = self.parent.viewModel?.isAutoScrollEnabled ?? true
            guard let payload = jsonString(data) else { return }
            self.webView?
                .evaluateJavaScript("window.ghosttyAPI.writeToTerminal(\(payload), \(followCursor ? "true" : "false"))")
        }

        func updateBuffer(from snapshot: BufferSnapshot) {
            let result = self.bufferRenderer.render(from: snapshot)
            if result.resized {
                self.setTerminalSize(cols: result.cols, rows: result.rows)
            }
            if !result.ansi.isEmpty {
                self.feedData(result.ansi)
            }
        }

        func scrollToBottom() {
            self.webView?.evaluateJavaScript("window.ghosttyAPI.scrollToBottom()")
        }

        func clear() {
            self.webView?.evaluateJavaScript("window.ghosttyAPI.clear()")
        }

        func setMaxWidth(_ maxWidth: Int) {
            self.logger.info("Max width set to: \(maxWidth == 0 ? "unlimited" : "\(maxWidth) columns")")
        }

        func getBufferContent() -> String? {
            self.bufferRenderer.bufferContent()
        }

        private func makeThemeJSON(_ theme: TerminalTheme) -> String {
            let themeDict: [String: String] = [
                "background": theme.background.hex,
                "foreground": theme.foreground.hex,
                "cursor": theme.cursor.hex,
                "selection": theme.selection.hex,
                "black": theme.black.hex,
                "red": theme.red.hex,
                "green": theme.green.hex,
                "yellow": theme.yellow.hex,
                "blue": theme.blue.hex,
                "magenta": theme.magenta.hex,
                "cyan": theme.cyan.hex,
                "white": theme.white.hex,
                "brightBlack": theme.brightBlack.hex,
                "brightRed": theme.brightRed.hex,
                "brightGreen": theme.brightGreen.hex,
                "brightYellow": theme.brightYellow.hex,
                "brightBlue": theme.brightBlue.hex,
                "brightMagenta": theme.brightMagenta.hex,
                "brightCyan": theme.brightCyan.hex,
                "brightWhite": theme.brightWhite.hex,
            ]

            return self.jsonString(themeDict) ?? "{}"
        }

        private func makeFontFamilyJSON() -> String {
            let fontFamily = "\(Theme.Typography.terminalFont), \(Theme.Typography.terminalFontFallback), monospace"
            return self.jsonString(fontFamily) ?? "\"monospace\""
        }

        private func jsonString(_ value: Any) -> String? {
            guard let data = try? JSONSerialization.data(withJSONObject: value) else { return nil }
            return String(data: data, encoding: .utf8)
        }
    }
}

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
            Int(blue * 255))
    }
}
