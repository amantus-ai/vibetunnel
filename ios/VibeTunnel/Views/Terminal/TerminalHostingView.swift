import SwiftUI
import SwiftTerm

struct TerminalHostingView: UIViewRepresentable {
    let session: Session
    @Binding var fontSize: CGFloat
    let onInput: (String) -> Void
    let onResize: (Int, Int) -> Void
    
    func makeUIView(context: Context) -> TerminalView {
        let terminal = TerminalView()
        
        // Configure terminal appearance
        terminal.backgroundColor = UIColor(Theme.Colors.terminalBackground)
        terminal.nativeForegroundColor = UIColor(Theme.Colors.terminalForeground)
        terminal.nativeBackgroundColor = UIColor(Theme.Colors.terminalBackground)
        
        // Set up font
        updateFont(terminal, size: fontSize)
        
        // Configure colors
        configureColors(terminal)
        
        // Set up delegates
        terminal.delegate = context.coordinator
        
        // Configure terminal options
        terminal.allowMouseReporting = false
        terminal.optionAsMetaKey = true
        
        // Start with default size
        let cols = Int(UIScreen.main.bounds.width / 9) // Approximate char width
        let rows = 24
        terminal.resize(cols: cols, rows: rows)
        
        return terminal
    }
    
    func updateUIView(_ terminal: TerminalView, context: Context) {
        updateFont(terminal, size: fontSize)
    }
    
    func makeCoordinator() -> Coordinator {
        Coordinator(onInput: onInput, onResize: onResize)
    }
    
    private func updateFont(_ terminal: TerminalView, size: CGFloat) {
        if let font = UIFont(name: Theme.Typography.terminalFont, size: size) {
            terminal.font = font
        } else if let font = UIFont(name: Theme.Typography.terminalFontFallback, size: size) {
            terminal.font = font
        } else {
            terminal.font = UIFont.monospacedSystemFont(ofSize: size, weight: .regular)
        }
    }
    
    private func configureColors(_ terminal: TerminalView) {
        // ANSI colors
        terminal.setColor(index: 0, color: UIColor(Theme.Colors.ansiBlack))
        terminal.setColor(index: 1, color: UIColor(Theme.Colors.ansiRed))
        terminal.setColor(index: 2, color: UIColor(Theme.Colors.ansiGreen))
        terminal.setColor(index: 3, color: UIColor(Theme.Colors.ansiYellow))
        terminal.setColor(index: 4, color: UIColor(Theme.Colors.ansiBlue))
        terminal.setColor(index: 5, color: UIColor(Theme.Colors.ansiMagenta))
        terminal.setColor(index: 6, color: UIColor(Theme.Colors.ansiCyan))
        terminal.setColor(index: 7, color: UIColor(Theme.Colors.ansiWhite))
        
        // Bright ANSI colors
        terminal.setColor(index: 8, color: UIColor(Theme.Colors.ansiBrightBlack))
        terminal.setColor(index: 9, color: UIColor(Theme.Colors.ansiBrightRed))
        terminal.setColor(index: 10, color: UIColor(Theme.Colors.ansiBrightGreen))
        terminal.setColor(index: 11, color: UIColor(Theme.Colors.ansiBrightYellow))
        terminal.setColor(index: 12, color: UIColor(Theme.Colors.ansiBrightBlue))
        terminal.setColor(index: 13, color: UIColor(Theme.Colors.ansiBrightMagenta))
        terminal.setColor(index: 14, color: UIColor(Theme.Colors.ansiBrightCyan))
        terminal.setColor(index: 15, color: UIColor(Theme.Colors.ansiBrightWhite))
        
        // Cursor
        terminal.caretColor = UIColor(Theme.Colors.primaryAccent)
        terminal.caretTextColor = UIColor(Theme.Colors.terminalBackground)
        
        // Selection
        terminal.selectedTextBackgroundColor = UIColor(Theme.Colors.terminalSelection)
    }
    
    class Coordinator: NSObject, TerminalViewDelegate {
        let onInput: (String) -> Void
        let onResize: (Int, Int) -> Void
        
        init(onInput: @escaping (String) -> Void, onResize: @escaping (Int, Int) -> Void) {
            self.onInput = onInput
            self.onResize = onResize
        }
        
        func send(source: TerminalView, data: ArraySlice<UInt8>) {
            if let string = String(bytes: data, encoding: .utf8) {
                onInput(string)
            }
        }
        
        func sizeChanged(source: TerminalView, newCols: Int, newRows: Int) {
            onResize(newCols, newRows)
        }
        
        func scrolled(source: TerminalView, position: Double) {
            // Handle scroll if needed
        }
        
        func setTerminalTitle(source: TerminalView, title: String) {
            // Handle title change if needed
        }
        
        func hostCurrentDirectoryUpdate(source: TerminalView, directory: String?) {
            // Handle directory update if needed
        }
        
        func requestOpenLink(source: TerminalView, link: String, params: [String : String]) {
            // Open URL
            if let url = URL(string: link) {
                UIApplication.shared.open(url)
            }
        }
    }
    
    // MARK: - Terminal Control Methods
    static func feed(_ terminal: TerminalView?, data: String) {
        guard let terminal = terminal else { return }
        let bytes = [UInt8](data.utf8)
        terminal.feed(byteArray: bytes)
    }
    
    static func clear(_ terminal: TerminalView?) {
        terminal?.terminal.resetToInitialState()
    }
}