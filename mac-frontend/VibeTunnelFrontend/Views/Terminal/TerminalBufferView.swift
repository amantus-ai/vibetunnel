import SwiftUI
import AppKit

/// A terminal view that uses the binary buffer protocol for live updates
struct TerminalBufferView: NSViewRepresentable {
    let sessionId: String
    @State private var preferences: TerminalPreferences
    @Environment(SessionManager.self) private var sessionManager
    @State private var buffer: TerminalBufferSnapshot?
    
    init(sessionId: String) {
        self.sessionId = sessionId
        self._preferences = State(initialValue: TerminalPreferences.load(for: sessionId))
    }
    
    func makeNSView(context: Context) -> NSScrollView {
        let scrollView = NSScrollView()
        scrollView.hasVerticalScroller = true
        scrollView.hasHorizontalScroller = true
        scrollView.autohidesScrollers = false
        scrollView.borderType = .noBorder
        scrollView.backgroundColor = NSColor(Theme.Colors.terminalBackground)
        
        let textView = NSTextView()
        textView.isEditable = false
        textView.isSelectable = true
        textView.isRichText = true
        textView.backgroundColor = NSColor(Theme.Colors.terminalBackground)
        textView.font = NSFont.monospacedSystemFont(ofSize: CGFloat(preferences.fontSize), weight: .regular)
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticTextReplacementEnabled = false
        textView.isAutomaticSpellingCorrectionEnabled = false
        textView.textContainerInset = NSSize(width: 8, height: 8)
        textView.isAutomaticLinkDetectionEnabled = false // We handle this manually
        textView.displaysLinkToolTips = true
        
        scrollView.documentView = textView
        
        context.coordinator.textView = textView
        context.coordinator.scrollView = scrollView
        
        // Delay subscription to ensure BufferSubscriptionService is configured
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            context.coordinator.subscribe()
        }
        
        // Set delegate for keyboard input
        textView.delegate = context.coordinator
        
        // Make it first responder to receive keyboard input
        DispatchQueue.main.async {
            textView.window?.makeFirstResponder(textView)
        }
        
        return scrollView
    }
    
    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        if let textView = scrollView.documentView as? NSTextView {
            // Calculate font size for horizontal fit if enabled
            let fontSize = calculateFontSize(for: scrollView, context: context)
            textView.font = NSFont.monospacedSystemFont(ofSize: fontSize, weight: .regular)
            
            // Update coordinator's view width and preferences for resize calculations
            context.coordinator.viewWidth = scrollView.visibleRect.width
            context.coordinator.preferences = preferences
        }
        
        if let buffer = context.coordinator.buffer {
            context.coordinator.updateDisplay(buffer)
        }
    }
    
    func makeCoordinator() -> Coordinator {
        Coordinator(sessionId: sessionId, preferences: preferences, sessionManager: sessionManager)
    }
    
    static func dismantleNSView(_ nsView: NSScrollView, coordinator: Coordinator) {
        coordinator.cleanup()
    }
    
    private func calculateFontSize(for scrollView: NSScrollView, context: Context) -> CGFloat {
        guard preferences.fitHorizontally && preferences.maxColumns > 0 else {
            return CGFloat(preferences.fontSize)
        }
        
        let visibleWidth = scrollView.visibleRect.width - 16 // Account for padding
        
        // Binary search for the optimal font size
        var minSize = CGFloat(TerminalPreferences.minFontSize)
        var maxSize = CGFloat(min(preferences.fontSize, TerminalPreferences.maxFontSize))
        var optimalSize = CGFloat(preferences.fontSize)
        
        while maxSize - minSize > 0.5 {
            let testSize = (minSize + maxSize) / 2
            let testFont = NSFont.monospacedSystemFont(ofSize: testSize, weight: .regular)
            
            // Measure character width
            let attributes = [NSAttributedString.Key.font: testFont]
            let charSize = "W".size(withAttributes: attributes)
            let totalWidth = charSize.width * CGFloat(preferences.maxColumns)
            
            if totalWidth <= visibleWidth {
                optimalSize = testSize
                minSize = testSize
            } else {
                maxSize = testSize
            }
        }
        
        return optimalSize
    }
    
    @MainActor
    class Coordinator: NSObject, NSTextViewDelegate {
        let sessionId: String
        var preferences: TerminalPreferences
        weak var textView: NSTextView?
        weak var scrollView: NSScrollView?
        var buffer: TerminalBufferSnapshot?
        var unsubscribe: (() -> Void)?
        var sessionManager: SessionManager
        private var lastCursorY: Int = 0
        var viewWidth: CGFloat = 0
        
        init(sessionId: String, preferences: TerminalPreferences, sessionManager: SessionManager) {
            self.sessionId = sessionId
            self.preferences = preferences
            self.sessionManager = sessionManager
            super.init()
        }
        
        func subscribe() {
            guard !sessionId.isEmpty else {
                print("TerminalBufferView: Cannot subscribe with empty session ID")
                return
            }
            
            print("TerminalBufferView: Subscribing to session \(sessionId)")
            unsubscribe = BufferSubscriptionService.shared.subscribe(sessionId: sessionId) { [weak self] snapshot in
                Task { @MainActor in
                    self?.handleBufferUpdate(snapshot)
                }
            }
        }
        
        @MainActor
        private func handleBufferUpdate(_ snapshot: TerminalBufferSnapshot) {
            buffer = snapshot
            updateDisplay(snapshot)
        }
        
        @MainActor
        func updateDisplay(_ buffer: TerminalBufferSnapshot) {
            guard let textView = textView else { return }
            
            // Guard against empty buffer
            guard !buffer.cells.isEmpty else {
                textView.string = ""
                return
            }
            
            let attributedString = NSMutableAttributedString()
            let baseFont = NSFont.monospacedSystemFont(ofSize: CGFloat(preferences.fontSize), weight: .regular)
            
            for (rowIndex, row) in buffer.cells.enumerated() {
                for (colIndex, cell) in row.enumerated() {
                    let isCursor = rowIndex == buffer.cursorY && colIndex == buffer.cursorX && buffer.showCursor
                    
                    // Create attributes
                    var attributes: [NSAttributedString.Key: Any] = [
                        .font: baseFont
                    ]
                    
                    // Apply foreground color
                    if let fg = cell.fg {
                        attributes[.foregroundColor] = getColor(fg)
                    } else {
                        attributes[.foregroundColor] = NSColor(Theme.Colors.terminalText)
                    }
                    
                    // Apply background color
                    if isCursor {
                        // Swap foreground and background for cursor
                        attributes[.backgroundColor] = attributes[.foregroundColor]
                        attributes[.foregroundColor] = NSColor(Theme.Colors.terminalBackground)
                    } else if let bg = cell.bg {
                        attributes[.backgroundColor] = getColor(bg)
                    }
                    
                    // Apply text attributes
                    if let attrs = cell.attributes {
                        var traits = NSFontTraitMask()
                        if attrs & ATTR_BOLD != 0 {
                            traits.insert(.boldFontMask)
                        }
                        if attrs & ATTR_ITALIC != 0 {
                            traits.insert(.italicFontMask)
                        }
                        
                        if !traits.isEmpty {
                            if let modifiedFont = NSFontManager.shared.font(
                                withFamily: baseFont.familyName ?? "SF Mono",
                                traits: traits,
                                weight: 0,
                                size: CGFloat(preferences.fontSize)
                            ) {
                                attributes[.font] = modifiedFont
                            }
                        }
                        
                        if attrs & ATTR_UNDERLINE != 0 {
                            attributes[.underlineStyle] = NSUnderlineStyle.single.rawValue
                        }
                        
                        if attrs & ATTR_STRIKETHROUGH != 0 {
                            attributes[.strikethroughStyle] = NSUnderlineStyle.single.rawValue
                        }
                        
                        if attrs & ATTR_DIM != 0 {
                            // Apply dimming by reducing alpha
                            if let color = attributes[.foregroundColor] as? NSColor {
                                attributes[.foregroundColor] = color.withAlphaComponent(0.6)
                            }
                        }
                        
                        if attrs & ATTR_INVERSE != 0 {
                            // Swap foreground and background
                            let temp = attributes[.foregroundColor]
                            attributes[.foregroundColor] = attributes[.backgroundColor] ?? NSColor(Theme.Colors.terminalBackground)
                            attributes[.backgroundColor] = temp
                        }
                    }
                    
                    let char = cell.char.isEmpty ? " " : cell.char
                    attributedString.append(NSAttributedString(string: char, attributes: attributes))
                }
                
                if rowIndex < buffer.cells.count - 1 {
                    attributedString.append(NSAttributedString(string: "\n"))
                }
            }
            
            // Apply URL detection and highlighting
            URLDetector.highlightURLs(in: attributedString)
            
            textView.textStorage?.setAttributedString(attributedString)
            
            // Auto-scroll if cursor moved down
            if buffer.cursorY > lastCursorY {
                scrollToCursor(buffer)
            }
            lastCursorY = buffer.cursorY
        }
        
        private func scrollToCursor(_ buffer: TerminalBufferSnapshot) {
            guard let textView = textView,
                  let scrollView = scrollView,
                  buffer.showCursor else { return }
            
            // Calculate cursor position
            let lineHeight = textView.font?.capHeight ?? 14
            let cursorY = CGFloat(buffer.cursorY) * lineHeight
            
            // Get visible rect
            let visibleRect = scrollView.contentView.visibleRect
            
            // Check if cursor is below visible area
            if cursorY > visibleRect.maxY - lineHeight * 2 {
                // Scroll to show cursor with some margin
                let targetY = cursorY - visibleRect.height + lineHeight * 4
                let targetPoint = NSPoint(x: 0, y: max(0, targetY))
                scrollView.contentView.scroll(to: targetPoint)
            }
        }
        
        private func getColor(_ colorValue: UInt32) -> NSColor {
            if colorValue <= 255 {
                // ANSI palette color
                return getAnsiColor(Int(colorValue))
            } else {
                // RGB color
                let r = CGFloat((colorValue >> 16) & 0xFF) / 255.0
                let g = CGFloat((colorValue >> 8) & 0xFF) / 255.0
                let b = CGFloat(colorValue & 0xFF) / 255.0
                return NSColor(red: r, green: g, blue: b, alpha: 1.0)
            }
        }
        
        private func getAnsiColor(_ index: Int) -> NSColor {
            switch index {
            case 0: return NSColor(Theme.Colors.ansiBlack)
            case 1: return NSColor(Theme.Colors.ansiRed)
            case 2: return NSColor(Theme.Colors.ansiGreen)
            case 3: return NSColor(Theme.Colors.ansiYellow)
            case 4: return NSColor(Theme.Colors.ansiBlue)
            case 5: return NSColor(Theme.Colors.ansiMagenta)
            case 6: return NSColor(Theme.Colors.ansiCyan)
            case 7: return NSColor(Theme.Colors.ansiWhite)
            case 8: return NSColor(Theme.Colors.ansiBrightBlack)
            case 9: return NSColor(Theme.Colors.ansiBrightRed)
            case 10: return NSColor(Theme.Colors.ansiBrightGreen)
            case 11: return NSColor(Theme.Colors.ansiBrightYellow)
            case 12: return NSColor(Theme.Colors.ansiBrightBlue)
            case 13: return NSColor(Theme.Colors.ansiBrightMagenta)
            case 14: return NSColor(Theme.Colors.ansiBrightCyan)
            case 15: return NSColor(Theme.Colors.ansiBrightWhite)
            case 16...231:
                // 216 color cube (6x6x6)
                let idx = index - 16
                let r = (idx / 36) % 6
                let g = (idx / 6) % 6
                let b = idx % 6
                return NSColor(
                    red: CGFloat(r) / 5.0,
                    green: CGFloat(g) / 5.0,
                    blue: CGFloat(b) / 5.0,
                    alpha: 1.0
                )
            case 232...255:
                // Grayscale
                let gray = CGFloat(index - 232) / 23.0
                return NSColor(white: gray, alpha: 1.0)
            default:
                return NSColor(Theme.Colors.terminalText)
            }
        }
        
        func cleanup() {
            unsubscribe?()
            unsubscribe = nil
        }
        
        // MARK: - NSTextViewDelegate
        
        func textView(_ textView: NSTextView, clickedOnLink link: Any, at charIndex: Int) -> Bool {
            if let urlString = link as? String {
                URLDetector.openURL(urlString)
                return true
            }
            return false
        }
        
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
            case #selector(NSResponder.moveToBeginningOfLine(_:)):
                input = "\u{01}" // Ctrl+A
            case #selector(NSResponder.moveToEndOfLine(_:)):
                input = "\u{05}" // Ctrl+E
            case #selector(NSResponder.deleteForward(_:)):
                input = "\u{1B}[3~" // Delete key
            case #selector(NSResponder.pageUp(_:)):
                input = "\u{1B}[5~" // Page Up
            case #selector(NSResponder.pageDown(_:)):
                input = "\u{1B}[6~" // Page Down
            case #selector(NSResponder.moveToBeginningOfDocument(_:)):
                input = "\u{1B}[1;5H" // Ctrl+Home
            case #selector(NSResponder.moveToEndOfDocument(_:)):
                input = "\u{1B}[1;5F" // Ctrl+End
            default:
                // Handle regular characters
                if let characters = event.characters {
                    input = characters
                }
            }
            
            if !input.isEmpty {
                sendInput(input)
                return true
            }
            
            return false
        }
        
        // Make text view first responder for keyboard input
        func textViewDidChangeSelection(_ notification: Notification) {
            textView?.window?.makeFirstResponder(textView)
        }
        
        private func handlePaste() {
            let pasteboard = NSPasteboard.general
            if let string = pasteboard.string(forType: .string) {
                sendInput(string)
            }
        }
        
        private func sendInput(_ input: String) {
            Task {
                guard let serverURL = sessionManager.serverURL else { return }
                
                do {
                    try await APIClient.shared.sendInput(
                        serverURL: serverURL,
                        authHeader: sessionManager.authHeader,
                        sessionId: sessionId,
                        input: input
                    )
                } catch {
                    print("Failed to send input: \(error)")
                }
            }
        }
        
        // Handle terminal resize
        func textViewDidChangeTypingAttributes(_ notification: Notification) {
            // This gets called when the view size changes
            DispatchQueue.main.async { [weak self] in
                self?.calculateAndSendResize()
            }
        }
        
        private func calculateAndSendResize() {
            guard let textView = textView,
                  let buffer = buffer else { return }
            
            // Calculate terminal dimensions based on font size
            let font = textView.font ?? NSFont.monospacedSystemFont(ofSize: CGFloat(preferences.fontSize), weight: .regular)
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
            let visibleRect = textView.visibleRect
            
            // Guard against zero-sized visible rect or invalid large sizes
            guard visibleRect.width > 0 && visibleRect.height > 0 && 
                  visibleRect.width < 10000 && visibleRect.height < 10000 else {
                return
            }
            
            let cols = max(1, Int(visibleRect.width / charWidth))
            let rows = max(1, Int(visibleRect.height / effectiveLineHeight))
            
            // Send resize if dimensions changed
            if cols != buffer.cols || rows != buffer.rows {
                Task {
                    guard let serverURL = sessionManager.serverURL else { return }
                    
                    do {
                        try await APIClient.shared.resizeTerminal(
                            serverURL: serverURL,
                            authHeader: sessionManager.authHeader,
                            sessionId: sessionId,
                            cols: cols,
                            rows: rows
                        )
                    } catch {
                        print("Failed to resize terminal: \(error)")
                    }
                }
            }
        }
        
        deinit {
            // Cleanup is handled when the view disappears
        }
    }
}

// MARK: - View Extensions

extension TerminalBufferView {
    func terminalPreferences(_ preferences: TerminalPreferences) -> TerminalBufferView {
        var modifiedView = self
        modifiedView.preferences = preferences
        return modifiedView
    }
    
    func horizontalFit(_ enabled: Bool) -> TerminalBufferView {
        var modifiedView = self
        modifiedView.preferences.fitHorizontally = enabled
        return modifiedView
    }
    
    func maxColumns(_ columns: Int) -> TerminalBufferView {
        var modifiedView = self
        modifiedView.preferences.maxColumns = columns
        return modifiedView
    }
}

