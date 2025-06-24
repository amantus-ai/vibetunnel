import AppKit
import SwiftUI
import WebKit

struct TerminalView: NSViewRepresentable {
    let manager: TerminalManager
    let targetColumnWidth: Int
    let fontSize: Double
    
    func makeNSView(context: Context) -> NSScrollView {
        let scrollView = NSScrollView()
        let textView = NSTextView()
        
        // Configure text view
        textView.isEditable = false
        textView.isSelectable = true
        textView.isRichText = false
        textView.importsGraphics = false
        textView.backgroundColor = NSColor(Theme.Colors.terminalBackground)
        textView.textColor = NSColor(Theme.Colors.terminalText)
        textView.font = NSFont.monospacedSystemFont(ofSize: CGFloat(fontSize), weight: .regular)
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticTextReplacementEnabled = false
        textView.isAutomaticSpellingCorrectionEnabled = false
        textView.isAutomaticTextCompletionEnabled = false
        textView.allowsUndo = false
        
        // Configure container
        textView.textContainer?.containerSize = CGSize(width: scrollView.frame.width, height: .greatestFiniteMagnitude)
        textView.textContainer?.widthTracksTextView = true
        textView.textContainer?.lineBreakMode = .byCharWrapping
        
        // Set up scroll view
        scrollView.documentView = textView
        scrollView.hasVerticalScroller = true
        scrollView.hasHorizontalScroller = false
        scrollView.autohidesScrollers = false
        scrollView.borderType = .noBorder
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        
        // Store references in context
        context.coordinator.textView = textView
        context.coordinator.scrollView = scrollView
        
        // Post notification for scroll monitoring
        NotificationCenter.default.post(name: .terminalScrollViewChanged, object: scrollView)
        
        // Set delegate
        textView.delegate = context.coordinator
        
        // Create context menu
        let menu = NSMenu()
        let copyItem = NSMenuItem(title: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        let pasteItem = NSMenuItem(title: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        menu.addItem(copyItem)
        menu.addItem(pasteItem)
        textView.menu = menu
        
        return scrollView
    }
    
    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        guard let textView = scrollView.documentView as? NSTextView else { return }
        
        // Update font if changed
        let newFont = NSFont.monospacedSystemFont(ofSize: CGFloat(fontSize), weight: .regular)
        if textView.font != newFont {
            textView.font = newFont
        }
        
        // Update text if changed
        if textView.string != manager.terminalOutput {
            let shouldScroll = context.coordinator.shouldAutoScroll(scrollView: scrollView)
            
            textView.string = manager.terminalOutput
            
            // Apply ANSI colors and formatting
            if let textStorage = textView.textStorage {
                context.coordinator.applyANSIFormatting(to: textStorage, fontSize: fontSize)
            }
            
            // Auto-scroll if at bottom
            if shouldScroll {
                textView.scrollToEndOfDocument(nil)
            }
        }
        
        // Calculate terminal dimensions
        context.coordinator.updateDimensions(scrollView: scrollView)
    }
    
    func makeCoordinator() -> Coordinator {
        Coordinator(manager: manager, parent: self)
    }
    
    class Coordinator: NSObject, NSTextViewDelegate {
        let manager: TerminalManager
        let parent: TerminalView
        weak var textView: NSTextView?
        weak var scrollView: NSScrollView?
        private var lastCols: Int = 0
        private var lastRows: Int = 0
        
        init(manager: TerminalManager, parent: TerminalView) {
            self.manager = manager
            self.parent = parent
        }
        
        @MainActor
        func shouldAutoScroll(scrollView: NSScrollView) -> Bool {
            guard let documentView = scrollView.documentView else { return true }
            
            let visibleRect = scrollView.visibleRect
            let documentRect = documentView.frame
            
            // Check if we're near the bottom (within 50 pixels)
            return visibleRect.maxY >= documentRect.maxY - 50
        }
        
        func applyANSIFormatting(to textStorage: NSTextStorage, fontSize: Double) {
            // Parse ANSI codes and apply formatting
            let baseFont = NSFont.monospacedSystemFont(ofSize: CGFloat(fontSize), weight: .regular)
            let attributedString = ANSIParser.parse(textStorage.string, baseFont: baseFont)
            
            textStorage.beginEditing()
            textStorage.setAttributedString(attributedString)
            textStorage.endEditing()
        }
        
        // Handle keyboard input
        func textView(_ textView: NSTextView, doCommandBy commandSelector: Selector) -> Bool {
            // Get the event
            guard let event = NSApp.currentEvent else { return false }
            
            // Handle copy/paste commands
            switch commandSelector {
            case #selector(NSText.copy(_:)):
                // Let the system handle copy
                return false
            case #selector(NSText.paste(_:)):
                // Handle paste ourselves
                handlePaste()
                return true
            case #selector(NSText.cut(_:)):
                // Terminal doesn't support cut
                return true
            default:
                break
            }
            
            var input = ""
            
            // Handle special keys
            switch commandSelector {
            case #selector(NSResponder.insertNewline(_:)):
                input = "\n"
            case #selector(NSResponder.insertTab(_:)):
                input = "\t"
            case #selector(NSResponder.deleteBackward(_:)):
                input = "\u{7F}" // DEL character
            case #selector(NSResponder.moveUp(_:)):
                input = "\u{1B}[A" // Arrow up
            case #selector(NSResponder.moveDown(_:)):
                input = "\u{1B}[B" // Arrow down
            case #selector(NSResponder.moveRight(_:)):
                input = "\u{1B}[C" // Arrow right
            case #selector(NSResponder.moveLeft(_:)):
                input = "\u{1B}[D" // Arrow left
            default:
                // Handle regular characters
                if let characters = event.characters {
                    input = characters
                }
            }
            
            if !input.isEmpty {
                manager.sendInput(input)
                return true
            }
            
            return false
        }
        
        // Make text view first responder for keyboard input
        func textViewDidChangeSelection(_ notification: Notification) {
            textView?.window?.makeFirstResponder(textView)
        }
        
        // Handle clicks on links
        func textView(_ textView: NSTextView, clickedOnLink link: Any, at charIndex: Int) -> Bool {
            if let urlString = link as? String {
                // Validate URL before opening
                if URL(string: urlString) != nil {
                    URLDetector.openURL(urlString)
                    return true
                }
            }
            return false
        }
        
        // Handle paste from clipboard
        @MainActor
        private func handlePaste() {
            let pasteboard = NSPasteboard.general
            if let string = pasteboard.string(forType: .string) {
                // Send the pasted text to the terminal
                manager.sendInput(string)
            }
        }
        
        @MainActor
        func updateDimensions(scrollView: NSScrollView) {
            guard let textView = scrollView.documentView as? NSTextView else { return }
            
            // Get font metrics
            let font = textView.font ?? NSFont.monospacedSystemFont(ofSize: CGFloat(parent.fontSize), weight: .regular)
            let layoutManager = NSLayoutManager()
            let textContainer = NSTextContainer()
            let textStorage = NSTextStorage(string: "W")
            textStorage.addLayoutManager(layoutManager)
            layoutManager.addTextContainer(textContainer)
            textStorage.font = font
            
            // Ensure layout manager has processed the text
            layoutManager.ensureLayout(for: textContainer)
            
            // Calculate character dimensions
            let charRect = layoutManager.lineFragmentRect(forGlyphAt: 0, effectiveRange: nil)
            let charWidth = charRect.width > 0 ? charRect.width : 7.0 // Default to 7.0 if invalid
            let lineHeight = layoutManager.defaultLineHeight(for: font)
            let effectiveLineHeight = lineHeight > 0 ? lineHeight : 16.0 // Default to 16.0 if invalid
            
            // Calculate terminal dimensions based on visible area
            let visibleRect = scrollView.visibleRect
            
            // Guard against zero-sized visible rect or invalid large sizes
            guard visibleRect.width > 0 && visibleRect.height > 0 && visibleRect.width < CGFloat(Int.max) && visibleRect.height < CGFloat(Int.max) else {
                return
            }
            
            var cols = max(1, Int(visibleRect.width / charWidth))
            let rows = max(1, Int(visibleRect.height / effectiveLineHeight))
            
            // Apply column width constraint if set
            if parent.targetColumnWidth > 0 {
                cols = min(cols, parent.targetColumnWidth)
            }
            
            // Only update if dimensions changed
            if cols != lastCols || rows != lastRows {
                lastCols = cols
                lastRows = rows
                manager.resize(cols: cols, rows: rows)
            }
        }
    }
}

// Alternative WebView-based terminal for xterm.js compatibility
struct WebTerminalView: NSViewRepresentable {
    let manager: TerminalManager
    let targetColumnWidth: Int
    let fontSize: Double
    
    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        
        // Add message handlers
        configuration.userContentController.add(context.coordinator, name: "terminalInput")
        configuration.userContentController.add(context.coordinator, name: "terminalResize")
        configuration.userContentController.add(context.coordinator, name: "terminalReady")
        configuration.userContentController.add(context.coordinator, name: "terminalLog")
        
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        
        // Store reference
        context.coordinator.webView = webView
        
        // Load xterm.js based terminal
        let html = """
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css">
            <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/css/xterm-addon-fit.css">
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { 
                    background: #000; 
                    overflow: hidden;
                    -webkit-user-select: none;
                }
                #terminal { 
                    width: 100vw; 
                    height: 100vh;
                }
                .xterm { height: 100%; }
                .xterm-viewport { overflow-y: auto !important; }
            </style>
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
                        fontSize: \(Int(fontSize)),
                        fontFamily: 'SF Mono, Monaco, Menlo, monospace',
                        theme: {
                            background: '#000000',
                            foreground: '#e5e5e5',
                            cursor: '#e5e5e5',
                            black: '#000000',
                            red: '#cc0000',
                            green: '#00cc00',
                            yellow: '#cccc00',
                            blue: '#0000cc',
                            magenta: '#cc00cc',
                            cyan: '#00cccc',
                            white: '#cccccc',
                            brightBlack: '#666666',
                            brightRed: '#ff0000',
                            brightGreen: '#00ff00',
                            brightYellow: '#ffff00',
                            brightBlue: '#0000ff',
                            brightMagenta: '#ff00ff',
                            brightCyan: '#00ffff',
                            brightWhite: '#ffffff'
                        },
                        cursorBlink: true,
                        scrollback: 10000,
                        allowTransparency: false
                    });
                    
                    // Initialize addons
                    fitAddon = new FitAddon.FitAddon();
                    term.loadAddon(fitAddon);
                    
                    const webLinksAddon = new WebLinksAddon.WebLinksAddon();
                    term.loadAddon(webLinksAddon);
                    
                    // Open terminal
                    term.open(document.getElementById('terminal'));
                    
                    // Handle resize
                    window.addEventListener('resize', () => {
                        fitAddon.fit();
                        const dimensions = fitAddon.proposeDimensions();
                        if (dimensions) {
                            window.webkit.messageHandlers.terminalResize.postMessage({
                                cols: dimensions.cols,
                                rows: dimensions.rows
                            });
                        }
                    });
                    
                    // Initial fit
                    setTimeout(() => {
                        fitAddon.fit();
                        const dimensions = fitAddon.proposeDimensions();
                        if (dimensions) {
                            window.webkit.messageHandlers.terminalResize.postMessage({
                                cols: dimensions.cols,
                                rows: dimensions.rows
                            });
                        }
                        
                        isReady = true;
                        window.webkit.messageHandlers.terminalReady.postMessage('ready');
                        
                        // Process buffered data
                        if (buffer.length > 0) {
                            buffer.forEach(data => term.write(data));
                            buffer = [];
                        }
                    }, 100);
                    
                    // Handle input
                    term.onData((data) => {
                        window.webkit.messageHandlers.terminalInput.postMessage(data);
                    });
                    
                    // Focus terminal
                    term.focus();
                }
                
                // Function to write data to terminal
                window.writeToTerminal = function(data) {
                    if (!isReady || !term) {
                        buffer.push(data);
                    } else {
                        console.log('[xterm.js] Writing data:', data.length, 'chars');
                        term.write(data);
                    }
                };
                
                // Function to update font size
                window.updateFontSize = function(size) {
                    if (term) {
                        term.options.fontSize = size;
                        fitAddon.fit();
                    }
                };
                
                // Initialize on load
                window.addEventListener('load', initTerminal);
            </script>
        </body>
        </html>
        """
        
        webView.loadHTMLString(html, baseURL: nil)
        
        return webView
    }
    
    func updateNSView(_ webView: WKWebView, context: Context) {
        // Update font size if changed
        let script = "window.updateFontSize && window.updateFontSize(\(Int(fontSize)));"
        webView.evaluateJavaScript(script)
    }
    
    func makeCoordinator() -> WebCoordinator {
        WebCoordinator(manager: manager, fontSize: fontSize)
    }
    
    class WebCoordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        let manager: TerminalManager
        let fontSize: Double
        weak var webView: WKWebView?
        private var updateTimer: Timer?
        private var lastOutput = ""
        private var isReady = false
        
        init(manager: TerminalManager, fontSize: Double) {
            self.manager = manager
            self.fontSize = fontSize
            super.init()
            setupObservers()
        }
        
        deinit {
            // Timer will be invalidated when deallocated
        }
        
        private func setupObservers() {
            // Since TerminalManager uses @Observable, we need to observe changes differently
            // Start a timer to check for output changes
            updateTimer = Timer.scheduledTimer(withTimeInterval: 0.016, repeats: true) { [weak self] _ in
                Task { @MainActor in
                    self?.checkForOutputChanges()
                }
            }
        }
        
        private func checkForOutputChanges() {
            guard isReady else { return }
            
            let currentOutput = manager.terminalOutput
            if currentOutput != lastOutput {
                // Calculate the diff - only send new content
                let newContent: String
                if currentOutput.hasPrefix(lastOutput) {
                    // Common case: new content appended
                    newContent = String(currentOutput.dropFirst(lastOutput.count))
                } else {
                    // Terminal was cleared or content changed significantly
                    // Send clear command followed by all content
                    clearTerminal()
                    newContent = currentOutput
                }
                
                if !newContent.isEmpty {
                    sendToTerminal(newContent)
                }
                
                lastOutput = currentOutput
            }
        }
        
        private func clearTerminal() {
            guard let webView = webView else { return }
            
            let script = """
                if (window.term) {
                    console.log('[xterm.js] Clearing terminal');
                    window.term.clear();
                    window.term.reset();
                }
            """
            
            webView.evaluateJavaScript(script)
        }
        
        private func sendToTerminal(_ text: String) {
            guard let webView = webView else { return }
            
            // Escape the text for JavaScript
            let escapedText = text
                .replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "\"", with: "\\\"")
                .replacingOccurrences(of: "\n", with: "\\n")
                .replacingOccurrences(of: "\r", with: "\\r")
                .replacingOccurrences(of: "\t", with: "\\t")
            
            let script = """
                window.writeToTerminal && window.writeToTerminal("\(escapedText)");
            """
            
            webView.evaluateJavaScript(script)
        }
        
        // WKScriptMessageHandler
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            switch message.name {
            case "terminalInput":
                if let input = message.body as? String {
                    manager.sendInput(input)
                }
                
            case "terminalResize":
                if let dict = message.body as? [String: Any],
                   let cols = dict["cols"] as? Int,
                   let rows = dict["rows"] as? Int {
                    manager.resize(cols: cols, rows: rows)
                }
                
            case "terminalReady":
                // Terminal is ready
                isReady = true
                // Send any existing output
                if !manager.terminalOutput.isEmpty {
                    lastOutput = ""
                    checkForOutputChanges()
                }
                
            case "terminalLog":
                if let log = message.body as? String {
                    print("[xterm.js] \(log)")
                }
                
            default:
                break
            }
        }
        
        // WKNavigationDelegate
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            // WebView loaded, terminal will initialize automatically
        }
    }
}
