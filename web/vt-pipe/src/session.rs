use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// Session information matching the TypeScript SessionInfo interface
/// This is read-only - sessions are created and managed by the server
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

/// Read-only session interface for accessing server-created sessions
pub struct Session {
  #[allow(dead_code)]
  info: SessionInfo,
  control_dir: PathBuf,
}

impl Session {
  /// Load an existing session created by the server
  pub fn load(session_id: &str) -> Result<Self> {
    let control_base = Self::control_base_dir()?;
    let control_dir = control_base.join(session_id);
    let session_path = control_dir.join("session.json");

    let content = fs::read_to_string(&session_path).context("Failed to read session.json")?;

    let info: SessionInfo =
      serde_json::from_str(&content).context("Failed to parse session.json")?;

    Ok(Self { info, control_dir })
  }

  /// Get the path to the Unix socket for this session
  pub fn socket_path(&self) -> PathBuf {
    self.control_dir.join("ipc.sock")
  }

  /// Get the base control directory
  fn control_base_dir() -> Result<PathBuf> {
    let home = dirs::home_dir().context("Failed to get home directory")?;
    let control_dir = home.join(".vibetunnel").join("control");
    Ok(control_dir)
  }
}