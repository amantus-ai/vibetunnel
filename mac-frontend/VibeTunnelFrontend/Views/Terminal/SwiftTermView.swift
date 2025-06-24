import AppKit
import SwiftTerm
import SwiftUI

struct SwiftTermView: NSViewRepresentable {
    let manager: TerminalManager
    let targetColumnWidth: Int
    let fontSize: Double
    
    func makeNSView(context: Context) -> SwiftTerm.TerminalView {
        let terminal = SwiftTerm.TerminalView()
        
        // Configure terminal appearance
        // SwiftTerm uses different property names
        terminal.layer?.backgroundColor = NSColor(Theme.Colors.terminalBackground).cgColor
        
        // Configure terminal options
        terminal.allowMouseReporting = false
        terminal.optionAsMetaKey = true
        
        // Set font
        terminal.font = NSFont.monospacedSystemFont(ofSize: CGFloat(fontSize), weight: .regular)
        
        // Set delegate
        terminal.terminalDelegate = context.coordinator
        
        // Start with default size
        let cols = targetColumnWidth > 0 ? targetColumnWidth : 80
        let rows = 24
        terminal.resize(cols: cols, rows: rows)
        
        // Store reference
        context.coordinator.terminal = terminal
        
        return terminal
    }
    
    func updateNSView(_ terminal: SwiftTerm.TerminalView, context: Context) {
        // Update font if changed
        terminal.font = NSFont.monospacedSystemFont(ofSize: CGFloat(fontSize), weight: .regular)
        
        // Update column width if changed
        if targetColumnWidth > 0 && terminal.getTerminal().cols != targetColumnWidth {
            terminal.resize(cols: targetColumnWidth, rows: terminal.getTerminal().rows)
        }
    }
    
    func makeCoordinator() -> Coordinator {
        Coordinator(manager: manager)
    }
    
    @MainActor
    class Coordinator: NSObject, SwiftTerm.TerminalViewDelegate {
        let manager: TerminalManager
        var terminal: SwiftTerm.TerminalView?
        private var updateTimer: Timer?
        private var lastOutput = ""
        
        init(manager: TerminalManager) {
            self.manager = manager
            super.init()
            setupTimer()
        }
        
        deinit {
            // Timer will be invalidated when deallocated
        }
        
        private func setupTimer() {
            // Check for output updates regularly
            updateTimer = Timer.scheduledTimer(withTimeInterval: 0.016, repeats: true) { [weak self] _ in
                Task { @MainActor in
                    self?.checkForOutputChanges()
                }
            }
        }
        
        private func checkForOutputChanges() {
            guard let terminal = terminal else { return }
            
            let currentOutput = manager.terminalOutput
            if currentOutput != lastOutput {
                // Calculate the diff
                let newContent: String
                if currentOutput.hasPrefix(lastOutput) {
                    // Common case: new content appended
                    newContent = String(currentOutput.dropFirst(lastOutput.count))
                } else {
                    // Terminal was cleared or content changed significantly
                    // Clear and send all content
                    terminal.getTerminal().softReset()
                    newContent = currentOutput
                }
                
                if !newContent.isEmpty {
                    terminal.feed(text: newContent)
                }
                
                lastOutput = currentOutput
            }
        }
        
        // MARK: - TerminalViewDelegate
        
        nonisolated func send(source: SwiftTerm.TerminalView, data: ArraySlice<UInt8>) {
            if let string = String(bytes: data, encoding: .utf8) {
                Task { @MainActor in
                    manager.sendInput(string)
                }
            }
        }
        
        nonisolated func sizeChanged(source: SwiftTerm.TerminalView, newCols: Int, newRows: Int) {
            Task { @MainActor in
                manager.resize(cols: newCols, rows: newRows)
            }
        }
        
        nonisolated func scrolled(source: SwiftTerm.TerminalView, position: Double) {
            // Handle scroll events if needed
        }
        
        nonisolated func setTerminalTitle(source: SwiftTerm.TerminalView, title: String) {
            // Handle title change if needed
        }
        
        nonisolated func hostCurrentDirectoryUpdate(source: SwiftTerm.TerminalView, directory: String?) {
            // Handle directory update if needed
        }
        
        nonisolated func requestOpenLink(source: SwiftTerm.TerminalView, link: String, params: [String: String]) {
            // Open URL
            if let url = URL(string: link) {
                NSWorkspace.shared.open(url)
            }
        }
        
        nonisolated func clipboardCopy(source: SwiftTerm.TerminalView, content: Data) {
            // Handle clipboard copy
            if let string = String(data: content, encoding: .utf8) {
                let pasteboard = NSPasteboard.general
                pasteboard.clearContents()
                pasteboard.setString(string, forType: .string)
            }
        }
        
        nonisolated func rangeChanged(source: SwiftTerm.TerminalView, startY: Int, endY: Int) {
            // Handle range change if needed
        }
    }
}
