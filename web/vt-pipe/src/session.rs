use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

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

/// Session manager for handling session metadata
pub struct Session {
  pub info: SessionInfo,
  control_dir: PathBuf,
}

impl Session {
  /// Create a new session
  pub fn create(info: SessionInfo) -> Result<Self> {
    let control_base = Self::control_base_dir()?;
    let control_dir = control_base.join(&info.id);

    // Create control directory
    fs::create_dir_all(&control_dir).context("Failed to create control directory")?;

    let session = Self {
      info: info.clone(),
      control_dir,
    };

    // Write session.json
    session.save()?;

    // Create empty files
    fs::write(session.stdout_path(), "").context("Failed to create stdout file")?;
    fs::write(session.stdin_path(), "").context("Failed to create stdin file")?;

    Ok(session)
  }

  /// Load an existing session
  pub fn load(session_id: &str) -> Result<Self> {
    let control_base = Self::control_base_dir()?;
    let control_dir = control_base.join(session_id);
    let session_path = control_dir.join("session.json");

    let content = fs::read_to_string(&session_path).context("Failed to read session.json")?;

    let info: SessionInfo =
      serde_json::from_str(&content).context("Failed to parse session.json")?;

    Ok(Self { info, control_dir })
  }

  /// Save session info to disk
  pub fn save(&self) -> Result<()> {
    let session_path = self.control_dir.join("session.json");
    let content = serde_json::to_string_pretty(&self.info)?;
    fs::write(&session_path, content).context("Failed to write session.json")?;
    Ok(())
  }

  /// Update session title
  pub fn update_title(&self, new_title: &str) -> Result<()> {
    let mut info = self.info.clone();
    info.name = new_title.to_string();

    let session = Self {
      info,
      control_dir: self.control_dir.clone(),
    };

    session.save()
  }

  /// Get paths for various session files
  pub fn socket_path(&self) -> PathBuf {
    self.control_dir.join("ipc.sock")
  }

  pub fn stdout_path(&self) -> PathBuf {
    self.control_dir.join("stdout")
  }

  pub fn stdin_path(&self) -> PathBuf {
    self.control_dir.join("stdin")
  }

  #[allow(dead_code)]
  pub fn activity_path(&self) -> PathBuf {
    self.control_dir.join("activity.json")
  }

  /// Clean up session files
  pub fn cleanup(&self) -> Result<()> {
    // Update status
    let mut info = self.info.clone();
    info.status = "exited".to_string();

    let session = Self {
      info,
      control_dir: self.control_dir.clone(),
    };

    session.save()?;

    // Note: We don't delete files here as the server may still need them
    Ok(())
  }

  /// Get the base control directory
  fn control_base_dir() -> Result<PathBuf> {
    let home = dirs::home_dir().context("Failed to get home directory")?;

    let control_dir = home.join(".vibetunnel").join("control");

    // Create if it doesn't exist
    fs::create_dir_all(&control_dir).context("Failed to create control base directory")?;

    Ok(control_dir)
  }
}
