use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Session information matching the TypeScript SessionInfo interface
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: String,
    pub name: String,
    pub command: Vec<String>,
    pub pid: Option<u32>,
    pub created_at: DateTime<Utc>,
    pub status: String,
    pub working_dir: String,
    pub cols: u16,
    pub rows: u16,
    pub exit_code: Option<i32>,
    pub title_mode: Option<String>,
    pub is_external_terminal: bool,
}

/// Trait for session storage implementations
pub trait SessionStore {
    fn create_session(&mut self, info: SessionInfo) -> anyhow::Result<()>;
    fn get_session(&self, id: &str) -> Option<&SessionInfo>;
    fn update_session(&mut self, id: &str, info: SessionInfo) -> anyhow::Result<()>;
    fn remove_session(&mut self, id: &str) -> Option<SessionInfo>;
}

/// In-memory session store for NAPI addon
#[derive(Default)]
pub struct MemorySessionStore {
    sessions: HashMap<String, SessionInfo>,
}

impl MemorySessionStore {
    pub fn new() -> Self {
        Self::default()
    }
}

impl SessionStore for MemorySessionStore {
    fn create_session(&mut self, info: SessionInfo) -> anyhow::Result<()> {
        self.sessions.insert(info.id.clone(), info);
        Ok(())
    }

    fn get_session(&self, id: &str) -> Option<&SessionInfo> {
        self.sessions.get(id)
    }

    fn update_session(&mut self, id: &str, info: SessionInfo) -> anyhow::Result<()> {
        self.sessions.insert(id.to_string(), info);
        Ok(())
    }

    fn remove_session(&mut self, id: &str) -> Option<SessionInfo> {
        self.sessions.remove(id)
    }
}

#[cfg(test)]
#[path = "session_tests.rs"]
mod tests;
