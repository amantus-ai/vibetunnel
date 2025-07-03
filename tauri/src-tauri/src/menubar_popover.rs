use tauri::{AppHandle, LogicalPosition, Manager, WebviewUrl, WebviewWindowBuilder};
use tracing::{debug, error};

/// Manages the menubar popover window
pub struct MenubarPopover;

impl MenubarPopover {
    /// Show the menubar popover window
    pub fn show(app: &AppHandle) -> Result<(), String> {
        debug!("Showing menubar popover");
        
        // Check if popover already exists
        if let Some(window) = app.get_webview_window("menubar-popover") {
            window.show().map_err(|e| e.to_string())?;
            window.set_focus().map_err(|e| e.to_string())?;
            return Ok(());
        }
        
        // Get the current mouse position to position the popover
        // On macOS, we want to position it near the menu bar
        let position = Self::calculate_popover_position();
        
        // Create the popover window
        let window = WebviewWindowBuilder::new(
            app,
            "menubar-popover",
            WebviewUrl::App("menubar.html".into())
        )
        .title("")
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .inner_size(360.0, 700.0)
        .position(position.0, position.1)
        .visible(false) // Start hidden, show after setup
        .build()
        .map_err(|e| {
            error!("Failed to create menubar popover: {}", e);
            e.to_string()
        })?;
        
        // Configure window for popover behavior
        #[cfg(target_os = "macos")]
        {
            // For now, skip the macOS-specific configuration
            // This would require proper cocoa integration which is complex with Tauri v2
            // The window will still work but won't have the exact native popover behavior
        }
        
        // Handle window events
        let app_handle = app.clone();
        window.on_window_event(move |event| {
            match event {
                tauri::WindowEvent::Focused(false) => {
                    // Hide popover when it loses focus
                    if let Some(window) = app_handle.get_webview_window("menubar-popover") {
                        let _ = window.hide();
                    }
                }
                _ => {}
            }
        });
        
        // Show the window after configuration
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        
        Ok(())
    }
    
    /// Hide the menubar popover window
    pub fn hide(app: &AppHandle) -> Result<(), String> {
        if let Some(window) = app.get_webview_window("menubar-popover") {
            window.hide().map_err(|e| e.to_string())?;
        }
        Ok(())
    }
    
    /// Toggle the menubar popover window
    pub fn toggle(app: &AppHandle) -> Result<(), String> {
        if let Some(window) = app.get_webview_window("menubar-popover") {
            if window.is_visible().unwrap_or(false) {
                Self::hide(app)
            } else {
                Self::show(app)
            }
        } else {
            Self::show(app)
        }
    }
    
    /// Calculate the position for the popover based on screen and menu bar
    fn calculate_popover_position() -> (f64, f64) {
        // Default position near the top-right of the screen (where menu bar items typically are)
        // This is a simplified implementation - in a real app, you'd get the actual
        // tray icon position
        #[cfg(target_os = "macos")]
        {
            // Position near the right side of the menu bar
            // Menu bar is typically 24px tall on macOS
            let x = 100.0; // This should be calculated based on actual tray icon position
            let y = 30.0;  // Just below the menu bar
            return (x, y);
        }
        
        #[cfg(not(target_os = "macos"))]
        {
            // For other platforms, position at top-right
            (100.0, 30.0)
        }
    }
    
    /// Update the popover position based on the tray icon location
    pub fn update_position(app: &AppHandle, x: f64, y: f64) -> Result<(), String> {
        if let Some(window) = app.get_webview_window("menubar-popover") {
            // Adjust position to center the popover on the tray icon
            let popover_width = 360.0;
            let adjusted_x = x - (popover_width / 2.0);
            let adjusted_y = y + 10.0; // Small gap below the menu bar
            
            window.set_position(LogicalPosition::new(adjusted_x, adjusted_y))
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

/// Commands for menubar popover
#[tauri::command]
pub fn show_menubar_popover(app: AppHandle) -> Result<(), String> {
    MenubarPopover::show(&app)
}

#[tauri::command]
pub fn hide_menubar_popover(app: AppHandle) -> Result<(), String> {
    MenubarPopover::hide(&app)
}

#[tauri::command]
pub fn toggle_menubar_popover(app: AppHandle) -> Result<(), String> {
    MenubarPopover::toggle(&app)
}