use anyhow::{Context, Result};
use serde::Deserialize;
use serde_json::json;

/// Response from the server when creating a session
#[derive(Debug, Deserialize)]
pub struct CreateSessionResponse {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[allow(dead_code)]
    pub message: Option<String>,
}

/// API client for communicating with VibeTunnel server
pub struct ApiClient {
    base_url: String,
    client: reqwest::blocking::Client,
}

impl ApiClient {
    /// Create a new API client
    pub fn new(port: u16) -> Result<Self> {
        let base_url = format!("http://localhost:{}", port);
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .context("Failed to create HTTP client")?;

        Ok(Self { base_url, client })
    }

    /// Create a new session on the server
    pub fn create_session(
        &self,
        command: Vec<String>,
        working_dir: String,
        name: String,
        cols: u16,
        rows: u16,
        title_mode: Option<String>,
    ) -> Result<CreateSessionResponse> {
        let url = format!("{}/api/sessions", self.base_url);

        // Build request body matching the server's expected format
        let body = json!({
            "command": command,
            "workingDir": working_dir,
            "name": name,
            "spawn_terminal": true,  // Request terminal spawn
            "cols": cols,
            "rows": rows,
            "titleMode": title_mode,
        });

        // Make the request
        let response = self
            .client
            .post(&url)
            .json(&body)
            .send()
            .context("Failed to send session creation request")?;

        // Check response status
        if !response.status().is_success() {
            let status = response.status();
            let error_body = response
                .text()
                .unwrap_or_else(|_| "Unknown error".to_string());
            anyhow::bail!(
                "Server returned error {}: {}",
                status,
                error_body
            );
        }

        // Parse response
        let result: CreateSessionResponse = response
            .json()
            .context("Failed to parse session creation response")?;

        Ok(result)
    }

    /// Wait for a session to be created on disk
    /// This is needed because the server creates sessions asynchronously
    pub fn wait_for_session(&self, session_id: &str) -> Result<()> {
        let max_attempts = 50; // 5 seconds total
        let delay = std::time::Duration::from_millis(100);

        for _ in 0..max_attempts {
            // Check if the session directory exists
            let control_dir = dirs::home_dir()
                .context("Failed to get home directory")?
                .join(".vibetunnel")
                .join("control")
                .join(session_id);

            if control_dir.exists() && control_dir.join("ipc.sock").exists() {
                return Ok(());
            }

            std::thread::sleep(delay);
        }

        anyhow::bail!("Timeout waiting for session {} to be created", session_id)
    }
}