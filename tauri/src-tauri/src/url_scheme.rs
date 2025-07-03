use serde::{Deserialize, Serialize};
use tauri::{Emitter, Listener, Manager};
use tracing::{debug, error, info};

/// URL scheme handler for vibetunnel:// URLs
pub struct URLSchemeHandler;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum URLSchemeAction {
    OpenSession { session_id: String },
    CreateSession { name: Option<String>, command: Option<String> },
    OpenSettings { tab: Option<String> },
    ShowWelcome,
}

impl URLSchemeHandler {
    /// Parse a vibetunnel:// URL into an action
    pub fn parse_url(url: &str) -> Result<URLSchemeAction, String> {
        debug!("Parsing URL scheme: {}", url);
        
        // Remove the scheme prefix
        let url = url.strip_prefix("vibetunnel://")
            .ok_or_else(|| "Invalid URL scheme: must start with vibetunnel://".to_string())?;
        
        // Parse the path and query
        let parts: Vec<&str> = url.split('?').collect();
        let path = parts.get(0).unwrap_or(&"");
        let query = parts.get(1).unwrap_or(&"");
        
        // Parse query parameters
        let params = Self::parse_query(query);
        
        // Route based on path
        match *path {
            "session" | "sessions" => {
                if let Some(session_id) = params.get("id") {
                    Ok(URLSchemeAction::OpenSession {
                        session_id: session_id.clone(),
                    })
                } else {
                    Err("Missing session ID parameter".to_string())
                }
            }
            "create" | "new" => {
                Ok(URLSchemeAction::CreateSession {
                    name: params.get("name").cloned(),
                    command: params.get("command").cloned(),
                })
            }
            "settings" | "preferences" => {
                Ok(URLSchemeAction::OpenSettings {
                    tab: params.get("tab").cloned(),
                })
            }
            "welcome" => {
                Ok(URLSchemeAction::ShowWelcome)
            }
            "" => {
                // Default action - show welcome or main window
                Ok(URLSchemeAction::ShowWelcome)
            }
            _ => {
                Err(format!("Unknown URL path: {}", path))
            }
        }
    }
    
    /// Parse query string into key-value pairs
    fn parse_query(query: &str) -> std::collections::HashMap<String, String> {
        let mut params = std::collections::HashMap::new();
        
        for pair in query.split('&') {
            if let Some((key, value)) = pair.split_once('=') {
                if let Ok(decoded_value) = urlencoding::decode(value) {
                    params.insert(key.to_string(), decoded_value.to_string());
                }
            }
        }
        
        params
    }
    
    /// Handle a URL scheme action
    pub async fn handle_action(
        action: URLSchemeAction,
        app_handle: &tauri::AppHandle,
    ) -> Result<(), String> {
        info!("Handling URL scheme action: {:?}", action);
        
        match action {
            URLSchemeAction::OpenSession { session_id } => {
                // Open session detail window
                app_handle.emit("open-session", &session_id)
                    .map_err(|e| format!("Failed to emit open-session event: {}", e))?;
                
                // Show main window if needed (synchronous)
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                } else {
                    // Create main window
                    let window = tauri::WebviewWindowBuilder::new(app_handle, "main", tauri::WebviewUrl::App("index.html".into()))
                        .title("VibeTunnel")
                        .inner_size(1200.0, 800.0)
                        .center()
                        .resizable(true)
                        .decorations(true)
                        .build();
                    
                    if let Ok(window) = window {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
            URLSchemeAction::CreateSession { name, command } => {
                // Create new session
                let state = app_handle.state::<crate::state::AppState>();
                let req = crate::api_client::CreateSessionRequest {
                    name,
                    rows: None,
                    cols: None,
                    cwd: None,
                    env: None,
                    shell: command,
                };
                
                if let Ok(session) = state.api_client.create_session(req).await {
                    // Emit event to open the new session
                    app_handle.emit("open-session", &session.id)
                        .map_err(|e| format!("Failed to emit open-session event: {}", e))?;
                }
                
                // Show main window (synchronous)
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                } else {
                    // Create main window
                    let window = tauri::WebviewWindowBuilder::new(app_handle, "main", tauri::WebviewUrl::App("index.html".into()))
                        .title("VibeTunnel")
                        .inner_size(1200.0, 800.0)
                        .center()
                        .resizable(true)
                        .decorations(true)
                        .build();
                    
                    if let Ok(window) = window {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
            URLSchemeAction::OpenSettings { tab } => {
                // Open settings window
                let url = if let Some(tab_name) = tab {
                    format!("settings.html?tab={}", tab_name)
                } else {
                    "settings.html".to_string()
                };

                // Check if settings window already exists
                if let Some(window) = app_handle.get_webview_window("settings") {
                    // Navigate to the URL with the tab parameter if window exists
                    let _ = window.eval(&format!("window.location.href = '{}'", url));
                    let _ = window.show();
                    let _ = window.set_focus();
                } else {
                    // Create new settings window
                    let window = tauri::WebviewWindowBuilder::new(app_handle, "settings", tauri::WebviewUrl::App(url.into()))
                        .title("VibeTunnel Settings")
                        .inner_size(1200.0, 800.0)
                        .resizable(true)
                        .decorations(true)
                        .center()
                        .build();
                    
                    if let Ok(window) = window {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
            URLSchemeAction::ShowWelcome => {
                // Show welcome window through the welcome manager
                let state = app_handle.state::<crate::state::AppState>();
                let welcome_manager = state.welcome_manager.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = welcome_manager.show_welcome_window().await {
                        error!("Failed to show welcome window: {}", e);
                    }
                });
            }
        }
        
        Ok(())
    }
    
    /// Set up URL scheme handling for deep links
    pub fn setup_deep_link_handler(app_handle: tauri::AppHandle) {
        // Clone app_handle for use in the closure
        let app_handle_for_closure = app_handle.clone();
        
        // Set up listener for deep link events
        app_handle.listen("tauri://deep-link", move |event| {
            // In Tauri v2, the payload is already a string
            let payload = event.payload();
            if let Ok(urls) = serde_json::from_str::<Vec<String>>(payload) {
                for url in urls {
                    debug!("Received deep link: {}", url);
                    
                    match Self::parse_url(&url) {
                        Ok(action) => {
                            let app_handle_clone = app_handle_for_closure.clone();
                            tauri::async_runtime::spawn(async move {
                                if let Err(e) = Self::handle_action(action, &app_handle_clone).await {
                                    error!("Failed to handle URL scheme action: {}", e);
                                }
                            });
                        }
                        Err(e) => {
                            error!("Failed to parse URL scheme: {}", e);
                        }
                    }
                }
            }
        });
    }
}

// Commands for testing URL scheme handling
#[tauri::command]
pub async fn handle_url_scheme(url: String, app: tauri::AppHandle) -> Result<(), String> {
    let action = URLSchemeHandler::parse_url(&url)?;
    URLSchemeHandler::handle_action(action, &app).await
}

#[tauri::command]
pub fn parse_url_scheme(url: String) -> Result<URLSchemeAction, String> {
    URLSchemeHandler::parse_url(&url)
}