import Cocoa
import SwiftUI

class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        // Configure app behavior
        NSApp.setActivationPolicy(.regular)
        
        // Set up global keyboard shortcuts if needed
        setupGlobalShortcuts()
    }
    
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        // Keep app running even if all windows are closed
        return false
    }
    
    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool {
        return true
    }
    
    private func setupGlobalShortcuts() {
        // Future: Add global keyboard shortcuts
    }
    
    // Handle URL scheme for deep linking
    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls {
            if url.scheme == "vibetunnel" {
                // Handle deep linking
                NotificationCenter.default.post(
                    name: .handleDeepLink,
                    object: nil,
                    userInfo: ["url": url]
                )
            }
        }
    }
}

extension Notification.Name {
    static let handleDeepLink = Notification.Name("handleDeepLink")
}
