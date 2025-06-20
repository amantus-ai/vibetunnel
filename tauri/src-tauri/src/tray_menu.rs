use tauri::AppHandle;
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder, Menu};

pub struct TrayMenuManager;

impl TrayMenuManager {
    pub fn create_menu(app: &AppHandle) -> Result<Menu<tauri::Wry>, tauri::Error> {
        // Server status
        let server_status = MenuItemBuilder::new("Server running on port 4020")
            .id("server_status")
            .enabled(false)
            .build(app)?;
        
        // Dashboard access
        let dashboard = MenuItemBuilder::new("Open Dashboard")
            .id("dashboard")
            .build(app)?;
        
        // Session info
        let sessions_info = MenuItemBuilder::new("0 active sessions")
            .id("sessions_info")
            .enabled(false)
            .build(app)?;
        
        // Help submenu
        let show_tutorial = MenuItemBuilder::new("Show Tutorial")
            .id("show_tutorial")
            .build(app)?;
        
        let website = MenuItemBuilder::new("Website")
            .id("website")
            .build(app)?;
        
        let report_issue = MenuItemBuilder::new("Report Issue")
            .id("report_issue")
            .build(app)?;
        
        let check_updates = MenuItemBuilder::new("Check for Updates...")
            .id("check_updates")
            .build(app)?;
        
        // Version info (disabled menu item) - read from Cargo.toml
        let version = env!("CARGO_PKG_VERSION");
        let version_text = format!("Version {}", version);
        let version_info = MenuItemBuilder::new(&version_text)
            .id("version_info")
            .enabled(false)
            .build(app)?;
        
        let about = MenuItemBuilder::new("About VibeTunnel")
            .id("about")
            .build(app)?;
        
        let help_menu = SubmenuBuilder::new(app, "Help")
            .item(&show_tutorial)
            .separator()
            .item(&website)
            .item(&report_issue)
            .separator()
            .item(&check_updates)
            .separator()
            .item(&version_info)
            .separator()
            .item(&about)
            .build()?;
        
        // Settings
        let settings = MenuItemBuilder::new("Settings...")
            .id("settings")
            .build(app)?;
        
        // Quit
        let quit = MenuItemBuilder::new("Quit")
            .id("quit")
            .build(app)?;
        
        // Build the complete menu - matching Mac app exactly
        let menu = MenuBuilder::new(app)
            .item(&server_status)
            .item(&dashboard)
            .separator()
            .item(&sessions_info)
            .separator()
            .item(&help_menu)
            .item(&settings)
            .separator()
            .item(&quit)
            .build()?;
        
        Ok(menu)
    }
    
    pub async fn update_server_status(app: &AppHandle, port: u16, running: bool) {
        if let Some(_tray) = app.tray_by_id("main") {
            let status_text = if running {
                format!("Server: Running on port {}", port)
            } else {
                "Server: Stopped".to_string()
            };
            
            // Note: In Tauri v2, dynamic menu updates require rebuilding the menu
            // For now, we'll just log the status
            tracing::debug!("Server status: {}", status_text);
            
            // TODO: Implement menu rebuilding for dynamic updates
            // This would involve recreating the entire menu with updated text
        }
    }
    
    pub async fn update_session_count(app: &AppHandle, count: usize) {
        if let Some(_tray) = app.tray_by_id("main") {
            let text = if count == 0 {
                "0 active sessions".to_string()
            } else if count == 1 {
                "1 active session".to_string()
            } else {
                format!("{} active sessions", count)
            };
            
            tracing::debug!("Session count: {}", text);
            
            // TODO: Implement menu rebuilding for dynamic updates
        }
    }
    
    pub async fn update_access_mode(_app: &AppHandle, mode: &str) {
        // Update checkmarks in access mode menu
        let _modes = vec![
            ("access_localhost", mode == "localhost"),
            ("access_network", mode == "network"),
            ("access_ngrok", mode == "ngrok"),
        ];
        
        // Note: In Tauri v2, we need to rebuild the menu to update checkmarks
        tracing::debug!("Access mode updated to: {}", mode);
        
        // TODO: Implement menu rebuilding for dynamic updates
    }
}