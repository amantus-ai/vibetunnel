import SwiftTerm
import SwiftUI
import UIKit

/// Native terminal view using SwiftTerm.
///
/// Replaces the WebView-based GhosttyWebView with a native Swift terminal
/// emulator for better performance, native scrolling, and stability.
struct SwiftTerminalView: UIViewRepresentable {
    @Binding var fontSize: CGFloat
    let theme: TerminalTheme
    let onInput: ((String) -> Void)?
    let onResize: ((Int, Int) -> Void)?
    var viewModel: TerminalViewModel?
    var disableInput: Bool = false

    func makeUIView(context: Context) -> SwiftTerm.TerminalView {
        let terminalView = SwiftTerm.TerminalView(frame: .zero)
        terminalView.terminalDelegate = context.coordinator
        terminalView.nativeBackgroundColor = UIColor(theme.background)

        // Apply theme colors
        applyTheme(theme, to: terminalView)

        // Apply font size
        terminalView.font = UIFont.monospacedSystemFont(ofSize: fontSize, weight: .regular)

        // Store reference for data feeding
        context.coordinator.terminalView = terminalView

        // Set coordinator on viewModel
        if let viewModel {
            viewModel.terminalCoordinator = context.coordinator
        }

        return terminalView
    }

    func updateUIView(_ terminalView: SwiftTerm.TerminalView, context: Context) {
        // Update font size if changed
        if terminalView.font.pointSize != fontSize {
            terminalView.font = UIFont.monospacedSystemFont(ofSize: fontSize, weight: .regular)
        }

        // Update theme if changed
        applyTheme(theme, to: terminalView)

        // Update background
        terminalView.nativeBackgroundColor = UIColor(theme.background)

        // Keep cursor transparent
        terminalView.caretColor = .clear
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    // MARK: - Theme Application

    private func applyTheme(_ theme: TerminalTheme, to terminalView: SwiftTerm.TerminalView) {
        // Convert SwiftUI Colors to SwiftTerm Colors
        let colors = [
            // Normal colors (0-7)
            swiftTermColor(from: theme.black),
            swiftTermColor(from: theme.red),
            swiftTermColor(from: theme.green),
            swiftTermColor(from: theme.yellow),
            swiftTermColor(from: theme.blue),
            swiftTermColor(from: theme.magenta),
            swiftTermColor(from: theme.cyan),
            swiftTermColor(from: theme.white),
            // Bright colors (8-15)
            swiftTermColor(from: theme.brightBlack),
            swiftTermColor(from: theme.brightRed),
            swiftTermColor(from: theme.brightGreen),
            swiftTermColor(from: theme.brightYellow),
            swiftTermColor(from: theme.brightBlue),
            swiftTermColor(from: theme.brightMagenta),
            swiftTermColor(from: theme.brightCyan),
            swiftTermColor(from: theme.brightWhite),
        ]
        terminalView.installColors(colors)

        terminalView.nativeForegroundColor = UIColor(theme.foreground)
        terminalView.nativeBackgroundColor = UIColor(theme.background)
        terminalView.selectedTextBackgroundColor = UIColor(theme.selection)

        // Hide the blinking cursor completely by making it transparent
        terminalView.caretColor = .clear
    }

    /// Converts a SwiftUI Color to SwiftTerm Color
    private func swiftTermColor(from color: SwiftUI.Color) -> SwiftTerm.Color {
        // Convert to UIColor first to extract RGB components
        let uiColor = UIColor(color)
        var red: CGFloat = 0
        var green: CGFloat = 0
        var blue: CGFloat = 0
        var alpha: CGFloat = 0
        uiColor.getRed(&red, green: &green, blue: &blue, alpha: &alpha)

        // SwiftTerm.Color uses UInt16 values (0-65535)
        return SwiftTerm.Color(
            red: UInt16(red * 65535),
            green: UInt16(green * 65535),
            blue: UInt16(blue * 65535)
        )
    }

    // MARK: - Coordinator

    class Coordinator: NSObject, SwiftTerm.TerminalViewDelegate, TerminalCoordinating {
        let parent: SwiftTerminalView
        weak var terminalView: SwiftTerm.TerminalView?
        private let logger = Logger(category: "SwiftTerminalView")

        init(_ parent: SwiftTerminalView) {
            self.parent = parent
            super.init()
        }

        // MARK: - TerminalCoordinating

        @MainActor
        func feedData(_ data: String) {
            guard let terminalView else { return }
            terminalView.feed(text: data)
        }

        @MainActor
        func updateBuffer(from snapshot: BufferSnapshot) {
            // Don't use buffer snapshots - they cause cursor issues
            // SwiftTerm handles cursor positioning from raw output
            // This is only used for initial session load, so just ignore
        }

        @MainActor
        func scrollToBottom() {
            terminalView?.scroll(toPosition: 1.0)
        }

        @MainActor
        func setMaxWidth(_ maxWidth: Int) {
            // SwiftTerm handles width automatically
        }

        @MainActor
        func getBufferContent() -> String? {
            guard let terminalView else { return nil }
            let terminal = terminalView.getTerminal()

            var lines: [String] = []
            for row in 0..<terminal.rows {
                if let line = terminal.getLine(row: row) {
                    lines.append(line.translateToString())
                }
            }
            return lines.joined(separator: "\n")
        }

        // MARK: - TerminalViewDelegate (nonisolated to avoid actor boundary crossings)

        nonisolated func sizeChanged(source: SwiftTerm.TerminalView, newCols: Int, newRows: Int) {
            Task { @MainActor in
                self.logger.info("Terminal resized: \(newCols)x\(newRows)")
                self.parent.onResize?(newCols, newRows)
            }
        }

        nonisolated func setTerminalTitle(source: SwiftTerm.TerminalView, title: String) {
            Task { @MainActor in
                self.logger.debug("Terminal title: \(title)")
            }
        }

        nonisolated func hostCurrentDirectoryUpdate(source: SwiftTerm.TerminalView, directory: String?) {
            Task { @MainActor in
                self.logger.debug("Directory changed: \(directory ?? "nil")")
            }
        }

        nonisolated func send(source: SwiftTerm.TerminalView, data: ArraySlice<UInt8>) {
            guard !parent.disableInput else { return }

            if let text = String(bytes: data, encoding: .utf8) {
                self.parent.onInput?(text)
            }
        }

        nonisolated func scrolled(source: SwiftTerm.TerminalView, position: Double) {
            let isAtBottom = position >= 0.99
            Task { @MainActor in
                self.parent.viewModel?.updateScrollState(isAtBottom: isAtBottom)
            }
        }

        nonisolated func requestOpenLink(source: SwiftTerm.TerminalView, link: String, params: [String: String]) {
            if let url = URL(string: link) {
                Task { @MainActor in
                    UIApplication.shared.open(url)
                }
            }
        }

        nonisolated func bell(source: SwiftTerm.TerminalView) {
            Task { @MainActor in
                HapticFeedback.notification(.warning)
            }
        }

        nonisolated func clipboardCopy(source: SwiftTerm.TerminalView, content: Data) {
            if let text = String(data: content, encoding: .utf8) {
                Task { @MainActor in
                    UIPasteboard.general.string = text
                    HapticFeedback.notification(.success)
                }
            }
        }

        nonisolated func iTermContent(source: SwiftTerm.TerminalView, content: ArraySlice<UInt8>) {
            // Not implemented
        }

        nonisolated func rangeChanged(source: SwiftTerm.TerminalView, startY: Int, endY: Int) {
            // Visual changes occurred
        }

    }
}

// MARK: - Preview

#Preview {
    SwiftTerminalView(
        fontSize: .constant(14),
        theme: .dracula,
        onInput: { text in
            print("Input: \(text)")
        },
        onResize: { cols, rows in
            print("Resize: \(cols)x\(rows)")
        })
}
