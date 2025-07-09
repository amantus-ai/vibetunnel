use anyhow::{Context, Result};
use std::fs;
use std::path::PathBuf;
use vibetunnel_pty_core::{SessionInfo, SessionStore};

/// File-based session store for CLI
pub struct FileSessionStore {
    control_dir: PathBuf,
}

impl FileSessionStore {
    pub fn new(session_id: &str) -> Result<Self> {
        let home = dirs::home_dir().context("Failed to get home directory")?;
        let control_dir = home.join(".vibetunnel").join("control").join(session_id);

        // Create directory
        fs::create_dir_all(&control_dir).context("Failed to create control directory")?;

        Ok(Self { control_dir })
    }

    pub fn socket_path(&self) -> PathBuf {
        self.control_dir.join("ipc.sock")
    }

    pub fn stdout_path(&self) -> PathBuf {
        self.control_dir.join("stdout")
    }

    pub fn stdin_path(&self) -> PathBuf {
        self.control_dir.join("stdin")
    }
}

impl SessionStore for FileSessionStore {
    fn create_session(&mut self, info: SessionInfo) -> Result<()> {
        let session_path = self.control_dir.join("session.json");
        let content = serde_json::to_string_pretty(&info)?;
        fs::write(&session_path, content).context("Failed to write session.json")?;

        // Create empty files
        fs::write(self.stdout_path(), "").context("Failed to create stdout file")?;
        fs::write(self.stdin_path(), "").context("Failed to create stdin file")?;

        Ok(())
    }

    fn get_session(&self, _id: &str) -> Option<&SessionInfo> {
        // Not needed for CLI
        None
    }

    fn update_session(&mut self, _id: &str, info: SessionInfo) -> Result<()> {
        self.create_session(info)
    }

    fn remove_session(&mut self, _id: &str) -> Option<SessionInfo> {
        // Not needed for CLI
        None
    }
}

/// Load session from file
pub fn load_session(session_id: &str) -> Result<(SessionInfo, FileSessionStore)> {
    let home = dirs::home_dir().context("Failed to get home directory")?;
    let control_dir = home.join(".vibetunnel").join("control").join(session_id);
    let session_path = control_dir.join("session.json");

    let content = fs::read_to_string(&session_path).context("Failed to read session.json")?;
    let info: SessionInfo =
        serde_json::from_str(&content).context("Failed to parse session.json")?;

    let store = FileSessionStore { control_dir };

    Ok((info, store))
}
