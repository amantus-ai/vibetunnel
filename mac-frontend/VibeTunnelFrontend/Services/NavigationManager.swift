import Foundation
import SwiftUI

@Observable
final class NavigationManager {
    var selectedSessionId: String?
    var showingFileBrowser = false
    var showingSettings = false
    
    init() {
        setupDeepLinkHandling()
    }
    
    private func setupDeepLinkHandling() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleDeepLink(_:)),
            name: .handleDeepLink,
            object: nil
        )
    }
    
    @objc private func handleDeepLink(_ notification: Notification) {
        guard let url = notification.userInfo?["url"] as? URL else { return }
        
        // Handle vibetunnel://session/[id] URLs
        if url.scheme == "vibetunnel" {
            if url.host == "session",
               let sessionId = url.pathComponents.dropFirst().first {
                selectedSessionId = sessionId
            }
        }
    }
    
    func navigateToSession(_ sessionId: String) {
        selectedSessionId = sessionId
    }
    
    func navigateToFileBrowser() {
        showingFileBrowser = true
    }
    
    func navigateToSettings() {
        showingSettings = true
    }
}
