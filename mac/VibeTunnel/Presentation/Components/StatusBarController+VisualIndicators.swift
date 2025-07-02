import Foundation

// MARK: - Status Bar Visual Indicators

extension StatusBarController {
    /// Format session counts with minimalist style
    func formatSessionIndicator(activeCount: Int, idleCount: Int) -> String {
        let totalCount = activeCount + idleCount
        guard totalCount > 0 else { return "" }

        if activeCount == 0 {
            return String(totalCount)
        } else if activeCount == totalCount {
            return "● \(activeCount)"
        } else {
            return "\(activeCount) | \(idleCount)"
        }
    }
}
