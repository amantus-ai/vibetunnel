import SwiftUI
import SwiftTerm

struct TerminalHostingView: UIViewRepresentable {
    let session: Session
    @Binding var fontSize: CGFloat
    let onInput: (String) -> Void
    let onResize: (Int, Int) -> Void
    @ObservedObject var viewModel: TerminalViewModel
    
    func makeUIView(context: Context) -> SwiftTerm.TerminalView {
        let terminal = SwiftTerm.TerminalView()
        
        // Configure terminal appearance
        terminal.backgroundColor = UIColor(Theme.Colors.terminalBackground)
        terminal.nativeForegroundColor = UIColor(Theme.Colors.terminalForeground)
        terminal.nativeBackgroundColor = UIColor(Theme.Colors.terminalBackground)
        
        // Set up delegates
        // SwiftTerm's TerminalView uses terminalDelegate, not delegate
        terminal.terminalDelegate = context.coordinator
        
        // Configure terminal options
        terminal.allowMouseReporting = false
        terminal.optionAsMetaKey = true
        
        // Configure font
        updateFont(terminal, size: fontSize)
        
        // Start with default size
        let cols = Int(UIScreen.main.bounds.width / 9) // Approximate char width
        let rows = 24
        terminal.resize(cols: cols, rows: rows)
        
        return terminal
    }
    
    func updateUIView(_ terminal: SwiftTerm.TerminalView, context: Context) {
        updateFont(terminal, size: fontSize)
        
        // Update terminal content from viewModel
        context.coordinator.terminal = terminal
    }
    
    func makeCoordinator() -> Coordinator {
        Coordinator(
            onInput: onInput,
            onResize: onResize,
            viewModel: viewModel
        )
    }
    
    private func updateFont(_ terminal: SwiftTerm.TerminalView, size: CGFloat) {
        let font: UIFont
        if let customFont = UIFont(name: Theme.Typography.terminalFont, size: size) {
            font = customFont
        } else if let fallbackFont = UIFont(name: Theme.Typography.terminalFontFallback, size: size) {
            font = fallbackFont
        } else {
            font = UIFont.monospacedSystemFont(ofSize: size, weight: .regular)
        }
        // SwiftTerm uses the font property directly
        terminal.font = font
    }
    
    @MainActor
    class Coordinator: NSObject {
        let onInput: (String) -> Void
        let onResize: (Int, Int) -> Void
        let viewModel: TerminalViewModel
        weak var terminal: SwiftTerm.TerminalView?
        
        init(onInput: @escaping (String) -> Void,
             onResize: @escaping (Int, Int) -> Void,
             viewModel: TerminalViewModel) {
            self.onInput = onInput
            self.onResize = onResize
            self.viewModel = viewModel
            super.init()
            
            // Set the coordinator reference on the viewModel
            Task { @MainActor in
                viewModel.terminalCoordinator = self
            }
        }
        
        func feedData(_ data: String) {
            Task { @MainActor in
                guard let terminal = terminal else { return }
                // Feed the output to the terminal
                terminal.feed(text: data)
            }
        }
        
        // MARK: - TerminalViewDelegate
        
        func send(source: SwiftTerm.TerminalView, data: ArraySlice<UInt8>) {
            if let string = String(bytes: data, encoding: .utf8) {
                onInput(string)
            }
        }
        
        func sizeChanged(source: SwiftTerm.TerminalView, newCols: Int, newRows: Int) {
            onResize(newCols, newRows)
        }
        
        func scrolled(source: SwiftTerm.TerminalView, position: Double) {
            // Handle scroll if needed
        }
        
        func setTerminalTitle(source: SwiftTerm.TerminalView, title: String) {
            // Handle title change if needed
        }
        
        func hostCurrentDirectoryUpdate(source: SwiftTerm.TerminalView, directory: String?) {
            // Handle directory update if needed
        }
        
        func requestOpenLink(source: SwiftTerm.TerminalView, link: String, params: [String : String]) {
            // Open URL
            if let url = URL(string: link) {
                DispatchQueue.main.async {
                    UIApplication.shared.open(url)
                }
            }
        }
        
        func clipboardCopy(source: SwiftTerm.TerminalView, content: Data) {
            // Handle clipboard copy
            if let string = String(data: content, encoding: .utf8) {
                UIPasteboard.general.string = string
            }
        }
        
        func rangeChanged(source: SwiftTerm.TerminalView, startY: Int, endY: Int) {
            // Handle range change if needed
        }
    }
}

// Add conformance with proper isolation
extension TerminalHostingView.Coordinator: @preconcurrency SwiftTerm.TerminalViewDelegate {}