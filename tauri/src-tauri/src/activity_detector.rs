use chrono::{DateTime, Utc};
use regex::Regex;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

/// Activity state for a session
#[derive(Debug, Clone)]
pub struct ActivityState {
    pub is_active: bool,
    pub specific_status: Option<SpecificStatus>,
    pub last_activity: DateTime<Utc>,
    pub last_meaningful_output: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone)]
pub struct SpecificStatus {
    pub app: String,
    pub status: String,
}

/// Detects activity patterns in terminal output
pub struct ActivityDetector {
    command: Vec<String>,
    last_output_time: Arc<RwLock<DateTime<Utc>>>,
    last_meaningful_output_time: Arc<RwLock<Option<DateTime<Utc>>>>,
    current_status: Arc<RwLock<Option<SpecificStatus>>>,
    claude_pattern: Regex,
    status_line_pattern: Regex,
    prompt_pattern: Regex,
}

impl ActivityDetector {
    /// Create a new activity detector for a command
    pub fn new(command: Vec<String>) -> Self {
        Self {
            command,
            last_output_time: Arc::new(RwLock::new(Utc::now())),
            last_meaningful_output_time: Arc::new(RwLock::new(None)),
            current_status: Arc::new(RwLock::new(None)),
            // Claude status pattern: ✻ Action... (time · tokens)
            claude_pattern: Regex::new(r"✻\s+([^(]+)\s*\(([^)]+)\)").unwrap(),
            // Generic status line pattern (for future expansion)
            status_line_pattern: Regex::new(r"^\s*(?:⚡|✓|✗|⏳|🔄|📝|🔍)\s+(.+)").unwrap(),
            // Common prompt patterns to ignore
            prompt_pattern: Regex::new(r"(?:[$#>%]|>>>|\.\.\.)?\s*$").unwrap(),
        }
    }

    /// Process terminal output and detect activity
    pub fn process_output(&self, data: &str) -> (String, ActivityState) {
        // Update last output time
        *self.last_output_time.write().unwrap() = Utc::now();

        // Check if this is meaningful output (not just prompts or empty lines)
        let is_meaningful = !data.trim().is_empty() && 
                          !self.prompt_pattern.is_match(data) &&
                          data.trim().len() > 2;

        if is_meaningful {
            *self.last_meaningful_output_time.write().unwrap() = Some(Utc::now());
        }

        // Detect Claude status
        let mut filtered_data = String::new();
        let mut status_detected = false;

        for line in data.lines() {
            if let Some(captures) = self.claude_pattern.captures(line) {
                if let (Some(action), Some(details)) = (captures.get(1), captures.get(2)) {
                    let status = SpecificStatus {
                        app: "claude".to_string(),
                        status: format!("{} ({})", action.as_str().trim(), details.as_str().trim()),
                    };
                    *self.current_status.write().unwrap() = Some(status);
                    status_detected = true;
                    // Filter out Claude status lines from output
                    continue;
                }
            }

            // Check for other status patterns
            if let Some(captures) = self.status_line_pattern.captures(line) {
                if let Some(status_text) = captures.get(1) {
                    // Determine app based on command
                    let app = self.detect_app_from_command();
                    let status = SpecificStatus {
                        app,
                        status: status_text.as_str().trim().to_string(),
                    };
                    *self.current_status.write().unwrap() = Some(status);
                    status_detected = true;
                }
            }

            filtered_data.push_str(line);
            filtered_data.push('\n');
        }

        // Remove trailing newline if we added one
        if filtered_data.ends_with('\n') && !data.ends_with('\n') {
            filtered_data.pop();
        }

        let activity_state = self.get_activity_state();
        
        (if status_detected { filtered_data } else { data.to_string() }, activity_state)
    }

    /// Get current activity state
    pub fn get_activity_state(&self) -> ActivityState {
        let now = Utc::now();
        let last_output = *self.last_output_time.read().unwrap();
        let last_meaningful = *self.last_meaningful_output_time.read().unwrap();
        let current_status = self.current_status.read().unwrap().clone();

        // Consider active if:
        // 1. We have a current status (like Claude working)
        // 2. OR we had meaningful output in the last 30 seconds
        let is_active = current_status.is_some() || 
                       last_meaningful.map_or(false, |t| (now - t).num_seconds() < 30);

        ActivityState {
            is_active,
            specific_status: current_status,
            last_activity: last_output,
            last_meaningful_output: last_meaningful,
        }
    }

    /// Clear current status
    pub fn clear_status(&self) {
        *self.current_status.write().unwrap() = None;
    }

    /// Detect app name from command
    fn detect_app_from_command(&self) -> String {
        if self.command.is_empty() {
            return "unknown".to_string();
        }

        let cmd = &self.command[0];
        let cmd_lower = cmd.to_lowercase();

        // Check for Claude
        if cmd_lower.contains("claude") || 
           self.command.iter().any(|arg| arg.to_lowercase().contains("claude")) {
            return "claude".to_string();
        }

        // Check for common development tools
        let known_apps = HashMap::from([
            ("npm", "npm"),
            ("yarn", "yarn"),
            ("pnpm", "pnpm"),
            ("cargo", "cargo"),
            ("rustc", "rust"),
            ("python", "python"),
            ("node", "node"),
            ("git", "git"),
            ("docker", "docker"),
            ("kubectl", "kubernetes"),
            ("terraform", "terraform"),
            ("ansible", "ansible"),
            ("make", "make"),
            ("gradle", "gradle"),
            ("maven", "maven"),
            ("dotnet", "dotnet"),
            ("go", "go"),
        ]);

        for (key, app_name) in known_apps {
            if cmd_lower.contains(key) {
                return app_name.to_string();
            }
        }

        // Use the base command name
        cmd.split('/').last().unwrap_or("unknown").to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_claude_pattern_detection() {
        let detector = ActivityDetector::new(vec!["claude".to_string()]);
        
        let input = "✻ Analyzing code... (45s · ↑ 1.2k tokens · ↓ 500 tokens)\n";
        let (filtered, state) = detector.process_output(input);
        
        assert!(state.is_active);
        assert!(state.specific_status.is_some());
        
        let status = state.specific_status.unwrap();
        assert_eq!(status.app, "claude");
        assert!(status.status.contains("Analyzing code"));
        assert!(filtered.trim().is_empty()); // Status line should be filtered
    }

    #[test]
    fn test_meaningful_output_detection() {
        let detector = ActivityDetector::new(vec!["ls".to_string()]);
        
        // Meaningful output
        let (_, state1) = detector.process_output("file1.txt\nfile2.txt\n");
        assert!(state1.last_meaningful_output.is_some());
        
        // Not meaningful (just prompt)
        let (_, state2) = detector.process_output("$ ");
        assert!(state2.is_active); // Still active due to recent meaningful output
    }
}