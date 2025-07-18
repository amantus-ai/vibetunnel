import SwiftTerm
import SwiftUI

/// UIKit bridge for the SwiftTerm terminal emulator.
///
/// Wraps SwiftTerm's TerminalView in a UIViewRepresentable to integrate
/// with SwiftUI, handling terminal configuration, input/output, and resizing.
struct TerminalHostingView: UIViewRepresentable {
    let session: Session
    @Binding var fontSize: CGFloat
    let theme: TerminalTheme
    let onInput: (String) -> Void
    let onResize: (Int, Int) -> Void
    var viewModel: TerminalViewModel
    @State private var isAutoScrollEnabled = true
    @AppStorage("enableURLDetection")
    private var enableURLDetection = true

    func makeUIView(context: Context) -> SwiftTerm.TerminalView {
        let terminal = SwiftTerm.TerminalView()

        // Configure terminal appearance with theme
        terminal.backgroundColor = UIColor(theme.background)
        terminal.nativeForegroundColor = UIColor(theme.foreground)
        terminal.nativeBackgroundColor = UIColor(theme.background)

        // Set ANSI colors from theme
        let ansiColors: [SwiftTerm.Color] = [
            UIColor(theme.black).toSwiftTermColor(), // 0
            UIColor(theme.red).toSwiftTermColor(), // 1
            UIColor(theme.green).toSwiftTermColor(), // 2
            UIColor(theme.yellow).toSwiftTermColor(), // 3
            UIColor(theme.blue).toSwiftTermColor(), // 4
            UIColor(theme.magenta).toSwiftTermColor(), // 5
            UIColor(theme.cyan).toSwiftTermColor(), // 6
            UIColor(theme.white).toSwiftTermColor(), // 7
            UIColor(theme.brightBlack).toSwiftTermColor(), // 8
            UIColor(theme.brightRed).toSwiftTermColor(), // 9
            UIColor(theme.brightGreen).toSwiftTermColor(), // 10
            UIColor(theme.brightYellow).toSwiftTermColor(), // 11
            UIColor(theme.brightBlue).toSwiftTermColor(), // 12
            UIColor(theme.brightMagenta).toSwiftTermColor(), // 13
            UIColor(theme.brightCyan).toSwiftTermColor(), // 14
            UIColor(theme.brightWhite).toSwiftTermColor() // 15
        ]
        terminal.installColors(ansiColors)

        // Set cursor color
        terminal.caretColor = UIColor(theme.cursor)

        // Set selection color
        terminal.selectedTextBackgroundColor = UIColor(theme.selection)

        // Set up delegates
        // SwiftTerm's TerminalView uses terminalDelegate, not delegate
        terminal.terminalDelegate = context.coordinator

        // Configure terminal options
        terminal.allowMouseReporting = false
        terminal.optionAsMetaKey = true

        // URL detection is handled by SwiftTerm automatically

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

        // URL detection is handled by SwiftTerm automatically

        // Update theme colors
        terminal.backgroundColor = UIColor(theme.background)
        terminal.nativeForegroundColor = UIColor(theme.foreground)
        terminal.nativeBackgroundColor = UIColor(theme.background)
        terminal.caretColor = UIColor(theme.cursor)
        terminal.selectedTextBackgroundColor = UIColor(theme.selection)

        // Update ANSI colors
        let ansiColors: [SwiftTerm.Color] = [
            UIColor(theme.black).toSwiftTermColor(), // 0
            UIColor(theme.red).toSwiftTermColor(), // 1
            UIColor(theme.green).toSwiftTermColor(), // 2
            UIColor(theme.yellow).toSwiftTermColor(), // 3
            UIColor(theme.blue).toSwiftTermColor(), // 4
            UIColor(theme.magenta).toSwiftTermColor(), // 5
            UIColor(theme.cyan).toSwiftTermColor(), // 6
            UIColor(theme.white).toSwiftTermColor(), // 7
            UIColor(theme.brightBlack).toSwiftTermColor(), // 8
            UIColor(theme.brightRed).toSwiftTermColor(), // 9
            UIColor(theme.brightGreen).toSwiftTermColor(), // 10
            UIColor(theme.brightYellow).toSwiftTermColor(), // 11
            UIColor(theme.brightBlue).toSwiftTermColor(), // 12
            UIColor(theme.brightMagenta).toSwiftTermColor(), // 13
            UIColor(theme.brightCyan).toSwiftTermColor(), // 14
            UIColor(theme.brightWhite).toSwiftTermColor() // 15
        ]
        terminal.installColors(ansiColors)

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
        // Use system monospaced font which has better compatibility with SwiftTerm
        // The custom SF Mono font seems to have rendering issues
        let font = UIFont.monospacedSystemFont(ofSize: size, weight: .regular)

        // SwiftTerm uses the font property directly
        terminal.font = font
    }

    // MARK: - Buffer Types

    struct BufferSnapshot {
        let cols: Int
        let rows: Int
        let viewportY: Int
        let cursorX: Int
        let cursorY: Int
        let cells: [[BufferCell]]
    }

    struct BufferCell {
        let char: String
        let width: Int
        let fg: Int?
        let bg: Int?
        let attributes: Int?
    }

    @MainActor
    class Coordinator: NSObject {
        let onInput: (String) -> Void
        let onResize: (Int, Int) -> Void
        let viewModel: TerminalViewModel
        weak var terminal: SwiftTerm.TerminalView?
        private let logger = Logger(category: "Terminal")

        // Track previous buffer state for incremental updates
        private var previousSnapshot: BufferSnapshot?
        private var isFirstUpdate = true

        // Selection support
        private var selectionStart: (x: Int, y: Int)?
        private var selectionEnd: (x: Int, y: Int)?

        init(
            onInput: @escaping (String) -> Void,
            onResize: @escaping (Int, Int) -> Void,
            viewModel: TerminalViewModel
        ) {
            self.onInput = onInput
            self.onResize = onResize
            self.viewModel = viewModel
            super.init()

            // Set the coordinator reference on the viewModel
            Task { @MainActor in
                viewModel.terminalCoordinator = self
            }
        }

        /// Update terminal buffer from binary buffer data using optimized ANSI sequences
        func updateBuffer(from snapshot: BufferSnapshot) {
            guard let terminal else { return }

            logger
                .verbose(
                    "updateBuffer called with snapshot: \(snapshot.cols)x\(snapshot.rows), cursor: (\(snapshot.cursorX),\(snapshot.cursorY))"
                )

            // Update terminal dimensions if needed
            let currentCols = terminal.getTerminal().cols
            let currentRows = terminal.getTerminal().rows

            if currentCols != snapshot.cols || currentRows != snapshot.rows {
                terminal.resize(cols: snapshot.cols, rows: snapshot.rows)
                // Force full redraw on resize
                isFirstUpdate = true
            }

            // Handle viewport scrolling
            let viewportChanged = previousSnapshot?.viewportY != snapshot.viewportY
            if viewportChanged && previousSnapshot != nil {
                // Calculate scroll delta
                let scrollDelta = snapshot.viewportY - (previousSnapshot?.viewportY ?? 0)
                handleViewportScroll(delta: scrollDelta, snapshot: snapshot)
            }

            // Use incremental updates if possible
            let ansiData: String
            if isFirstUpdate || previousSnapshot == nil || viewportChanged {
                // Full redraw needed
                ansiData = convertBufferToOptimizedANSI(snapshot, clearScreen: isFirstUpdate)
                isFirstUpdate = false
                logger.verbose("Full redraw performed")
            } else if let previous = previousSnapshot {
                // Incremental update
                ansiData = generateIncrementalUpdate(from: previous, to: snapshot)
                logger.verbose("Incremental update performed")
            } else {
                // Fallback to full redraw if somehow previousSnapshot is nil
                ansiData = convertBufferToOptimizedANSI(snapshot, clearScreen: false)
                logger.verbose("Fallback full redraw performed")
            }

            // Store current snapshot for next update
            previousSnapshot = snapshot

            // Feed the ANSI data to the terminal
            if !ansiData.isEmpty {
                feedData(ansiData)
            }
        }

        /// Handle viewport scrolling
        private func handleViewportScroll(delta: Int, snapshot: BufferSnapshot) {
            guard terminal != nil else { return }

            // SwiftTerm handles scrolling internally, but we can optimize by
            // using scroll region commands if scrolling by small amounts
            if abs(delta) < 5 && abs(delta) > 0 {
                var scrollCommands = ""

                // Set scroll region to full screen
                scrollCommands += "\u{001B}[1;\(snapshot.rows)r"

                if delta > 0 {
                    // Scrolling down - content moves up
                    scrollCommands += "\u{001B}[\(delta)S"
                } else {
                    // Scrolling up - content moves down
                    scrollCommands += "\u{001B}[\(-delta)T"
                }

                // Reset scroll region
                scrollCommands += "\u{001B}[r"

                feedData(scrollCommands)
            }
        }

        private func convertBufferToOptimizedANSI(_ snapshot: BufferSnapshot, clearScreen: Bool = false) -> String {
            var output = ""

            if clearScreen {
                // Clear screen and reset cursor for first update
                output += "\u{001B}[2J\u{001B}[H"
            } else {
                // Just reset cursor to home position
                output += "\u{001B}[H"
            }

            // Track current attributes to minimize escape sequences
            var currentFg: Int?
            var currentBg: Int?
            var currentAttrs: Int = 0

            // Render each row
            for (rowIndex, row) in snapshot.cells.enumerated() {
                if rowIndex > 0 {
                    output += "\r\n"
                }

                // Check if this is an empty row (marked by empty array or single empty cell)
                if row.isEmpty || (row.count == 1 && row[0].width == 0) {
                    // Skip rendering empty rows - terminal will show blank line
                    continue
                }

                var lastNonSpaceIndex = -1
                for (index, cell) in row.enumerated() {
                    if cell.char != " " || cell.bg != nil {
                        lastNonSpaceIndex = index
                    }
                }

                // Only render up to the last non-space character
                var currentCol = 0
                for cell in row {
                    if currentCol > lastNonSpaceIndex && lastNonSpaceIndex >= 0 {
                        break
                    }

                    // Handle attributes efficiently
                    var needsReset = false
                    if let attrs = cell.attributes, attrs != currentAttrs {
                        needsReset = true
                        currentAttrs = attrs
                    }

                    // Handle colors efficiently
                    if cell.fg != currentFg || cell.bg != currentBg || needsReset {
                        if needsReset {
                            output += "\u{001B}[0m"
                            currentFg = nil
                            currentBg = nil

                            // Apply attributes
                            if let attrs = cell.attributes {
                                if (attrs & 0x01) != 0 { output += "\u{001B}[1m" } // Bold
                                if (attrs & 0x02) != 0 { output += "\u{001B}[3m" } // Italic
                                if (attrs & 0x04) != 0 { output += "\u{001B}[4m" } // Underline
                                if (attrs & 0x08) != 0 { output += "\u{001B}[2m" } // Dim
                                if (attrs & 0x10) != 0 { output += "\u{001B}[7m" } // Inverse
                                if (attrs & 0x40) != 0 { output += "\u{001B}[9m" } // Strikethrough
                            }
                        }

                        // Apply foreground color
                        if cell.fg != currentFg {
                            currentFg = cell.fg
                            if let fg = cell.fg {
                                if fg & 0xFF00_0000 != 0 {
                                    // RGB color
                                    let red = (fg >> 16) & 0xFF
                                    let green = (fg >> 8) & 0xFF
                                    let blue = fg & 0xFF
                                    output += "\u{001B}[38;2;\(red);\(green);\(blue)m"
                                } else if fg <= 255 {
                                    // Palette color
                                    output += "\u{001B}[38;5;\(fg)m"
                                }
                            } else {
                                output += "\u{001B}[39m"
                            }
                        }

                        // Apply background color
                        if cell.bg != currentBg {
                            currentBg = cell.bg
                            if let bg = cell.bg {
                                if bg & 0xFF00_0000 != 0 {
                                    // RGB color
                                    let red = (bg >> 16) & 0xFF
                                    let green = (bg >> 8) & 0xFF
                                    let blue = bg & 0xFF
                                    output += "\u{001B}[48;2;\(red);\(green);\(blue)m"
                                } else if bg <= 255 {
                                    // Palette color
                                    output += "\u{001B}[48;5;\(bg)m"
                                }
                            } else {
                                output += "\u{001B}[49m"
                            }
                        }
                    }

                    // Add the character
                    output += cell.char
                    currentCol += cell.width
                }
            }

            // Reset attributes
            output += "\u{001B}[0m"

            // Position cursor
            output += "\u{001B}[\(snapshot.cursorY + 1);\(snapshot.cursorX + 1)H"

            return output
        }

        /// Generate incremental ANSI updates by comparing previous and current snapshots
        private func generateIncrementalUpdate(
            from oldSnapshot: BufferSnapshot,
            to newSnapshot: BufferSnapshot
        )
            -> String
        {
            var output = ""
            var currentFg: Int?
            var currentBg: Int?
            var currentAttrs: Int = 0

            // Update cursor if changed
            let cursorChanged = oldSnapshot.cursorX != newSnapshot.cursorX || oldSnapshot.cursorY != newSnapshot.cursorY

            // Check each row for changes
            for rowIndex in 0..<min(newSnapshot.cells.count, oldSnapshot.cells.count) {
                let oldRow = rowIndex < oldSnapshot.cells.count ? oldSnapshot.cells[rowIndex] : []
                let newRow = rowIndex < newSnapshot.cells.count ? newSnapshot.cells[rowIndex] : []

                // Quick check if rows are identical
                if rowsAreIdentical(oldRow, newRow) {
                    continue
                }

                // Handle empty rows efficiently
                let oldIsEmpty = oldRow.isEmpty || (oldRow.count == 1 && oldRow[0].width == 0)
                let newIsEmpty = newRow.isEmpty || (newRow.count == 1 && newRow[0].width == 0)

                if oldIsEmpty && newIsEmpty {
                    continue // Both empty, no change
                } else if !oldIsEmpty && newIsEmpty {
                    // Row became empty - clear it
                    output += "\u{001B}[\(rowIndex + 1);1H\u{001B}[2K"
                    continue
                } else if oldIsEmpty && !newIsEmpty {
                    // Empty row now has content - render full row
                    output += "\u{001B}[\(rowIndex + 1);1H"
                    for cell in newRow {
                        updateColorIfNeeded(&output, &currentFg, cell.fg, isBackground: false)
                        updateColorIfNeeded(&output, &currentBg, cell.bg, isBackground: true)
                        output += cell.char
                    }
                    continue
                }

                // Find changed segments in this row
                var segments: [(start: Int, end: Int)] = []
                var currentSegmentStart = -1

                let maxCells = max(oldRow.count, newRow.count)
                for colIndex in 0..<maxCells {
                    let oldCell = colIndex < oldRow.count ? oldRow[colIndex] : nil
                    let newCell = colIndex < newRow.count ? newRow[colIndex] : nil

                    if !cellsAreIdentical(oldCell, newCell) {
                        if currentSegmentStart == -1 {
                            currentSegmentStart = colIndex
                        }
                    } else if currentSegmentStart >= 0 {
                        // End of changed segment
                        segments.append((start: currentSegmentStart, end: colIndex - 1))
                        currentSegmentStart = -1
                    }
                }

                // Handle last segment if it extends to end
                if currentSegmentStart >= 0 {
                    segments.append((start: currentSegmentStart, end: maxCells - 1))
                }

                // Render each changed segment
                for segment in segments {
                    // Move cursor to start of segment
                    var colPosition = 0
                    for i in 0..<segment.start where i < newRow.count {
                        colPosition += newRow[i].width
                    }
                    output += "\u{001B}[\(rowIndex + 1);\(colPosition + 1)H"

                    // Render cells in segment
                    for colIndex in segment.start...segment.end {
                        guard colIndex < newRow.count else {
                            // Clear remaining cells if old row was longer
                            output += "\u{001B}[K"
                            break
                        }
                        let cell = newRow[colIndex]

                        // Handle attributes
                        var needsReset = false
                        if let attrs = cell.attributes, attrs != currentAttrs {
                            needsReset = true
                            currentAttrs = attrs
                        }

                        // Apply styles if changed
                        if cell.fg != currentFg || cell.bg != currentBg || needsReset {
                            if needsReset {
                                output += "\u{001B}[0m"
                                currentFg = nil
                                currentBg = nil

                                // Apply attributes
                                if let attrs = cell.attributes {
                                    if (attrs & 0x01) != 0 { output += "\u{001B}[1m" }
                                    if (attrs & 0x02) != 0 { output += "\u{001B}[3m" }
                                    if (attrs & 0x04) != 0 { output += "\u{001B}[4m" }
                                    if (attrs & 0x08) != 0 { output += "\u{001B}[2m" }
                                    if (attrs & 0x10) != 0 { output += "\u{001B}[7m" }
                                    if (attrs & 0x40) != 0 { output += "\u{001B}[9m" }
                                }
                            }

                            // Apply colors
                            updateColorIfNeeded(&output, &currentFg, cell.fg, isBackground: false)
                            updateColorIfNeeded(&output, &currentBg, cell.bg, isBackground: true)
                        }

                        output += cell.char
                    }
                }
            }

            // Handle newly added rows
            if newSnapshot.cells.count > oldSnapshot.cells.count {
                for rowIndex in oldSnapshot.cells.count..<newSnapshot.cells.count {
                    output += "\u{001B}[\(rowIndex + 1);1H"
                    output += "\u{001B}[2K" // Clear line

                    let row = newSnapshot.cells[rowIndex]
                    for cell in row {
                        // Apply styles
                        updateColorIfNeeded(&output, &currentFg, cell.fg, isBackground: false)
                        updateColorIfNeeded(&output, &currentBg, cell.bg, isBackground: true)
                        output += cell.char
                    }
                }
            }

            // Update cursor position if changed
            if cursorChanged {
                output += "\u{001B}[\(newSnapshot.cursorY + 1);\(newSnapshot.cursorX + 1)H"
            }

            return output
        }

        private func rowsAreIdentical(_ row1: [BufferCell], _ row2: [BufferCell]) -> Bool {
            guard row1.count == row2.count else { return false }

            for i in 0..<row1.count where !cellsAreIdentical(row1[i], row2[i]) {
                return false
            }
            return true
        }

        private func cellsAreIdentical(_ cell1: BufferCell?, _ cell2: BufferCell?) -> Bool {
            guard let cell1, let cell2 else {
                return cell1 == nil && cell2 == nil
            }

            return cell1.char == cell2.char &&
                cell1.fg == cell2.fg &&
                cell1.bg == cell2.bg &&
                cell1.attributes == cell2.attributes
        }

        private func updateColorIfNeeded(
            _ output: inout String,
            _ current: inout Int?,
            _ new: Int?,
            isBackground: Bool
        ) {
            if new != current {
                current = new
                if let color = new {
                    if color & 0xFF00_0000 != 0 {
                        // RGB color
                        let red = (color >> 16) & 0xFF
                        let green = (color >> 8) & 0xFF
                        let blue = color & 0xFF
                        output += "\u{001B}[\(isBackground ? 48 : 38);2;\(red);\(green);\(blue)m"
                    } else if color <= 255 {
                        // Palette color
                        output += "\u{001B}[\(isBackground ? 48 : 38);5;\(color)m"
                    }
                } else {
                    // Default color
                    output += "\u{001B}[\(isBackground ? 49 : 39)m"
                }
            }
        }

        func feedData(_ data: String) {
            Task { @MainActor in
                guard let terminal else {
                    logger.warning("No terminal instance available")
                    return
                }

                // Debug: Log first 100 chars of data
                let preview = String(data.prefix(100))
                logger.verbose("Feeding \(data.count) bytes: \(preview)")

                // Store current scroll position before feeding data
                let wasAtBottom = viewModel.isAutoScrollEnabled

                // Feed the output to the terminal
                terminal.feed(text: data)

                // Auto-scroll to bottom if enabled
                if wasAtBottom {
                    // SwiftTerm automatically scrolls when feeding data at bottom
                    // No explicit API needed for auto-scrolling
                }
            }
        }

        func getBufferContent() -> String? {
            guard let terminal else { return nil }

            // Get the terminal buffer content
            let terminalInstance = terminal.getTerminal()
            var content = ""

            // Read all lines from the terminal buffer
            for row in 0..<terminalInstance.rows {
                if let line = terminalInstance.getLine(row: row) {
                    var lineText = ""
                    for col in 0..<terminalInstance.cols where col < line.count {
                        let char = line[col]
                        lineText += String(char.getCharacter())
                    }
                    // Trim trailing spaces
                    content += lineText.trimmingCharacters(in: .whitespaces) + "\n"
                }
            }

            return content.trimmingCharacters(in: .whitespacesAndNewlines)
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
            // Check if user is at bottom
            Task { @MainActor in
                // Estimate if at bottom based on position
                let isAtBottom = position >= 0.95
                viewModel.updateScrollState(isAtBottom: isAtBottom)

                // The view model will handle button visibility through its state
            }
        }

        func scrollToBottom() {
            // Scroll to bottom by sending page down keys
            if let terminal {
                terminal.feed(text: "\u{001b}[B")
            }
        }

        func setMaxWidth(_ maxWidth: Int) {
            // Store the max width preference for terminal rendering
            // When maxWidth is 0, it means unlimited
            // This could be used to constrain terminal rendering in the future
            // For now, just log the preference
            logger.info("Max width set to: \(maxWidth == 0 ? "unlimited" : "\(maxWidth) columns")")
        }

        func setTerminalTitle(source: SwiftTerm.TerminalView, title: String) {
            // Handle title change if needed
        }

        func hostCurrentDirectoryUpdate(source: SwiftTerm.TerminalView, directory: String?) {
            // Handle directory update if needed
        }

        func requestOpenLink(source: SwiftTerm.TerminalView, link: String, params: [String: String]) {
            // Open URL with haptic feedback
            if let url = URL(string: link) {
                DispatchQueue.main.async {
                    HapticFeedback.impact(.light)
                    UIApplication.shared.open(url, options: [:], completionHandler: nil)
                }
            }
        }

        func clipboardCopy(source: SwiftTerm.TerminalView, content: Data) {
            // Handle clipboard copy with improved selection support
            if let string = String(data: content, encoding: .utf8) {
                UIPasteboard.general.string = string

                // Provide haptic feedback
                HapticFeedback.notification(.success)

                // If we have buffer data, we can provide additional context
                if previousSnapshot != nil {
                    // Log selection range for debugging
                    logger.debug("Copied \(string.count) characters")
                }
            }
        }

        /// Get selected text from buffer with proper Unicode handling
        func getSelectedText() -> String? {
            guard let start = selectionStart,
                  let end = selectionEnd,
                  let snapshot = previousSnapshot
            else {
                return nil
            }

            var selectedText = ""

            // Normalize selection coordinates
            let startY = min(start.y, end.y)
            let endY = max(start.y, end.y)
            let startX = start.y < end.y ? start.x : min(start.x, end.x)
            let endX = start.y < end.y ? max(start.x, end.x) : end.x

            // Extract text from buffer
            for y in startY...endY {
                guard y < snapshot.cells.count else { continue }
                let row = snapshot.cells[y]

                var rowText = ""
                var currentX = 0

                for cell in row {
                    let cellStartX = currentX
                    let cellEndX = currentX + cell.width

                    // Check if cell is within selection
                    if y == startY && y == endY {
                        // Single line selection
                        if cellEndX > startX && cellStartX < endX {
                            rowText += cell.char
                        }
                    } else if y == startY {
                        // First line of multi-line selection
                        if cellStartX >= startX {
                            rowText += cell.char
                        }
                    } else if y == endY {
                        // Last line of multi-line selection
                        if cellEndX <= endX {
                            rowText += cell.char
                        }
                    } else {
                        // Middle lines - include everything
                        rowText += cell.char
                    }

                    currentX = cellEndX
                }

                // Add line to result
                if !rowText.isEmpty {
                    if !selectedText.isEmpty {
                        selectedText += "\n"
                    }
                    selectedText += rowText.trimmingCharacters(in: .whitespaces)
                }
            }

            return selectedText.isEmpty ? nil : selectedText
        }

        func rangeChanged(source: SwiftTerm.TerminalView, startY: Int, endY: Int) {
            // Handle range change if needed
        }
    }
}

/// Add conformance with proper isolation
extension TerminalHostingView.Coordinator: @preconcurrency SwiftTerm.TerminalViewDelegate {}

// MARK: - UIColor Extension for SwiftTerm

extension UIColor {
    /// Convert UIColor to SwiftTerm.Color (which uses 16-bit color components)
    func toSwiftTermColor() -> SwiftTerm.Color {
        var red: CGFloat = 0
        var green: CGFloat = 0
        var blue: CGFloat = 0
        var alpha: CGFloat = 0

        getRed(&red, green: &green, blue: &blue, alpha: &alpha)

        // Convert from 0.0-1.0 range to 0-65535 range
        let red16 = UInt16(red * 65_535.0)
        let green16 = UInt16(green * 65_535.0)
        let blue16 = UInt16(blue * 65_535.0)

        return SwiftTerm.Color(red: red16, green: green16, blue: blue16)
    }
}
