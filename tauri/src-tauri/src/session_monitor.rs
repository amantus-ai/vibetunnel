use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};
use tokio::time::{interval, Duration};
use uuid::Uuid;

/// Information about a terminal session
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: String,
    pub name: String,
    pub pid: u32,
    pub rows: u16,
    pub cols: u16,
    pub created_at: String,
    pub last_activity: String,
    pub is_active: bool,
    pub client_count: usize,
    pub working_directory: Option<String>,
    pub git_repository: Option<crate::git_repository::GitRepository>,
}

/// Session state change event
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SessionEvent {
    SessionCreated { session: SessionInfo },
    SessionUpdated { session: SessionInfo },
    SessionClosed { id: String },
    SessionActivity { id: String, timestamp: String },
}

/// Session monitoring service
pub struct SessionMonitor {
    sessions: Arc<RwLock<HashMap<String, SessionInfo>>>,
    event_subscribers: Arc<RwLock<HashMap<String, mpsc::UnboundedSender<SessionEvent>>>>,
    terminal_manager: Arc<crate::terminal::TerminalManager>,
}

impl SessionMonitor {
    pub fn new(terminal_manager: Arc<crate::terminal::TerminalManager>) -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            event_subscribers: Arc::new(RwLock::new(HashMap::new())),
            terminal_manager,
        }
    }

    /// Start monitoring sessions
    pub async fn start_monitoring(&self) {
        let sessions = self.sessions.clone();
        let subscribers = self.event_subscribers.clone();
        let terminal_manager = self.terminal_manager.clone();

        tokio::spawn(async move {
            let mut monitor_interval = interval(Duration::from_secs(5));

            loop {
                monitor_interval.tick().await;

                // Get current sessions from terminal manager
                let current_sessions = terminal_manager.list_sessions().await;
                let mut sessions_map = sessions.write().await;
                let mut updated_sessions = HashMap::new();

                // Check for new or updated sessions
                for session in current_sessions {
                    let session_info = SessionInfo {
                        id: session.id.clone(),
                        name: session.name.clone(),
                        pid: session.pid,
                        rows: session.rows,
                        cols: session.cols,
                        created_at: session.created_at.clone(),
                        last_activity: Utc::now().to_rfc3339(),
                        is_active: true,
                        client_count: 0, // TODO: Track actual client count
                        working_directory: None, // TODO: Get from session API when available
                        git_repository: None, // Will be populated by Git monitor separately
                    };

                    // Check if this is a new session
                    if sessions_map.contains_key(&session.id) {
                        // Check if session was updated
                        if let Some(existing) = sessions_map.get(&session.id) {
                            if existing.rows != session_info.rows
                                || existing.cols != session_info.cols
                            {
                                // Broadcast session updated event
                                Self::broadcast_event(
                                    &subscribers,
                                    SessionEvent::SessionUpdated {
                                        session: session_info.clone(),
                                    },
                                )
                                .await;
                            }
                        }
                    } else {
                        // Broadcast session created event
                        Self::broadcast_event(
                            &subscribers,
                            SessionEvent::SessionCreated {
                                session: session_info.clone(),
                            },
                        )
                        .await;
                    }

                    updated_sessions.insert(session.id.clone(), session_info);
                }

                // Check for closed sessions
                let closed_sessions: Vec<String> = sessions_map
                    .keys()
                    .filter(|id| !updated_sessions.contains_key(*id))
                    .cloned()
                    .collect();

                for session_id in closed_sessions {
                    // Broadcast session closed event
                    Self::broadcast_event(
                        &subscribers,
                        SessionEvent::SessionClosed {
                            id: session_id.clone(),
                        },
                    )
                    .await;
                }

                // Update the sessions map
                *sessions_map = updated_sessions;
            }
        });
    }

    /// Subscribe to session events
    #[allow(dead_code)]
    pub async fn subscribe(&self) -> mpsc::UnboundedReceiver<SessionEvent> {
        let (tx, rx) = mpsc::unbounded_channel();
        let subscriber_id = Uuid::new_v4().to_string();

        self.event_subscribers
            .write()
            .await
            .insert(subscriber_id, tx);

        rx
    }

    /// Unsubscribe from session events
    #[allow(dead_code)]
    pub async fn unsubscribe(&self, subscriber_id: &str) {
        self.event_subscribers.write().await.remove(subscriber_id);
    }

    /// Get current session count
    #[allow(dead_code)]
    pub async fn get_session_count(&self) -> usize {
        self.sessions.read().await.len()
    }

    /// Get all sessions
    pub async fn get_sessions(&self) -> Vec<SessionInfo> {
        self.sessions.read().await.values().cloned().collect()
    }

    /// Get a specific session
    #[allow(dead_code)]
    pub async fn get_session(&self, id: &str) -> Option<SessionInfo> {
        self.sessions.read().await.get(id).cloned()
    }

    /// Notify activity for a session
    #[allow(dead_code)]
    pub async fn notify_activity(&self, session_id: &str) {
        if let Some(session) = self.sessions.write().await.get_mut(session_id) {
            session.last_activity = Utc::now().to_rfc3339();

            // Broadcast activity event
            Self::broadcast_event(
                &self.event_subscribers,
                SessionEvent::SessionActivity {
                    id: session_id.to_string(),
                    timestamp: session.last_activity.clone(),
                },
            )
            .await;
        }
    }

    /// Broadcast an event to all subscribers
    async fn broadcast_event(
        subscribers: &Arc<RwLock<HashMap<String, mpsc::UnboundedSender<SessionEvent>>>>,
        event: SessionEvent,
    ) {
        let subscribers_read = subscribers.read().await;
        let mut dead_subscribers = Vec::new();

        for (id, tx) in subscribers_read.iter() {
            if tx.send(event.clone()).is_err() {
                dead_subscribers.push(id.clone());
            }
        }

        // Remove dead subscribers
        if !dead_subscribers.is_empty() {
            drop(subscribers_read);
            let mut subscribers_write = subscribers.write().await;
            for id in dead_subscribers {
                subscribers_write.remove(&id);
            }
        }
    }

    /// Create an SSE stream for session events
    pub fn create_sse_stream(
        self: Arc<Self>,
    ) -> impl futures::Stream<Item = Result<String, std::convert::Infallible>> + Send + 'static
    {
        async_stream::stream! {
            // Subscribe to events
            let (tx, mut rx) = mpsc::unbounded_channel();
            let subscriber_id = Uuid::new_v4().to_string();
            self.event_subscribers.write().await.insert(subscriber_id.clone(), tx);

            // Send initial sessions
            let session_list = self.sessions.read().await.values().cloned().collect::<Vec<_>>();
            let initial_event = serde_json::json!({
                "type": "initial",
                "sessions": session_list,
                "count": session_list.len()
            });

            yield Ok(format!("data: {initial_event}\n\n"));

            // Send events as they come
            while let Some(event) = rx.recv().await {
                if let Ok(json) = serde_json::to_string(&event) {
                    yield Ok(format!("data: {json}\n\n"));
                }
            }

            // Clean up subscriber on drop
            self.event_subscribers.write().await.remove(&subscriber_id);
        }
    }
}

/// Session statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionStats {
    pub total_sessions: usize,
    pub active_sessions: usize,
    pub total_clients: usize,
    pub uptime_seconds: u64,
    pub sessions_created_today: usize,
}

impl SessionMonitor {
    /// Get session statistics
    pub async fn get_stats(&self) -> SessionStats {
        let sessions = self.sessions.read().await;
        let active_sessions = sessions.values().filter(|s| s.is_active).count();
        let total_clients = sessions.values().map(|s| s.client_count).sum();

        // TODO: Track more detailed statistics
        SessionStats {
            total_sessions: sessions.len(),
            active_sessions,
            total_clients,
            uptime_seconds: 0,         // TODO: Track uptime
            sessions_created_today: 0, // TODO: Track daily stats
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terminal::TerminalManager;
    use std::sync::Arc;
    use tokio::time::{timeout, Duration};

    // Mock terminal manager for testing
    struct MockTerminalManager {
        sessions: Arc<RwLock<Vec<SessionInfo>>>,
    }

    impl MockTerminalManager {
        fn new() -> Self {
            Self {
                sessions: Arc::new(RwLock::new(Vec::new())),
            }
        }

        async fn add_test_session(&self, id: &str, name: &str) {
            let session = SessionInfo {
                id: id.to_string(),
                name: name.to_string(),
                pid: 1234,
                rows: 24,
                cols: 80,
                created_at: Utc::now().to_rfc3339(),
                last_activity: Utc::now().to_rfc3339(),
                is_active: true,
                client_count: 0,
            };
            self.sessions.write().await.push(session);
        }

        async fn remove_test_session(&self, id: &str) {
            let mut sessions = self.sessions.write().await;
            sessions.retain(|s| s.id != id);
        }
    }

    #[tokio::test]
    async fn test_session_monitor_creation() {
        let terminal_manager = Arc::new(TerminalManager::new());
        let monitor = SessionMonitor::new(terminal_manager);

        assert_eq!(monitor.get_session_count().await, 0);
        assert!(monitor.get_sessions().await.is_empty());
    }

    #[tokio::test]
    async fn test_subscribe_unsubscribe() {
        let terminal_manager = Arc::new(TerminalManager::new());
        let monitor = SessionMonitor::new(terminal_manager);

        // Subscribe to events
        let mut receiver = monitor.subscribe().await;

        // Should have one subscriber
        assert_eq!(monitor.event_subscribers.read().await.len(), 1);

        // Drop receiver to simulate unsubscribe
        drop(receiver);

        // Wait a bit for cleanup
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    #[tokio::test]
    async fn test_session_activity_notification() {
        let terminal_manager = Arc::new(TerminalManager::new());
        let monitor = SessionMonitor::new(terminal_manager);

        // Add a test session manually
        let session = SessionInfo {
            id: "test-session".to_string(),
            name: "Test Session".to_string(),
            pid: 1234,
            rows: 24,
            cols: 80,
            created_at: Utc::now().to_rfc3339(),
            last_activity: Utc::now().to_rfc3339(),
            is_active: true,
            client_count: 0,
        };

        monitor
            .sessions
            .write()
            .await
            .insert(session.id.clone(), session.clone());

        // Subscribe to events
        let mut receiver = monitor.subscribe().await;

        // Notify activity
        monitor.notify_activity("test-session").await;

        // Check that we receive the activity event
        if let Ok(Some(event)) = timeout(Duration::from_secs(1), receiver.recv()).await {
            match event {
                SessionEvent::SessionActivity { id, timestamp: _ } => {
                    assert_eq!(id, "test-session");
                }
                _ => panic!("Expected SessionActivity event"),
            }
        } else {
            panic!("Did not receive expected event");
        }
    }

    #[tokio::test]
    async fn test_get_session() {
        let terminal_manager = Arc::new(TerminalManager::new());
        let monitor = SessionMonitor::new(terminal_manager);

        // Add a test session
        let session = SessionInfo {
            id: "test-session".to_string(),
            name: "Test Session".to_string(),
            pid: 1234,
            rows: 24,
            cols: 80,
            created_at: Utc::now().to_rfc3339(),
            last_activity: Utc::now().to_rfc3339(),
            is_active: true,
            client_count: 0,
        };

        monitor
            .sessions
            .write()
            .await
            .insert(session.id.clone(), session.clone());

        // Get the session
        let retrieved = monitor.get_session("test-session").await;
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().name, "Test Session");

        // Try to get non-existent session
        let not_found = monitor.get_session("non-existent").await;
        assert!(not_found.is_none());
    }

    #[tokio::test]
    async fn test_broadcast_event() {
        let terminal_manager = Arc::new(TerminalManager::new());
        let monitor = SessionMonitor::new(terminal_manager);

        // Create multiple subscribers
        let mut receiver1 = monitor.subscribe().await;
        let mut receiver2 = monitor.subscribe().await;

        // Create a test event
        let event = SessionEvent::SessionCreated {
            session: SessionInfo {
                id: "test".to_string(),
                name: "Test".to_string(),
                pid: 1234,
                rows: 24,
                cols: 80,
                created_at: Utc::now().to_rfc3339(),
                last_activity: Utc::now().to_rfc3339(),
                is_active: true,
                client_count: 0,
            },
        };

        // Broadcast the event
        SessionMonitor::broadcast_event(&monitor.event_subscribers, event.clone()).await;

        // Both receivers should get the event
        if let Ok(Some(received1)) = timeout(Duration::from_secs(1), receiver1.recv()).await {
            match received1 {
                SessionEvent::SessionCreated { session } => {
                    assert_eq!(session.id, "test");
                }
                _ => panic!("Wrong event type"),
            }
        } else {
            panic!("Receiver 1 did not receive event");
        }

        if let Ok(Some(received2)) = timeout(Duration::from_secs(1), receiver2.recv()).await {
            match received2 {
                SessionEvent::SessionCreated { session } => {
                    assert_eq!(session.id, "test");
                }
                _ => panic!("Wrong event type"),
            }
        } else {
            panic!("Receiver 2 did not receive event");
        }
    }

    #[tokio::test]
    async fn test_session_stats() {
        let terminal_manager = Arc::new(TerminalManager::new());
        let monitor = SessionMonitor::new(terminal_manager);

        // Add some test sessions
        let session1 = SessionInfo {
            id: "session1".to_string(),
            name: "Session 1".to_string(),
            pid: 1234,
            rows: 24,
            cols: 80,
            created_at: Utc::now().to_rfc3339(),
            last_activity: Utc::now().to_rfc3339(),
            is_active: true,
            client_count: 2,
        };

        let session2 = SessionInfo {
            id: "session2".to_string(),
            name: "Session 2".to_string(),
            pid: 5678,
            rows: 30,
            cols: 120,
            created_at: Utc::now().to_rfc3339(),
            last_activity: Utc::now().to_rfc3339(),
            is_active: false,
            client_count: 0,
        };

        monitor
            .sessions
            .write()
            .await
            .insert(session1.id.clone(), session1);
        monitor
            .sessions
            .write()
            .await
            .insert(session2.id.clone(), session2);

        // Get stats
        let stats = monitor.get_stats().await;

        assert_eq!(stats.total_sessions, 2);
        assert_eq!(stats.active_sessions, 1);
        assert_eq!(stats.total_clients, 2);
    }

    #[tokio::test]
    async fn test_dead_subscriber_cleanup() {
        let terminal_manager = Arc::new(TerminalManager::new());
        let monitor = SessionMonitor::new(terminal_manager);

        // Create a subscriber and immediately drop it
        let receiver = monitor.subscribe().await;
        drop(receiver);

        // Give some time for the channel to close
        tokio::time::sleep(Duration::from_millis(100)).await;

        // Try to broadcast an event
        let event = SessionEvent::SessionClosed {
            id: "test".to_string(),
        };

        SessionMonitor::broadcast_event(&monitor.event_subscribers, event).await;

        // The dead subscriber should be removed
        tokio::time::sleep(Duration::from_millis(100)).await;

        // After cleanup, we should have no subscribers
        assert_eq!(monitor.event_subscribers.read().await.len(), 0);
    }
}
