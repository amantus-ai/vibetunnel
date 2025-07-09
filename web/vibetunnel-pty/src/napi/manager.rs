use crate::core::{PtyHandle, SessionInfo, SessionStore};
use crate::core::session::MemorySessionStore;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

pub struct PtySession {
    pub handle: PtyHandle,
    pub info: SessionInfo,
}

pub struct PtyManager {
    sessions: HashMap<String, PtySession>,
    store: MemorySessionStore,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
            store: MemorySessionStore::new(),
        }
    }

    pub fn add_session(&mut self, session_id: String, handle: PtyHandle, info: SessionInfo) {
        self.store.create_session(info.clone()).unwrap();
        self.sessions.insert(session_id, PtySession { handle, info });
    }

    pub fn get_session_mut(&mut self, session_id: &str) -> Option<&mut PtySession> {
        self.sessions.get_mut(session_id)
    }

    pub fn remove_session(&mut self, session_id: &str) -> Option<PtySession> {
        self.store.remove_session(session_id);
        self.sessions.remove(session_id)
    }
}

// Global PTY manager
lazy_static::lazy_static! {
    pub static ref PTY_MANAGER: Arc<Mutex<PtyManager>> = Arc::new(Mutex::new(PtyManager::new()));
}