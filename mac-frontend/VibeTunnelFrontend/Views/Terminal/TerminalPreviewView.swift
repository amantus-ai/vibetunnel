import SwiftUI
import AppKit

struct TerminalPreviewView: NSViewRepresentable {
    let sessionId: String
    @State private var buffer: TerminalBufferSnapshot?
    @Binding var hasActivity: Bool
    
    func makeNSView(context: Context) -> NSTextView {
        let textView = NSTextView()
        textView.isEditable = false
        textView.isSelectable = false
        textView.isRichText = true
        textView.backgroundColor = NSColor(Theme.Colors.terminalBackground)
        textView.font = NSFont.monospacedSystemFont(ofSize: 3, weight: .regular) // Tiny font for thumbnail
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticTextReplacementEnabled = false
        textView.isAutomaticSpellingCorrectionEnabled = false
        
        context.coordinator.textView = textView
        context.coordinator.subscribe()
        
        return textView
    }
    
    func updateNSView(_ textView: NSTextView, context: Context) {
        if let buffer = context.coordinator.buffer {
            updateTextView(textView, with: buffer)
        }
    }
    
    func makeCoordinator() -> Coordinator {
        Coordinator(sessionId: sessionId, hasActivity: $hasActivity)
    }
    
    static func dismantleNSView(_ nsView: NSTextView, coordinator: Coordinator) {
        coordinator.cleanup()
    }
    
    private func updateTextView(_ textView: NSTextView, with buffer: TerminalBufferSnapshot) {
        let attributedString = NSMutableAttributedString()
        let fontSize: CGFloat = 3 // Tiny font for preview
        let baseFont = NSFont.monospacedSystemFont(ofSize: fontSize, weight: .regular)
        
        // Show bottom portion of buffer that fits
        let visibleRows = min(30, buffer.cells.count) // Limit preview rows
        let startRow = max(0, buffer.cells.count - visibleRows)
        
        for (rowIndex, row) in buffer.cells[startRow...].enumerated() {
            let actualRowIndex = startRow + rowIndex
            
            for (colIndex, cell) in row.enumerated() {
                let isCursor = actualRowIndex == buffer.cursorY && colIndex == buffer.cursorX
                
                // Create attributes
                var attributes: [NSAttributedString.Key: Any] = [
                    .font: baseFont
                ]
                
                // Apply foreground color
                if let fg = cell.fg {
                    if fg <= 255 {
                        // Palette color
                        attributes[.foregroundColor] = getAnsiColor(Int(fg))
                    } else {
                        // RGB color
                        let r = CGFloat((fg >> 16) & 0xFF) / 255.0
                        let g = CGFloat((fg >> 8) & 0xFF) / 255.0
                        let b = CGFloat(fg & 0xFF) / 255.0
                        attributes[.foregroundColor] = NSColor(red: r, green: g, blue: b, alpha: 1.0)
                    }
                } else {
                    attributes[.foregroundColor] = NSColor(Theme.Colors.terminalText)
                }
                
                // Apply background color
                if isCursor {
                    attributes[.backgroundColor] = NSColor(Theme.Colors.accent)
                } else if let bg = cell.bg {
                    if bg <= 255 {
                        // Palette color
                        attributes[.backgroundColor] = getAnsiColor(Int(bg))
                    } else {
                        // RGB color
                        let r = CGFloat((bg >> 16) & 0xFF) / 255.0
                        let g = CGFloat((bg >> 8) & 0xFF) / 255.0
                        let b = CGFloat(bg & 0xFF) / 255.0
                        attributes[.backgroundColor] = NSColor(red: r, green: g, blue: b, alpha: 1.0)
                    }
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
                        if let modifiedFont = NSFontManager.shared.font(withFamily: baseFont.familyName ?? "Menlo",
                                                                         traits: traits,
                                                                         weight: 0,
                                                                         size: fontSize) {
                            attributes[.font] = modifiedFont
                        }
                    }
                    
                    if attrs & ATTR_UNDERLINE != 0 {
                        attributes[.underlineStyle] = NSUnderlineStyle.single.rawValue
                    }
                    
                    if attrs & ATTR_STRIKETHROUGH != 0 {
                        attributes[.strikethroughStyle] = NSUnderlineStyle.single.rawValue
                    }
                }
                
                attributedString.append(NSAttributedString(string: cell.char, attributes: attributes))
            }
            
            if rowIndex < visibleRows - 1 {
                attributedString.append(NSAttributedString(string: "\n"))
            }
        }
        
        textView.textStorage?.setAttributedString(attributedString)
    }
    
    private func getAnsiColor(_ index: Int) -> NSColor {
        // Standard 16 ANSI colors
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
        default:
            // Extended 256 color palette - simplified
            return NSColor(Theme.Colors.terminalText)
        }
    }
    
    @MainActor
    class Coordinator: NSObject {
        let sessionId: String
        weak var textView: NSTextView?
        var buffer: TerminalBufferSnapshot?
        var unsubscribe: (() -> Void)?
        @Binding var hasActivity: Bool
        private var lastSnapshot: String?
        private var activityTimer: Timer?
        
        init(sessionId: String, hasActivity: Binding<Bool>) {
            self.sessionId = sessionId
            self._hasActivity = hasActivity
            super.init()
        }
        
        func subscribe() {
            unsubscribe = BufferSubscriptionService.shared.subscribe(sessionId: sessionId) { [weak self] snapshot in
                Task { @MainActor in
                    self?.handleBufferUpdate(snapshot)
                }
            }
        }
        
        @MainActor
        private func handleBufferUpdate(_ snapshot: TerminalBufferSnapshot) {
            buffer = snapshot
            
            // Check for content changes
            let currentSnapshot = getTextSnapshot(snapshot)
            if lastSnapshot != nil && currentSnapshot != lastSnapshot {
                // Content changed - mark as active
                hasActivity = true
                
                // Clear existing timer
                activityTimer?.invalidate()
                
                // Set timer to clear activity after 500ms
                activityTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: false) { [weak self] _ in
                    Task { @MainActor in
                        self?.hasActivity = false
                    }
                }
            }
            lastSnapshot = currentSnapshot
            
            // Update the view
            if let textView = textView {
                textView.needsDisplay = true
            }
        }
        
        private func getTextSnapshot(_ buffer: TerminalBufferSnapshot) -> String {
            // Create a simple text representation for change detection
            return buffer.cells.map { row in
                row.map { $0.char }.joined()
            }.joined(separator: "\n")
        }
        
        func cleanup() {
            unsubscribe?()
            unsubscribe = nil
            activityTimer?.invalidate()
            activityTimer = nil
        }
        
        deinit {
            // Cleanup is handled when the view disappears
        }
    }
}