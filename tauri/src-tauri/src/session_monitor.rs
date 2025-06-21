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
                    };

                    // Check if this is a new session
                    if !sessions_map.contains_key(&session.id) {
                        // Broadcast session created event
                        Self::broadcast_event(
                            &subscribers,
                            SessionEvent::SessionCreated {
                                session: session_info.clone(),
                            },
                        )
                        .await;
                    } else {
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

            yield Ok(format!("data: {}\n\n", initial_event));

            // Send events as they come
            while let Some(event) = rx.recv().await {
                if let Ok(json) = serde_json::to_string(&event) {
                    yield Ok(format!("data: {}\n\n", json));
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
