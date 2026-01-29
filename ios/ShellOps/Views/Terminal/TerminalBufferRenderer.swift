import Foundation

struct TerminalBufferRenderOutput {
    let ansi: String
    let resized: Bool
    let cols: Int
    let rows: Int
}

struct TerminalBufferRenderer {
    private(set) var previousSnapshot: BufferSnapshot?
    private var isFirstUpdate = true
    private var currentCols = 0
    private var currentRows = 0

    mutating func render(from snapshot: BufferSnapshot) -> TerminalBufferRenderOutput {
        let resized = snapshot.cols != self.currentCols || snapshot.rows != self.currentRows
        if resized {
            self.currentCols = snapshot.cols
            self.currentRows = snapshot.rows
            self.isFirstUpdate = true
        }

        let viewportChanged = previousSnapshot?.viewportY != snapshot.viewportY
        var output = ""

        if viewportChanged, let previousSnapshot {
            let delta = snapshot.viewportY - previousSnapshot.viewportY
            output += self.viewportScrollCommands(delta: delta, rows: snapshot.rows)
        }

        let ansiData: String
        if self.isFirstUpdate || previousSnapshot == nil || viewportChanged {
            ansiData = self.convertBufferToOptimizedANSI(snapshot, clearScreen: self.isFirstUpdate)
            self.isFirstUpdate = false
        } else if let previousSnapshot {
            ansiData = self.generateIncrementalUpdate(from: previousSnapshot, to: snapshot)
        } else {
            ansiData = self.convertBufferToOptimizedANSI(snapshot, clearScreen: false)
        }

        output += ansiData
        previousSnapshot = snapshot

        return TerminalBufferRenderOutput(
            ansi: output,
            resized: resized,
            cols: snapshot.cols,
            rows: snapshot.rows)
    }

    func bufferContent() -> String? {
        guard let snapshot = previousSnapshot else { return nil }

        var lines: [String] = []
        lines.reserveCapacity(snapshot.cells.count)

        for row in snapshot.cells {
            if row.isEmpty || (row.count == 1 && row[0].width == 0) {
                lines.append("")
                continue
            }

            var line = ""
            for cell in row where cell.width > 0 {
                let char = cell.char.isEmpty ? " " : cell.char
                line += char
            }
            lines.append(line.trimmingCharacters(in: .whitespaces))
        }

        return lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func viewportScrollCommands(delta: Int, rows: Int) -> String {
        guard abs(delta) < 5, abs(delta) > 0 else { return "" }

        var commands = ""
        commands += "\u{001B}[1;\(rows)r"
        if delta > 0 {
            commands += "\u{001B}[\(delta)S"
        } else {
            commands += "\u{001B}[\(-delta)T"
        }
        commands += "\u{001B}[r"
        return commands
    }

    private func convertBufferToOptimizedANSI(_ snapshot: BufferSnapshot, clearScreen: Bool = false) -> String {
        var output = ""

        if clearScreen {
            output += "\u{001B}[2J\u{001B}[H"
        } else {
            output += "\u{001B}[H"
        }

        var currentFg: Int?
        var currentBg: Int?
        var currentAttrs = 0

        for (rowIndex, row) in snapshot.cells.enumerated() {
            if rowIndex > 0 {
                output += "\r\n"
            }

            if row.isEmpty || (row.count == 1 && row[0].width == 0) {
                continue
            }

            var lastNonSpaceIndex = -1
            for (index, cell) in row.enumerated() {
                if cell.char != " " || cell.bg != nil {
                    lastNonSpaceIndex = index
                }
            }

            var currentCol = 0
            for cell in row {
                if currentCol > lastNonSpaceIndex && lastNonSpaceIndex >= 0 {
                    break
                }

                var needsReset = false
                if let attrs = cell.attributes, attrs != currentAttrs {
                    needsReset = true
                    currentAttrs = attrs
                }

                if cell.fg != currentFg || cell.bg != currentBg || needsReset {
                    if needsReset {
                        output += "\u{001B}[0m"
                        currentFg = nil
                        currentBg = nil

                        if let attrs = cell.attributes {
                            if (attrs & 0x01) != 0 { output += "\u{001B}[1m" }
                            if (attrs & 0x02) != 0 { output += "\u{001B}[3m" }
                            if (attrs & 0x04) != 0 { output += "\u{001B}[4m" }
                            if (attrs & 0x08) != 0 { output += "\u{001B}[2m" }
                            if (attrs & 0x10) != 0 { output += "\u{001B}[7m" }
                            if (attrs & 0x40) != 0 { output += "\u{001B}[9m" }
                        }
                    }

                    if cell.fg != currentFg {
                        currentFg = cell.fg
                        if let fg = cell.fg {
                            if fg & 0xFF00_0000 != 0 {
                                let red = (fg >> 16) & 0xFF
                                let green = (fg >> 8) & 0xFF
                                let blue = fg & 0xFF
                                output += "\u{001B}[38;2;\(red);\(green);\(blue)m"
                            } else if fg <= 255 {
                                output += "\u{001B}[38;5;\(fg)m"
                            }
                        } else {
                            output += "\u{001B}[39m"
                        }
                    }

                    if cell.bg != currentBg {
                        currentBg = cell.bg
                        if let bg = cell.bg {
                            if bg & 0xFF00_0000 != 0 {
                                let red = (bg >> 16) & 0xFF
                                let green = (bg >> 8) & 0xFF
                                let blue = bg & 0xFF
                                output += "\u{001B}[48;2;\(red);\(green);\(blue)m"
                            } else if bg <= 255 {
                                output += "\u{001B}[48;5;\(bg)m"
                            }
                        } else {
                            output += "\u{001B}[49m"
                        }
                    }
                }

                output += cell.char
                currentCol += cell.width
            }
        }

        output += "\u{001B}[0m"
        output += "\u{001B}[\(snapshot.cursorY + 1);\(snapshot.cursorX + 1)H"
        return output
    }

    private func generateIncrementalUpdate(
        from oldSnapshot: BufferSnapshot,
        to newSnapshot: BufferSnapshot)
        -> String
    {
        var output = ""
        var currentFg: Int?
        var currentBg: Int?
        var currentAttrs = 0

        let cursorChanged = oldSnapshot.cursorX != newSnapshot.cursorX || oldSnapshot.cursorY != newSnapshot.cursorY

        for rowIndex in 0..<min(newSnapshot.cells.count, oldSnapshot.cells.count) {
            let oldRow = rowIndex < oldSnapshot.cells.count ? oldSnapshot.cells[rowIndex] : []
            let newRow = rowIndex < newSnapshot.cells.count ? newSnapshot.cells[rowIndex] : []

            if self.rowsAreIdentical(oldRow, newRow) {
                continue
            }

            let oldIsEmpty = oldRow.isEmpty || (oldRow.count == 1 && oldRow[0].width == 0)
            let newIsEmpty = newRow.isEmpty || (newRow.count == 1 && newRow[0].width == 0)

            if oldIsEmpty, newIsEmpty {
                continue
            } else if !oldIsEmpty, newIsEmpty {
                output += "\u{001B}[\(rowIndex + 1);1H\u{001B}[2K"
                continue
            } else if oldIsEmpty, !newIsEmpty {
                output += "\u{001B}[\(rowIndex + 1);1H"
                for cell in newRow {
                    self.updateColorIfNeeded(&output, &currentFg, cell.fg, isBackground: false)
                    self.updateColorIfNeeded(&output, &currentBg, cell.bg, isBackground: true)
                    output += cell.char
                }
                continue
            }

            var segments: [(start: Int, end: Int)] = []
            var currentSegmentStart = -1

            let maxCells = max(oldRow.count, newRow.count)
            for colIndex in 0..<maxCells {
                let oldCell = colIndex < oldRow.count ? oldRow[colIndex] : nil
                let newCell = colIndex < newRow.count ? newRow[colIndex] : nil

                if !self.cellsAreIdentical(oldCell, newCell) {
                    if currentSegmentStart == -1 {
                        currentSegmentStart = colIndex
                    }
                } else if currentSegmentStart >= 0 {
                    segments.append((start: currentSegmentStart, end: colIndex - 1))
                    currentSegmentStart = -1
                }
            }

            if currentSegmentStart >= 0 {
                segments.append((start: currentSegmentStart, end: maxCells - 1))
            }

            for segment in segments {
                var colPosition = 0
                for i in 0..<segment.start where i < newRow.count {
                    colPosition += newRow[i].width
                }
                output += "\u{001B}[\(rowIndex + 1);\(colPosition + 1)H"

                for colIndex in segment.start...segment.end {
                    guard colIndex < newRow.count else {
                        output += "\u{001B}[K"
                        break
                    }
                    let cell = newRow[colIndex]

                    var needsReset = false
                    if let attrs = cell.attributes, attrs != currentAttrs {
                        needsReset = true
                        currentAttrs = attrs
                    }

                    if cell.fg != currentFg || cell.bg != currentBg || needsReset {
                        if needsReset {
                            output += "\u{001B}[0m"
                            currentFg = nil
                            currentBg = nil

                            if let attrs = cell.attributes {
                                if (attrs & 0x01) != 0 { output += "\u{001B}[1m" }
                                if (attrs & 0x02) != 0 { output += "\u{001B}[3m" }
                                if (attrs & 0x04) != 0 { output += "\u{001B}[4m" }
                                if (attrs & 0x08) != 0 { output += "\u{001B}[2m" }
                                if (attrs & 0x10) != 0 { output += "\u{001B}[7m" }
                                if (attrs & 0x40) != 0 { output += "\u{001B}[9m" }
                            }
                        }

                        self.updateColorIfNeeded(&output, &currentFg, cell.fg, isBackground: false)
                        self.updateColorIfNeeded(&output, &currentBg, cell.bg, isBackground: true)
                    }

                    output += cell.char
                }
            }
        }

        if newSnapshot.cells.count > oldSnapshot.cells.count {
            for rowIndex in oldSnapshot.cells.count..<newSnapshot.cells.count {
                output += "\u{001B}[\(rowIndex + 1);1H"
                output += "\u{001B}[2K"

                let row = newSnapshot.cells[rowIndex]
                for cell in row {
                    self.updateColorIfNeeded(&output, &currentFg, cell.fg, isBackground: false)
                    self.updateColorIfNeeded(&output, &currentBg, cell.bg, isBackground: true)
                    output += cell.char
                }
            }
        }

        if cursorChanged {
            output += "\u{001B}[\(newSnapshot.cursorY + 1);\(newSnapshot.cursorX + 1)H"
        }

        return output
    }

    private func rowsAreIdentical(_ row1: [BufferCell], _ row2: [BufferCell]) -> Bool {
        guard row1.count == row2.count else { return false }

        for i in 0..<row1.count where !self.cellsAreIdentical(row1[i], row2[i]) {
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
        isBackground: Bool)
    {
        if new != current {
            current = new
            if let color = new {
                if color & 0xFF00_0000 != 0 {
                    let red = (color >> 16) & 0xFF
                    let green = (color >> 8) & 0xFF
                    let blue = color & 0xFF
                    output += "\u{001B}[\(isBackground ? 48 : 38);2;\(red);\(green);\(blue)m"
                } else if color <= 255 {
                    output += "\u{001B}[\(isBackground ? 48 : 38);5;\(color)m"
                }
            } else {
                output += "\u{001B}[\(isBackground ? 49 : 39)m"
            }
        }
    }
}
