import SwiftUI

/// A lightweight terminal preview component that renders buffer snapshots.
///
/// This view efficiently renders terminal content from BufferSnapshot data,
/// optimized for small preview sizes in session cards.
struct TerminalBufferPreview: View {
    let snapshot: BufferSnapshot
    let fontSize: CGFloat

    init(snapshot: BufferSnapshot, fontSize: CGFloat = 10) {
        self.snapshot = snapshot
        self.fontSize = fontSize
    }

    var body: some View {
        GeometryReader { _ in
            ScrollViewReader { scrollProxy in
                ScrollView([.horizontal, .vertical], showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(0..<snapshot.rows, id: \.self) { row in
                            HStack(spacing: 0) {
                                ForEach(0..<min(snapshot.cols, 80), id: \.self) { col in
                                    // Get cell at position, with bounds checking
                                    if row < snapshot.cells.count && col < snapshot.cells[row].count {
                                        let cell = snapshot.cells[row][col]
                                        cellView(for: cell)
                                    } else {
                                        // Empty cell
                                        Text(" ")
                                            .font(Theme.Typography.terminalSystem(size: fontSize))
                                            .frame(width: fontSize * 0.6)
                                    }
                                }
                                Spacer(minLength: 0)
                            }
                        }
                    }
                    .padding(4)
                    .id("content")
                }
                .onAppear {
                    // Scroll to show cursor area if visible
                    if snapshot.cursorY >= 0 && snapshot.cursorY < snapshot.rows {
                        withAnimation(.none) {
                            scrollProxy.scrollTo("content", anchor: .bottom)
                        }
                    }
                }
            }
        }
        .background(Theme.Colors.terminalBackground)
        .cornerRadius(Theme.CornerRadius.small)
    }

    @ViewBuilder
    private func cellView(for cell: BufferCell) -> some View {
        Text(cell.char.isEmpty ? " " : cell.char)
            .font(Theme.Typography.terminalSystem(size: fontSize))
            .foregroundColor(foregroundColor(for: cell))
            .background(backgroundColor(for: cell))
            .frame(width: fontSize * 0.6 * CGFloat(max(1, cell.width)))
    }

    private func foregroundColor(for cell: BufferCell) -> Color {
        guard let fg = cell.fg else {
            return Theme.Colors.terminalForeground
        }

        // Check if RGB color (has alpha channel flag)
        if (fg & 0xFF00_0000) != 0 {
            // RGB color
            let red = Double((fg >> 16) & 0xFF) / 255.0
            let green = Double((fg >> 8) & 0xFF) / 255.0
            let blue = Double(fg & 0xFF) / 255.0
            return Color(red: red, green: green, blue: blue)
        } else {
            // Palette color
            return paletteColor(fg)
        }
    }

    private func backgroundColor(for cell: BufferCell) -> Color {
        guard let bg = cell.bg else {
            return .clear
        }

        // Check if RGB color (has alpha channel flag)
        if (bg & 0xFF00_0000) != 0 {
            // RGB color
            let red = Double((bg >> 16) & 0xFF) / 255.0
            let green = Double((bg >> 8) & 0xFF) / 255.0
            let blue = Double(bg & 0xFF) / 255.0
            return Color(red: red, green: green, blue: blue)
        } else {
            // Palette color
            return paletteColor(bg)
        }
    }

    private func paletteColor(_ index: Int) -> Color {
        // ANSI 256-color palette
        switch index {
        case 0: return Color(white: 0.0) // Black
        case 1: return Color(red: 0.8, green: 0.0, blue: 0.0) // Red
        case 2: return Color(red: 0.0, green: 0.8, blue: 0.0) // Green
        case 3: return Color(red: 0.8, green: 0.8, blue: 0.0) // Yellow
        case 4: return Color(red: 0.0, green: 0.0, blue: 0.8) // Blue
        case 5: return Color(red: 0.8, green: 0.0, blue: 0.8) // Magenta
        case 6: return Color(red: 0.0, green: 0.8, blue: 0.8) // Cyan
        case 7: return Color(white: 0.8) // White
        case 8: return Color(white: 0.4) // Bright Black
        case 9: return Color(red: 1.0, green: 0.0, blue: 0.0) // Bright Red
        case 10: return Color(red: 0.0, green: 1.0, blue: 0.0) // Bright Green
        case 11: return Color(red: 1.0, green: 1.0, blue: 0.0) // Bright Yellow
        case 12: return Color(red: 0.0, green: 0.0, blue: 1.0) // Bright Blue
        case 13: return Color(red: 1.0, green: 0.0, blue: 1.0) // Bright Magenta
        case 14: return Color(red: 0.0, green: 1.0, blue: 1.0) // Bright Cyan
        case 15: return Color(white: 1.0) // Bright White
        default:
            // For extended colors, use a simplified mapping
            if index < 256 {
                let gray = Double(index - 232) / 23.0
                return Color(white: gray)
            }
            return Theme.Colors.terminalForeground
        }
    }
}

/// A simplified terminal preview that shows only the last visible lines.
/// More efficient for small previews in session cards.
/// Compact terminal preview for session cards.
/// Displays a small, non-interactive view of terminal content.
struct CompactTerminalPreview: View {
    let snapshot: BufferSnapshot
    let maxLines: Int

    init(snapshot: BufferSnapshot, maxLines: Int = 6) {
        self.snapshot = snapshot
        self.maxLines = maxLines
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            // Get the last non-empty lines
            let visibleLines = getVisibleLines()

            ForEach(Array(visibleLines.enumerated()), id: \.offset) { _, line in
                Text(line)
                    .font(Theme.Typography.terminalSystem(size: 10))
                    .foregroundColor(Theme.Colors.terminalForeground.opacity(0.8))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }

            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(8)
    }

    private func getVisibleLines() -> [String] {
        var lines: [String] = []

        // Start from the bottom and work up to find non-empty lines
        for row in (0..<snapshot.rows).reversed() {
            guard row < snapshot.cells.count else { continue }

            let line = snapshot.cells[row]
                .map { $0.char.isEmpty ? " " : $0.char }
                .joined()
                .trimmingCharacters(in: .whitespaces)

            if !line.isEmpty {
                lines.insert(line, at: 0)
                if lines.count >= maxLines {
                    break
                }
            }
        }

        // If we have fewer lines than maxLines, add empty lines at the top
        while lines.count < min(maxLines, snapshot.rows) && lines.count < maxLines {
            lines.insert("", at: 0)
        }

        return lines
    }
}
