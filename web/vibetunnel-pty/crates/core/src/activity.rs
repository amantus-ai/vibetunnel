use regex::Regex;
use serde::{Deserialize, Serialize};

/// Activity detection for Claude CLI
pub struct ActivityDetector {
    claude_pattern: Regex,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Activity {
    pub timestamp: f64,
    pub status: String,
    pub details: Option<String>,
}

impl Default for ActivityDetector {
    fn default() -> Self {
        Self {
            claude_pattern: Regex::new(r"✻\s+([^(]+)\s*\(([^)]+)\)")
                .expect("Failed to compile activity regex"),
        }
    }
}

impl ActivityDetector {
    pub fn new() -> anyhow::Result<Self> {
        Ok(Self::default())
    }

    pub fn detect(&self, data: &[u8]) -> Option<Activity> {
        let text = String::from_utf8_lossy(data);

        if let Some(captures) = self.claude_pattern.captures(&text) {
            let status = captures.get(1)?.as_str().to_string();
            let details = captures.get(2)?.as_str().to_string();

            return Some(Activity {
                timestamp: chrono::Utc::now().timestamp_millis() as f64,
                status,
                details: Some(details),
            });
        }

        None
    }
}
