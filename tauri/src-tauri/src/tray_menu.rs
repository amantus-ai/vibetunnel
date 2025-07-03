use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Manager};

use crate::session_monitor::SessionInfo;

pub struct TrayMenuManager;

impl TrayMenuManager {
    pub fn create_menu(app: &AppHandle) -> Result<Menu<tauri::Wry>, tauri::Error> {
        Self::create_menu_with_state(app, false, 4022, 0, None)
    }

    pub fn create_menu_with_state(
        app: &AppHandle,
        server_running: bool,
        port: u16,
        session_count: usize,
        access_mode: Option<String>,
    ) -> Result<Menu<tauri::Wry>, tauri::Error> {
        Self::create_menu_with_sessions(app, server_running, port, session_count, access_mode, None, None)
    }

    pub fn create_menu_with_sessions(
        app: &AppHandle,
        server_running: bool,
        port: u16,
        session_count: usize,
        access_mode: Option<String>,
        sessions: Option<Vec<SessionInfo>>,
        tailscale_status: Option<crate::tailscale::TailscaleStatus>,
    ) -> Result<Menu<tauri::Wry>, tauri::Error> {
        // Server status
        let status_text = if server_running {
            format!("Server running on port {port}")
        } else {
            "Server stopped".to_string()
        };
        let server_status = MenuItemBuilder::new(&status_text)
            .id("server_status")
            .enabled(false)
            .build(app)?;

        // Network info (if in network mode)
        let network_info = if server_running && access_mode.as_deref() == Some("network") {
            if let Some(ip) = crate::network_utils::NetworkUtils::get_local_ip_address() {
                Some(
                    MenuItemBuilder::new(format!("Local IP: {ip}"))
                        .id("network_info")
                        .enabled(false)
                        .build(app)?,
                )
            } else {
                None
            }
        } else {
            None
        };

        // Dashboard access
        let dashboard = MenuItemBuilder::new("Open Dashboard")
            .id("dashboard")
            .build(app)?;

        // Session info header
        let session_text = match session_count {
            0 => "0 active sessions".to_string(),
            1 => "1 active session".to_string(),
            _ => format!("{session_count} active sessions"),
        };
        let sessions_info = MenuItemBuilder::new(&session_text)
            .id("sessions_info")
            .enabled(false)
            .build(app)?;

        // Individual session items (if provided)
        let mut session_items = Vec::new();
        if let Some(sessions_list) = sessions {
            // Show up to 5 most recent active sessions
            let active_sessions: Vec<_> = sessions_list
                .iter()
                .filter(|s| s.is_active)
                .take(5)
                .collect();

            for session in active_sessions {
                // Use session name for display
                let dir_name = &session.name;

                // Truncate long names
                let display_name = if dir_name.len() > 30 {
                    format!("{}...{}", &dir_name[..15], &dir_name[dir_name.len() - 10..])
                } else {
                    dir_name.to_string()
                };

                // Add Git info if available
                let session_text = if let Some(git_repo) = &session.git_repository {
                    let branch = git_repo.current_branch.as_deref().unwrap_or("main");
                    let status = if git_repo.has_changes() {
                        format!(" ({})", git_repo.status_text())
                    } else {
                        String::new()
                    };
                    format!("  • {} [{}{}] (PID: {})", display_name, branch, status, session.pid)
                } else {
                    format!("  • {} (PID: {})", display_name, session.pid)
                };
                
                let session_item = MenuItemBuilder::new(&session_text)
                    .id(format!("session_{}", session.id))
                    .build(app)?;

                session_items.push(session_item);
            }

            // Add ellipsis if there are more active sessions
            if sessions_list.iter().filter(|s| s.is_active).count() > 5 {
                let more_item = MenuItemBuilder::new("  • ...")
                    .id("sessions_more")
                    .enabled(false)
                    .build(app)?;
                session_items.push(more_item);
            }
        }

        // Help submenu
        let show_tutorial = MenuItemBuilder::new("Show Tutorial")
            .id("show_tutorial")
            .build(app)?;

        let website = MenuItemBuilder::new("Website").id("website").build(app)?;

        let report_issue = MenuItemBuilder::new("Report Issue")
            .id("report_issue")
            .build(app)?;

        let check_updates = MenuItemBuilder::new("Check for Updates...")
            .id("check_updates")
            .build(app)?;

        // Version info (disabled menu item) - read from Cargo.toml
        let version = env!("CARGO_PKG_VERSION");
        let version_text = format!("Version {version}");
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
        let quit = MenuItemBuilder::new("Quit").id("quit").build(app)?;

        // Build the complete menu - matching Mac app exactly
        let mut menu_builder = MenuBuilder::new(app).item(&server_status);

        // Add network info if available
        if let Some(network_item) = network_info {
            menu_builder = menu_builder.item(&network_item);
        }
        
        // Add Tailscale info if available
        if let Some(ts_status) = &tailscale_status {
            if ts_status.is_running && ts_status.hostname.is_some() {
                let tailscale_text = format!("Tailscale: {}", ts_status.hostname.as_ref().unwrap());
                let tailscale_item = MenuItemBuilder::new(&tailscale_text)
                    .id("tailscale_info")
                    .enabled(false)
                    .build(app)?;
                menu_builder = menu_builder.item(&tailscale_item);
            }
        }

        // Build menu with sessions
        let mut menu_builder = menu_builder
            .item(&dashboard)
            .separator()
            .item(&sessions_info);

        // Add individual session items
        for session_item in session_items {
            menu_builder = menu_builder.item(&session_item);
        }

        let menu = menu_builder
            .separator()
            .item(&help_menu)
            .item(&settings)
            .separator()
            .item(&quit)
            .build()?;

        Ok(menu)
    }

    pub async fn update_server_status(app: &AppHandle, port: u16, running: bool) {
        if let Some(tray) = app.tray_by_id("main") {
            // Get current session count and list from state
            let state = app.state::<crate::state::AppState>();
            let terminals = state.terminal_manager.list_sessions().await;
            let session_count = terminals.len();

            // Get monitored sessions for detailed info
            let sessions = state.session_monitor.get_sessions().await;

            // Get access mode from settings
            let access_mode = if running {
                if let Ok(settings) = crate::settings::Settings::load() {
                    Some(settings.dashboard.access_mode)
                } else {
                    None
                }
            } else {
                None
            };
            
            // Get Tailscale status
            let tailscale_status = state.tailscale_service.get_status().await;

            // Rebuild menu with new state and sessions
            if let Ok(menu) = Self::create_menu_with_sessions(
                app,
                running,
                port,
                session_count,
                access_mode,
                Some(sessions),
                Some(tailscale_status),
            ) {
                if let Err(e) = tray.set_menu(Some(menu)) {
                    tracing::error!("Failed to update tray menu: {}", e);
                }
            }
        }
    }

    pub async fn update_session_count(app: &AppHandle, count: usize) {
        if let Some(tray) = app.tray_by_id("main") {
            // Get current server status from state
            let state = app.state::<crate::state::AppState>();
            let running = state.backend_manager.is_running().await;
            let settings = crate::settings::Settings::load().unwrap_or_default();
            let port = if running {
                settings.dashboard.server_port
            } else {
                4022
            };

            // Get monitored sessions for detailed info
            let sessions = state.session_monitor.get_sessions().await;

            // Get access mode from settings
            let access_mode = if running {
                if let Ok(settings) = crate::settings::Settings::load() {
                    Some(settings.dashboard.access_mode)
                } else {
                    None
                }
            } else {
                None
            };
            
            // Get Tailscale status
            let tailscale_status = state.tailscale_service.get_status().await;

            // Rebuild menu with new state and sessions
            if let Ok(menu) = Self::create_menu_with_sessions(
                app,
                running,
                port,
                count,
                access_mode,
                Some(sessions),
                Some(tailscale_status),
            ) {
                if let Err(e) = tray.set_menu(Some(menu)) {
                    tracing::error!("Failed to update tray menu: {}", e);
                }
            }
        }
    }

    pub async fn update_access_mode(_app: &AppHandle, mode: &str) {
        // Update checkmarks in access mode menu
        let _modes = [("access_localhost", mode == "localhost"),
            ("access_network", mode == "network"),
            ("access_ngrok", mode == "ngrok")];

        // Note: In Tauri v2, we need to rebuild the menu to update checkmarks
        tracing::debug!("Access mode updated to: {}", mode);

        // TODO: Implement menu rebuilding for dynamic updates
    }
}

#[cfg(test)]
mod tests {
    use crate::session_monitor::SessionInfo;

    #[test]
    fn test_server_status_text() {
        // Test running server
        let status_running = format!("Server running on port {}", 8080);
        assert_eq!(status_running, "Server running on port 8080");

        // Test stopped server
        let status_stopped = "Server stopped".to_string();
        assert_eq!(status_stopped, "Server stopped");
    }

    #[test]
    fn test_session_count_text() {
        // Test 0 sessions
        let text_0 = match 0 {
            0 => "0 active sessions".to_string(),
            1 => "1 active session".to_string(),
            _ => format!("{} active sessions", 0),
        };
        assert_eq!(text_0, "0 active sessions");

        // Test 1 session
        let text_1 = match 1 {
            0 => "0 active sessions".to_string(),
            1 => "1 active session".to_string(),
            _ => format!("{} active sessions", 1),
        };
        assert_eq!(text_1, "1 active session");

        // Test multiple sessions
        let text_5 = match 5 {
            0 => "0 active sessions".to_string(),
            1 => "1 active session".to_string(),
            _ => format!("{} active sessions", 5),
        };
        assert_eq!(text_5, "5 active sessions");
    }

    #[test]
    fn test_session_name_truncation() {
        // Test short name (no truncation needed)
        let short_name = "my-project";
        let display_name = if short_name.len() > 30 {
            format!(
                "{}...{}",
                &short_name[..15],
                &short_name[short_name.len() - 10..]
            )
        } else {
            short_name.to_string()
        };
        assert_eq!(display_name, "my-project");

        // Test long name (needs truncation)
        let long_name = "this-is-a-very-long-project-name-that-needs-truncation";
        let display_name = if long_name.len() > 30 {
            format!(
                "{}...{}",
                &long_name[..15],
                &long_name[long_name.len() - 10..]
            )
        } else {
            long_name.to_string()
        };
        assert_eq!(display_name, "this-is-a-very-...truncation");
    }

    #[test]
    fn test_session_text_formatting() {
        let session_name = "test-project";
        let pid = 1234;
        let session_text = format!("  • {} (PID: {})", session_name, pid);
        assert_eq!(session_text, "  • test-project (PID: 1234)");
    }

    #[test]
    fn test_version_text() {
        let version = env!("CARGO_PKG_VERSION");
        let version_text = format!("Version {}", version);
        assert!(version_text.starts_with("Version "));
        assert!(!version.is_empty());
    }

    #[test]
    fn test_session_filtering() {
        let sessions = vec![
            SessionInfo {
                id: "1".to_string(),
                name: "session1".to_string(),
                pid: 1001,
                rows: 80,
                cols: 24,
                created_at: chrono::Utc::now().to_rfc3339(),
                last_activity: chrono::Utc::now().to_rfc3339(),
                is_active: true,
                client_count: 1,
            },
            SessionInfo {
                id: "2".to_string(),
                name: "session2".to_string(),
                pid: 1002,
                rows: 80,
                cols: 24,
                created_at: chrono::Utc::now().to_rfc3339(),
                last_activity: chrono::Utc::now().to_rfc3339(),
                is_active: false,
                client_count: 0,
            },
            SessionInfo {
                id: "3".to_string(),
                name: "session3".to_string(),
                pid: 1003,
                rows: 80,
                cols: 24,
                created_at: chrono::Utc::now().to_rfc3339(),
                last_activity: chrono::Utc::now().to_rfc3339(),
                is_active: true,
                client_count: 2,
            },
        ];

        // Filter active sessions
        let active_sessions: Vec<_> = sessions.iter().filter(|s| s.is_active).collect();

        assert_eq!(active_sessions.len(), 2);
        assert_eq!(active_sessions[0].id, "1");
        assert_eq!(active_sessions[1].id, "3");
    }

    #[test]
    fn test_session_limit() {
        let sessions: Vec<SessionInfo> = (0..10)
            .map(|i| SessionInfo {
                id: format!("{}", i),
                name: format!("session{}", i),
                pid: 1000 + i as u32,
                rows: 80,
                cols: 24,
                created_at: chrono::Utc::now().to_rfc3339(),
                last_activity: chrono::Utc::now().to_rfc3339(),
                is_active: true,
                client_count: 1,
            })
            .collect();

        // Take only first 5 sessions
        let displayed_sessions: Vec<_> = sessions.iter().filter(|s| s.is_active).take(5).collect();

        assert_eq!(displayed_sessions.len(), 5);

        // Check if we need ellipsis
        let total_active = sessions.iter().filter(|s| s.is_active).count();
        let needs_ellipsis = total_active > 5;
        assert!(needs_ellipsis);
    }

    #[test]
    fn test_menu_item_ids() {
        // Test that menu item IDs are properly formatted
        let session_id = "abc123";
        let menu_id = format!("session_{}", session_id);
        assert_eq!(menu_id, "session_abc123");

        // Test static IDs
        let static_ids = vec![
            "server_status",
            "network_info",
            "dashboard",
            "sessions_info",
            "sessions_more",
            "show_tutorial",
            "website",
            "report_issue",
            "check_updates",
            "version_info",
            "about",
            "settings",
            "quit",
        ];

        for id in static_ids {
            assert!(!id.is_empty());
            assert!(!id.contains(' ')); // IDs shouldn't have spaces
        }
    }

    #[test]
    fn test_access_mode_variations() {
        let modes = vec!["localhost", "network", "ngrok"];

        for mode in &modes {
            match *mode {
                "localhost" => assert_eq!(*mode, "localhost"),
                "network" => assert_eq!(*mode, "network"),
                "ngrok" => assert_eq!(*mode, "ngrok"),
                _ => panic!("Unknown access mode"),
            }
        }
    }

    #[test]
    fn test_network_mode_condition() {
        let server_running = true;
        let access_mode = Some("network".to_string());

        let should_show_network_info = server_running && access_mode.as_deref() == Some("network");
        assert!(should_show_network_info);

        // Test other conditions
        let server_stopped = false;
        let should_show_when_stopped = server_stopped && access_mode.as_deref() == Some("network");
        assert!(!should_show_when_stopped);

        let localhost_mode = Some("localhost".to_string());
        let should_show_localhost = server_running && localhost_mode.as_deref() == Some("network");
        assert!(!should_show_localhost);
    }

    #[test]
    fn test_port_display() {
        let ports = vec![4022, 8080, 3000, 5000];

        for port in ports {
            let status = format!("Server running on port {}", port);
            assert!(status.contains(&port.to_string()));
        }
    }

    #[test]
    fn test_session_info_creation() {
        use chrono::Utc;

        let session = SessionInfo {
            id: "test-123".to_string(),
            name: "Test Session".to_string(),
            pid: 9999,
            rows: 120,
            cols: 40,
            created_at: Utc::now().to_rfc3339(),
            last_activity: Utc::now().to_rfc3339(),
            is_active: true,
            client_count: 1,
        };

        assert_eq!(session.id, "test-123");
        assert_eq!(session.name, "Test Session");
        assert_eq!(session.pid, 9999);
        assert!(session.is_active);
        assert_eq!(session.rows, 120);
        assert_eq!(session.cols, 40);
        assert_eq!(session.client_count, 1);
    }

    #[test]
    fn test_empty_sessions_list() {
        let sessions: Vec<SessionInfo> = vec![];

        let active_sessions: Vec<_> = sessions.iter().filter(|s| s.is_active).take(5).collect();

        assert_eq!(active_sessions.len(), 0);

        // Should not need ellipsis for empty list
        let needs_ellipsis = sessions.iter().filter(|s| s.is_active).count() > 5;
        assert!(!needs_ellipsis);
    }
}
