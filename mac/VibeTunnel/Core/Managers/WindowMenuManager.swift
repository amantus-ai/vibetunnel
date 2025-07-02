import AppKit
import os.log

/// Manages the state of the Window menu item to sync with CustomMenuWindow visibility
@MainActor
final class WindowMenuManager {
    private let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "WindowMenuManager")
    private var menuItem: NSMenuItem?
    
    // MARK: - Singleton
    
    static let shared = WindowMenuManager()
    
    private init() {
        setupWindowMenuItem()
    }
    
    // MARK: - Setup
    
    private func setupWindowMenuItem() {
        // Find the Window menu in the main menu
        guard let mainMenu = NSApp.mainMenu else {
            logger.warning("Main menu not found")
            return
        }
        
        // Look for the Window menu
        let windowMenu = mainMenu.items.first { item in
            // Check both by title and by standard menu identifier
            item.title == "Window" || item.submenu?.title == "Window"
        }
        
        guard let windowMenu = windowMenu,
              let submenu = windowMenu.submenu else {
            logger.warning("Window menu not found")
            return
        }
        
        // Debug: Print all Window menu items
        logger.info("Window menu items:")
        for (index, item) in submenu.items.enumerated() {
            if item.isSeparatorItem {
                logger.info("  \(index): --- SEPARATOR ---")
            } else {
                logger.info("  \(index): '\(item.title)' - action: \(String(describing: item.action))")
            }
        }
        
        // Look for existing "Show VibeTunnel" item or just "VibeTunnel"
        let showVibeTunnelItem = submenu.items.first { item in
            item.title == "Show VibeTunnel" || item.title == "VibeTunnel"
        }
        
        if let existingItem = showVibeTunnelItem {
            // Use existing menu item
            menuItem = existingItem
            logger.info("Found existing 'Show VibeTunnel' menu item")
        } else {
            // Create new menu item
            let newItem = NSMenuItem(
                title: "Show VibeTunnel",
                action: #selector(toggleVibeTunnel),
                keyEquivalent: ""
            )
            newItem.target = self
            
            // Insert at the beginning of the Window menu after any separators
            var insertIndex = 0
            for (index, item) in submenu.items.enumerated() {
                if !item.isSeparatorItem {
                    insertIndex = index
                    break
                }
            }
            
            submenu.insertItem(newItem, at: insertIndex)
            menuItem = newItem
            logger.info("Created new 'Show VibeTunnel' menu item")
        }
    }
    
    // MARK: - Public Methods
    
    /// Ensures the Window menu item exists and is properly configured
    func ensureMenuItemExists() {
        if menuItem == nil {
            setupWindowMenuItem()
        }
    }
    
    // MARK: - Actions
    
    @objc private func toggleVibeTunnel() {
        // Find the status bar controller and toggle the custom window
        if let appDelegate = NSApp.delegate as? AppDelegate,
           let statusBarController = appDelegate.statusBarController {
            statusBarController.toggleCustomWindow()
        } else {
            logger.error("Could not find StatusBarController to toggle window")
        }
    }
}
