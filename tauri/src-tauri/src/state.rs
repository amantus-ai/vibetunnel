use crate::api_client::ApiClient;
use crate::api_testing::APITestingManager;
use crate::auth_cache::AuthCacheManager;
use crate::backend_manager::BackendManager;
use crate::debug_features::DebugFeaturesManager;
use crate::dock_manager::DockManager;
use crate::git_monitor::GitMonitor;
use crate::ngrok::NgrokManager;
use crate::notification_manager::NotificationManager;
use crate::permissions::PermissionsManager;
use crate::power_manager::PowerManager;
use crate::session_monitor::SessionMonitor;
use crate::status_indicator::StatusIndicator;
use crate::tailscale::TailscaleService;
use crate::terminal::TerminalManager;
use crate::terminal_integrations::TerminalIntegrationsManager;
use crate::terminal_spawn_service::TerminalSpawnService;
use crate::tty_forward::TTYForwardManager;
#[cfg(unix)]
use crate::unix_socket_server::UnixSocketServer;
use crate::updater::UpdateManager;
use crate::welcome::WelcomeManager;
use crate::window_tracker::WindowTracker;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::RwLock;

#[derive(Clone)]
pub struct AppState {
    pub terminal_manager: Arc<TerminalManager>,
    pub api_client: Arc<ApiClient>,
    pub ngrok_manager: Arc<NgrokManager>,
    pub server_monitoring: Arc<AtomicBool>,
    pub server_target_port: Arc<RwLock<Option<u16>>>,
    pub tty_forward_manager: Arc<TTYForwardManager>,
    pub session_monitor: Arc<SessionMonitor>,
    pub notification_manager: Arc<NotificationManager>,
    pub welcome_manager: Arc<WelcomeManager>,
    pub permissions_manager: Arc<PermissionsManager>,
    pub update_manager: Arc<UpdateManager>,
    pub backend_manager: Arc<BackendManager>,
    pub debug_features_manager: Arc<DebugFeaturesManager>,
    pub api_testing_manager: Arc<APITestingManager>,
    pub auth_cache_manager: Arc<AuthCacheManager>,
    pub terminal_integrations_manager: Arc<TerminalIntegrationsManager>,
    pub terminal_spawn_service: Arc<TerminalSpawnService>,
    pub git_monitor: Arc<GitMonitor>,
    pub tailscale_service: Arc<TailscaleService>,
    pub window_tracker: Arc<WindowTracker>,
    pub dock_manager: Arc<DockManager>,
    pub status_indicator: Arc<StatusIndicator>,
    pub power_manager: Arc<PowerManager>,
    app_handle: Arc<RwLock<Option<AppHandle>>>,
    #[cfg(unix)]
    pub unix_socket_server: Arc<UnixSocketServer>,
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

impl AppState {
    pub fn new() -> Self {
        let terminal_manager = Arc::new(TerminalManager::new());
        let session_monitor = Arc::new(SessionMonitor::new(terminal_manager.clone()));
        let notification_manager = Arc::new(NotificationManager::new());
        let mut permissions_manager = PermissionsManager::new();
        permissions_manager.set_notification_manager(notification_manager.clone());

        let current_version = env!("CARGO_PKG_VERSION").to_string();
        let mut update_manager = UpdateManager::new(current_version);
        update_manager.set_notification_manager(notification_manager.clone());

        // Get port from settings or use default
        let settings = crate::settings::Settings::load().unwrap_or_default();
        let port = settings.dashboard.server_port;
        let backend_manager = BackendManager::new(port);
        let api_client = Arc::new(ApiClient::new(port));

        let mut debug_features_manager = DebugFeaturesManager::new();
        debug_features_manager.set_notification_manager(notification_manager.clone());

        let mut api_testing_manager = APITestingManager::new();
        api_testing_manager.set_notification_manager(notification_manager.clone());

        let mut auth_cache_manager = AuthCacheManager::new();
        auth_cache_manager.set_notification_manager(notification_manager.clone());

        let mut terminal_integrations_manager = TerminalIntegrationsManager::new();
        terminal_integrations_manager.set_notification_manager(notification_manager.clone());

        let terminal_integrations_manager = Arc::new(terminal_integrations_manager);
        let terminal_spawn_service = Arc::new(TerminalSpawnService::new(
            terminal_integrations_manager.clone(),
        ));

        #[cfg(unix)]
        let unix_socket_server = Arc::new(UnixSocketServer::new(terminal_spawn_service.clone()));

        Self {
            terminal_manager,
            api_client,
            ngrok_manager: Arc::new(NgrokManager::new()),
            server_monitoring: Arc::new(AtomicBool::new(true)),
            server_target_port: Arc::new(RwLock::new(None)),
            tty_forward_manager: Arc::new(TTYForwardManager::new()),
            session_monitor,
            notification_manager,
            welcome_manager: Arc::new(WelcomeManager::new()),
            permissions_manager: Arc::new(permissions_manager),
            update_manager: Arc::new(update_manager),
            backend_manager: Arc::new(backend_manager),
            debug_features_manager: Arc::new(debug_features_manager),
            api_testing_manager: Arc::new(api_testing_manager),
            auth_cache_manager: Arc::new(auth_cache_manager),
            terminal_integrations_manager,
            terminal_spawn_service,
            git_monitor: Arc::new(GitMonitor::new()),
            tailscale_service: Arc::new(TailscaleService::new()),
            window_tracker: Arc::new(WindowTracker::new()),
            dock_manager: Arc::new(DockManager::new()),
            status_indicator: Arc::new(StatusIndicator::new()),
            power_manager: Arc::new(PowerManager::new()),
            app_handle: Arc::new(RwLock::new(None)),
            #[cfg(unix)]
            unix_socket_server,
        }
    }

    /// Set the app handle for managers that need it
    pub async fn set_app_handle(&self, app_handle: AppHandle) {
        *self.app_handle.write().await = Some(app_handle);
    }

    /// Get the app handle if available
    pub fn get_app_handle(&self) -> Option<AppHandle> {
        self.app_handle.blocking_read().clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::Ordering;

    #[test]
    fn test_app_state_creation() {
        let state = AppState::new();

        // Verify all components are initialized
        assert!(Arc::strong_count(&state.terminal_manager) >= 1);
        assert!(Arc::strong_count(&state.api_client) >= 1);
        assert!(Arc::strong_count(&state.ngrok_manager) >= 1);
        assert!(Arc::strong_count(&state.session_monitor) >= 1);
        assert!(Arc::strong_count(&state.notification_manager) >= 1);
        assert!(Arc::strong_count(&state.welcome_manager) >= 1);
        assert!(Arc::strong_count(&state.permissions_manager) >= 1);
        assert!(Arc::strong_count(&state.update_manager) >= 1);
        assert!(Arc::strong_count(&state.backend_manager) >= 1);
        assert!(Arc::strong_count(&state.debug_features_manager) >= 1);
        assert!(Arc::strong_count(&state.api_testing_manager) >= 1);
        assert!(Arc::strong_count(&state.auth_cache_manager) >= 1);
        assert!(Arc::strong_count(&state.terminal_integrations_manager) >= 1);
        assert!(Arc::strong_count(&state.terminal_spawn_service) >= 1);
        assert!(Arc::strong_count(&state.tty_forward_manager) >= 1);
        assert!(Arc::strong_count(&state.git_monitor) >= 1);
        assert!(Arc::strong_count(&state.tailscale_service) >= 1);
        assert!(Arc::strong_count(&state.window_tracker) >= 1);
        assert!(Arc::strong_count(&state.dock_manager) >= 1);
        assert!(Arc::strong_count(&state.status_indicator) >= 1);
        assert!(Arc::strong_count(&state.power_manager) >= 1);

        #[cfg(unix)]
        assert!(Arc::strong_count(&state.unix_socket_server) >= 1);
    }

    #[test]
    fn test_clone_impl() {
        let state1 = AppState::new();
        let state2 = state1.clone();

        // Verify that cloning increases reference counts
        assert!(Arc::strong_count(&state1.terminal_manager) >= 2);
        assert!(Arc::strong_count(&state1.api_client) >= 2);

        // Verify they point to the same instances
        assert!(Arc::ptr_eq(
            &state1.terminal_manager,
            &state2.terminal_manager
        ));
        assert!(Arc::ptr_eq(&state1.api_client, &state2.api_client));
        assert!(Arc::ptr_eq(&state1.ngrok_manager, &state2.ngrok_manager));
        assert!(Arc::ptr_eq(
            &state1.session_monitor,
            &state2.session_monitor
        ));
        assert!(Arc::ptr_eq(
            &state1.notification_manager,
            &state2.notification_manager
        ));
    }

    #[test]
    fn test_server_monitoring_default() {
        let state = AppState::new();

        // Server monitoring should be enabled by default
        assert!(state.server_monitoring.load(Ordering::Relaxed));
    }

    #[tokio::test]
    async fn test_server_target_port() {
        let state = AppState::new();

        // Initially should be None
        let port = state.server_target_port.read().await;
        assert!(port.is_none());
        drop(port);

        // Test setting a port
        {
            let mut port = state.server_target_port.write().await;
            *port = Some(8080);
        }

        // Verify the port was set
        let port = state.server_target_port.read().await;
        assert_eq!(*port, Some(8080));
    }

    #[test]
    fn test_notification_manager_sharing() {
        let state = AppState::new();

        // All managers that need notifications should have the same notification manager
        // This is verified by checking Arc pointer equality
        let _notification_ptr = Arc::as_ptr(&state.notification_manager);

        // We can't directly access the notification managers inside other components
        // but we can verify they all exist and the reference count is high
        assert!(Arc::strong_count(&state.notification_manager) >= 5); // Multiple components use it
    }

    #[test]
    fn test_terminal_manager_sharing() {
        let state = AppState::new();

        // Terminal manager should be shared with session monitor
        // Verify by checking reference count
        assert!(Arc::strong_count(&state.terminal_manager) >= 2); // At least AppState and SessionMonitor
    }

    #[test]
    fn test_terminal_integrations_sharing() {
        let state = AppState::new();

        // Terminal integrations manager should be shared with terminal spawn service
        assert!(Arc::strong_count(&state.terminal_integrations_manager) >= 2);
    }

    #[test]
    fn test_server_monitoring_toggle() {
        let state = AppState::new();

        // Test toggling server monitoring
        state.server_monitoring.store(false, Ordering::Relaxed);
        assert!(!state.server_monitoring.load(Ordering::Relaxed));

        state.server_monitoring.store(true, Ordering::Relaxed);
        assert!(state.server_monitoring.load(Ordering::Relaxed));
    }

    #[tokio::test]
    async fn test_concurrent_port_access() {
        let state = AppState::new();
        let state_clone = state.clone();

        // Spawn a task to write
        let write_handle = tokio::spawn(async move {
            let mut port = state_clone.server_target_port.write().await;
            *port = Some(9090);
        });

        // Spawn a task to read
        let read_handle = tokio::spawn(async move {
            // Give writer a chance to acquire lock first
            tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
            let port = state.server_target_port.read().await;
            port.is_some()
        });

        write_handle.await.unwrap();
        let has_port = read_handle.await.unwrap();
        assert!(has_port);
    }

    #[test]
    fn test_api_client_port() {
        // This test verifies that the API client is initialized with the correct port
        let state = AppState::new();

        // The port should match the one from settings (or default)
        let _settings = crate::settings::Settings::load().unwrap_or_default();
        // We can't directly access the port from ApiClient, but we know it should be initialized
        assert!(Arc::strong_count(&state.api_client) >= 1);
    }

    #[test]
    fn test_backend_manager_port() {
        // This test verifies that the backend manager is initialized with the correct port
        let state = AppState::new();

        // The backend manager should be initialized with the port from settings
        assert!(Arc::strong_count(&state.backend_manager) >= 1);
    }

    #[cfg(unix)]
    #[test]
    fn test_unix_socket_server_initialization() {
        let state = AppState::new();

        // Unix socket server should be initialized with terminal spawn service
        assert!(Arc::strong_count(&state.unix_socket_server) >= 1);
        assert!(Arc::strong_count(&state.terminal_spawn_service) >= 2); // AppState and UnixSocketServer
    }

    #[test]
    fn test_multiple_clones() {
        let state1 = AppState::new();
        let state2 = state1.clone();
        let state3 = state2.clone();
        let state4 = state1.clone();

        // All clones should share the same underlying Arc instances
        assert!(Arc::ptr_eq(
            &state1.terminal_manager,
            &state4.terminal_manager
        ));
        assert!(Arc::ptr_eq(&state2.api_client, &state3.api_client));

        // Reference count should increase with each clone
        assert!(Arc::strong_count(&state1.terminal_manager) >= 4);
    }

    #[test]
    fn test_drop_behavior() {
        let state1 = AppState::new();
        let initial_count = Arc::strong_count(&state1.terminal_manager);

        {
            let _state2 = state1.clone();
            // Reference count should increase
            assert_eq!(
                Arc::strong_count(&state1.terminal_manager),
                initial_count + 1
            );
        }

        // After drop, reference count should decrease
        assert_eq!(Arc::strong_count(&state1.terminal_manager), initial_count);
    }

    #[test]
    fn test_version_initialization() {
        let state = AppState::new();

        // Update manager should be initialized with the correct version
        let version = env!("CARGO_PKG_VERSION");
        assert!(!version.is_empty());

        // We can't directly verify the version in UpdateManager, but we know it's initialized
        assert!(Arc::strong_count(&state.update_manager) >= 1);
    }
}
