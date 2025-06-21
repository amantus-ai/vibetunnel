use crate::api_testing::APITestingManager;
use crate::auth_cache::AuthCacheManager;
use crate::backend_manager::BackendManager;
use crate::debug_features::DebugFeaturesManager;
use crate::ngrok::NgrokManager;
use crate::notification_manager::NotificationManager;
use crate::permissions::PermissionsManager;
use crate::server::HttpServer;
use crate::session_monitor::SessionMonitor;
use crate::terminal::TerminalManager;
use crate::terminal_integrations::TerminalIntegrationsManager;
use crate::terminal_spawn_service::TerminalSpawnService;
use crate::tty_forward::TTYForwardManager;
#[cfg(unix)]
use crate::unix_socket_server::UnixSocketServer;
use crate::updater::UpdateManager;
use crate::welcome::WelcomeManager;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Clone)]
pub struct AppState {
    pub terminal_manager: Arc<TerminalManager>,
    pub http_server: Arc<RwLock<Option<HttpServer>>>,
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
    #[cfg(unix)]
    pub unix_socket_server: Arc<UnixSocketServer>,
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

        let mut backend_manager = BackendManager::new();
        backend_manager.set_notification_manager(notification_manager.clone());

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
            http_server: Arc::new(RwLock::new(None)),
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
            #[cfg(unix)]
            unix_socket_server,
        }
    }
}
