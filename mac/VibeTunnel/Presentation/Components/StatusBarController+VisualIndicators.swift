import Foundation

// MARK: - Visual Indicator Styles

extension StatusBarController {
    enum IndicatorStyle {
        case dots // ●●● 5 (current implementation)
        case bars // ▪︎▪︎▫︎▫︎▫︎
        case compact // 2◆5
        case minimalist // 2|5
        case meter // [■■□□□]
    }

    /// Format session counts with the specified visual style
    func formatSessionIndicator(activeCount: Int, totalCount: Int, style: IndicatorStyle = .dots) -> String {
        guard totalCount > 0 else { return "" }

        switch style {
        case .dots:
            return formatDotsIndicator(activeCount: activeCount, totalCount: totalCount)

        case .bars:
            return formatBarsIndicator(activeCount: activeCount, totalCount: totalCount)

        case .compact:
            return formatCompactIndicator(activeCount: activeCount, totalCount: totalCount)

        case .minimalist:
            return formatMinimalistIndicator(activeCount: activeCount, totalCount: totalCount)

        case .meter:
            return formatMeterIndicator(activeCount: activeCount, totalCount: totalCount)
        }
    }

    // MARK: - Indicator Implementations

    private func formatDotsIndicator(activeCount: Int, totalCount: Int) -> String {
        if activeCount == 0 {
            // Only idle sessions, show simple count
            return String(totalCount)
        } else if activeCount > 0 {
            // Show active sessions with dots
            let dots = String(repeating: "●", count: min(activeCount, 3))
            let suffix = activeCount > 3 ? "+" : ""

            if totalCount > activeCount {
                // Show active dots with total count
                return "\(dots)\(suffix) \(totalCount)"
            } else {
                // Only active sessions, just show dots
                return dots + suffix
            }
        }
        return ""
    }

    private func formatBarsIndicator(activeCount: Int, totalCount: Int) -> String {
        let maxBars = 5
        let displayCount = min(totalCount, maxBars)
        let displayActive = min(activeCount, displayCount)

        let activeBars = String(repeating: "▪︎", count: displayActive)
        let idleBars = String(repeating: "▫︎", count: displayCount - displayActive)

        if totalCount > maxBars {
            return "\(activeBars)\(idleBars)+"
        }
        return activeBars + idleBars
    }

    private func formatCompactIndicator(activeCount: Int, totalCount: Int) -> String {
        if activeCount == 0 {
            "◯\(totalCount)"
        } else if activeCount == totalCount {
            "◆\(activeCount)"
        } else {
            "\(activeCount)◆\(totalCount)"
        }
    }

    private func formatMinimalistIndicator(activeCount: Int, totalCount: Int) -> String {
        if activeCount == 0 {
            String(totalCount)
        } else if activeCount == totalCount {
            "● \(activeCount)"
        } else {
            "\(activeCount) | \(totalCount)"
        }
    }

    private func formatMeterIndicator(activeCount: Int, totalCount: Int) -> String {
        let maxSegments = 5
        let segmentCount = min(totalCount, maxSegments)

        if segmentCount == 0 { return "" }

        let activeSegments = Int(round(Double(activeCount) / Double(totalCount) * Double(segmentCount)))
        let filled = String(repeating: "■", count: activeSegments)
        let empty = String(repeating: "□", count: segmentCount - activeSegments)

        return "[\(filled)\(empty)]"
    }
}

// MARK: - Alternative Unicode Characters

// Other visual indicators we could use:
//
// Dots and Circles:
// • ● ○ ◉ ◯ ◦ ⬤ ⚫ ⚪ ◐ ◑ ◒ ◓
//
// Squares and Blocks:
// ▪ ▫ ◼ ◻ ■ □ ▰ ▱ ◾ ◽
//
// Bars and Progress:
// ▁ ▂ ▃ ▄ ▅ ▆ ▇ █ ░ ▒ ▓
//
// Arrows and Triangles:
// ▶ ▷ ▸ ▹ ► ▻
//
// Special Characters:
// ◆ ◇ ♦ ♢ ★ ☆ ✦ ✧
