import AppKit
import Foundation

/// Manages the visual appearance of the status bar item's button.
///
/// This class is responsible for updating the icon and title of the status bar button
/// based on the application's state, such as server status and active sessions.
@MainActor
final class StatusBarIconController {
    private weak var button: NSStatusBarButton?

    /// Initializes the icon controller with the status bar button.
    /// - Parameter button: The `NSStatusBarButton` to manage.
    init(button: NSStatusBarButton?) {
        self.button = button
    }

    /// Updates the entire visual state of the status bar button.
    ///
    /// - Parameters:
    ///   - serverManager: The manager for the VibeTunnel server.
    ///   - sessionMonitor: The monitor for active terminal sessions.
    func update(serverManager: ServerManager, sessionMonitor: SessionMonitor) {
        guard let button else { return }

        // Update icon based on server status
        updateIcon(isServerRunning: serverManager.isRunning)

        // Update session count display
        let sessions = sessionMonitor.sessions.values.filter(\.isRunning)
        let activeSessions = sessions.filter { session in
            if let activityStatus = session.activityStatus?.specificStatus?.status {
                return !activityStatus.isEmpty
            }
            return false
        }

        let activeCount = activeSessions.count
        let totalCount = sessions.count
        let idleCount = totalCount - activeCount

        let indicator = formatSessionIndicator(activeCount: activeCount, idleCount: idleCount)
        button.title = indicator.isEmpty ? "" : " " + indicator
    }

    /// Updates the icon of the status bar button based on the server's running state.
    /// - Parameter isServerRunning: A boolean indicating if the server is running.
    private func updateIcon(isServerRunning: Bool) {
        guard let button else { return }
        let iconName = isServerRunning ? "menubar" : "menubar.inactive"
        if let image = NSImage(named: iconName) {
            image.isTemplate = true
            button.image = image
        } else {
            // Fallback to regular icon with alpha adjustment
            if let image = NSImage(named: "menubar") {
                image.isTemplate = true
                button.image = image
                button.alphaValue = isServerRunning ? 1.0 : 0.5
            }
        }
    }

    /// Formats the session count indicator with a minimalist style.
    /// - Parameters:
    ///   - activeCount: The number of active sessions.
    ///   - idleCount: The number of idle sessions.
    /// - Returns: A formatted string representing the session counts.
    private func formatSessionIndicator(activeCount: Int, idleCount: Int) -> String {
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
