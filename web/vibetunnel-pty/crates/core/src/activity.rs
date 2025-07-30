use regex::Regex;
use serde::{Deserialize, Serialize};

/// Activity detection for Claude CLI and other tools
pub struct ActivityDetector {
    claude_pattern: Regex,
    ansi_escape_pattern: Regex,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Activity {
    pub timestamp: f64,
    pub status: String,
    pub details: Option<String>,
    pub indicator: Option<String>,
    pub duration: Option<u32>,
    pub tokens: Option<String>,
}

impl Default for ActivityDetector {
    fn default() -> Self {
        Self {
            // Comprehensive Claude status pattern matching multiple formats:
            // Format 1: ✻ Crafting… (205s · ↑ 6.0k tokens · <any text> to interrupt)
            // Format 2: ✻ Measuring… (6s ·  100 tokens · esc to interrupt)
            // Format 3: ⏺ Calculating… (0s) - simpler format without tokens/interrupt
            // Format 4: ✳ Measuring… (120s · ⚒ 671 tokens · esc to interrupt) - with hammer symbol
            // Match ANY non-whitespace character as the indicator since Claude uses many symbols
            claude_pattern: Regex::new(
                r"(?im)^(\S)\s+([^…\n]+?)…\s*\((\d+)s(?:\s*·\s*(\S?)\s*([\d.]+k?)\s*tokens\s*·\s*[^)]+to\s+interrupt)?\)"
            ).expect("Failed to compile activity regex"),
            // ANSI escape code pattern for cleanup
            ansi_escape_pattern: Regex::new(r"\x1b\[[0-9;]*[mGKHF]")
                .expect("Failed to compile ANSI escape pattern"),
        }
    }
}

impl ActivityDetector {
    pub fn new() -> anyhow::Result<Self> {
        Ok(Self::default())
    }

    pub fn detect(&self, data: &[u8]) -> Option<Activity> {
        let text = String::from_utf8_lossy(data);

        // Strip ANSI escape codes for cleaner matching
        let clean_text = self.ansi_escape_pattern.replace_all(&text, "");

        if let Some(captures) = self.claude_pattern.captures(&clean_text) {
            let indicator = captures.get(1).map(|m| m.as_str().to_string());
            let status = captures.get(2)?.as_str().trim().to_string();
            let duration = captures.get(3)?.as_str().parse::<u32>().ok();

            let details;
            let mut tokens = None;

            // If we have the extended format with tokens
            if captures.get(4).is_some() {
                let token_prefix = captures.get(4).map(|m| m.as_str()).unwrap_or("");
                let token_count = captures.get(5).map(|m| m.as_str()).unwrap_or("");
                tokens = Some(format!("{token_prefix}{token_count}"));

                details = Some(format!(
                    "{}s · {} tokens",
                    duration.unwrap_or(0),
                    tokens.as_ref().unwrap()
                ));
            } else {
                // Simple format without tokens
                details = Some(format!("{}s", duration.unwrap_or(0)));
            }

            return Some(Activity {
                timestamp: chrono::Utc::now().timestamp_millis() as f64,
                status,
                details,
                indicator,
                duration,
                tokens,
            });
        }

        None
    }

    /// Filter out activity status lines from output
    pub fn filter_status(&self, data: &str) -> String {
        let clean_text = self.ansi_escape_pattern.replace_all(data, "");
        self.claude_pattern.replace_all(&clean_text, "").to_string()
    }
}

#[cfg(test)]
#[path = "activity_tests.rs"]
mod tests;
