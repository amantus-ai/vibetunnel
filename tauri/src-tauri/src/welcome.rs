use serde::{Serialize, Deserialize};
use std::sync::Arc;
use tokio::sync::RwLock;
use std::collections::HashMap;
use chrono::{DateTime, Utc};
use tauri::{AppHandle, Manager, Emitter};

/// Tutorial step structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TutorialStep {
    pub id: String,
    pub title: String,
    pub description: String,
    pub content: String,
    pub action: Option<TutorialAction>,
    pub completed: bool,
    pub order: u32,
}

/// Tutorial action that can be triggered
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TutorialAction {
    pub action_type: String,
    pub payload: HashMap<String, serde_json::Value>,
}

/// Welcome state tracking
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WelcomeState {
    pub first_launch: bool,
    pub tutorial_completed: bool,
    pub tutorial_skipped: bool,
    pub completed_steps: Vec<String>,
    pub last_seen_version: Option<String>,
    pub onboarding_date: Option<DateTime<Utc>>,
}

impl Default for WelcomeState {
    fn default() -> Self {
        Self {
            first_launch: true,
            tutorial_completed: false,
            tutorial_skipped: false,
            completed_steps: Vec::new(),
            last_seen_version: None,
            onboarding_date: None,
        }
    }
}

/// Tutorial category
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TutorialCategory {
    pub id: String,
    pub name: String,
    pub description: String,
    pub icon: String,
    pub steps: Vec<TutorialStep>,
}

/// Welcome manager
pub struct WelcomeManager {
    state: Arc<RwLock<WelcomeState>>,
    tutorials: Arc<RwLock<Vec<TutorialCategory>>>,
    app_handle: Arc<RwLock<Option<AppHandle>>>,
}

impl WelcomeManager {
    /// Create a new welcome manager
    pub fn new() -> Self {
        let manager = Self {
            state: Arc::new(RwLock::new(WelcomeState::default())),
            tutorials: Arc::new(RwLock::new(Vec::new())),
            app_handle: Arc::new(RwLock::new(None)),
        };
        
        // Initialize default tutorials
        tokio::spawn({
            let tutorials = manager.tutorials.clone();
            async move {
                let default_tutorials = Self::create_default_tutorials();
                *tutorials.write().await = default_tutorials;
            }
        });
        
        manager
    }

    /// Set the app handle
    pub async fn set_app_handle(&self, app_handle: AppHandle) {
        *self.app_handle.write().await = Some(app_handle);
    }

    /// Load welcome state from storage
    pub async fn load_state(&self) -> Result<(), String> {
        // Try to load from settings or local storage
        if let Ok(settings) = crate::settings::Settings::load() {
            // Check if this is first launch based on settings
            let mut state = self.state.write().await;
            state.first_launch = settings.general.show_welcome_on_startup.unwrap_or(true);
            
            // Mark first launch as false for next time
            if state.first_launch {
                state.onboarding_date = Some(Utc::now());
            }
        }
        Ok(())
    }

    /// Save welcome state
    pub async fn save_state(&self) -> Result<(), String> {
        let state = self.state.read().await;
        
        // Update settings to reflect welcome state
        if let Ok(mut settings) = crate::settings::Settings::load() {
            settings.general.show_welcome_on_startup = Some(!state.tutorial_completed && !state.tutorial_skipped);
            settings.save().map_err(|e| e.to_string())?;
        }
        
        Ok(())
    }

    /// Check if should show welcome screen
    pub async fn should_show_welcome(&self) -> bool {
        let state = self.state.read().await;
        state.first_launch && !state.tutorial_completed && !state.tutorial_skipped
    }

    /// Get current welcome state
    pub async fn get_state(&self) -> WelcomeState {
        self.state.read().await.clone()
    }

    /// Get all tutorial categories
    pub async fn get_tutorials(&self) -> Vec<TutorialCategory> {
        self.tutorials.read().await.clone()
    }

    /// Get specific tutorial category
    pub async fn get_tutorial_category(&self, category_id: &str) -> Option<TutorialCategory> {
        self.tutorials.read().await
            .iter()
            .find(|c| c.id == category_id)
            .cloned()
    }

    /// Complete a tutorial step
    pub async fn complete_step(&self, step_id: &str) -> Result<(), String> {
        let mut state = self.state.write().await;
        
        if !state.completed_steps.contains(&step_id.to_string()) {
            state.completed_steps.push(step_id.to_string());
            
            // Check if all steps are completed
            let tutorials = self.tutorials.read().await;
            let total_steps: usize = tutorials.iter()
                .map(|c| c.steps.len())
                .sum();
            
            if state.completed_steps.len() >= total_steps {
                state.tutorial_completed = true;
            }
            
            // Save state
            drop(state);
            drop(tutorials);
            self.save_state().await?;
            
            // Emit progress event
            if let Some(app_handle) = self.app_handle.read().await.as_ref() {
                let _ = app_handle.emit("tutorial:step_completed", step_id);
            }
        }
        
        Ok(())
    }

    /// Skip tutorial
    pub async fn skip_tutorial(&self) -> Result<(), String> {
        let mut state = self.state.write().await;
        state.tutorial_skipped = true;
        state.first_launch = false;
        drop(state);
        
        self.save_state().await?;
        
        Ok(())
    }

    /// Reset tutorial progress
    pub async fn reset_tutorial(&self) -> Result<(), String> {
        let mut state = self.state.write().await;
        state.completed_steps.clear();
        state.tutorial_completed = false;
        state.tutorial_skipped = false;
        drop(state);
        
        self.save_state().await?;
        
        Ok(())
    }

    /// Show welcome window
    pub async fn show_welcome_window(&self) -> Result<(), String> {
        if let Some(app_handle) = self.app_handle.read().await.as_ref() {
            // Check if welcome window already exists
            if let Some(window) = app_handle.get_webview_window("welcome") {
                window.show().map_err(|e| e.to_string())?;
                window.set_focus().map_err(|e| e.to_string())?;
            } else {
                // Create new welcome window
                tauri::WebviewWindowBuilder::new(
                    app_handle,
                    "welcome",
                    tauri::WebviewUrl::App("welcome.html".into())
                )
                .title("Welcome to VibeTunnel")
                .inner_size(800.0, 600.0)
                .center()
                .resizable(false)
                .build()
                .map_err(|e| e.to_string())?;
            }
        } else {
            return Err("App handle not set".to_string());
        }
        
        Ok(())
    }

    /// Create default tutorial content
    fn create_default_tutorials() -> Vec<TutorialCategory> {
        vec![
            TutorialCategory {
                id: "getting_started".to_string(),
                name: "Getting Started".to_string(),
                description: "Learn the basics of VibeTunnel".to_string(),
                icon: "🚀".to_string(),
                steps: vec![
                    TutorialStep {
                        id: "welcome".to_string(),
                        title: "Welcome to VibeTunnel".to_string(),
                        description: "Your powerful terminal session manager".to_string(),
                        content: r#"VibeTunnel lets you create, manage, and share terminal sessions with ease. 
                        
Key features:
• Create multiple terminal sessions
• Share sessions via web interface
• Record terminal sessions
• Secure remote access with ngrok
• Cross-platform support"#.to_string(),
                        action: None,
                        completed: false,
                        order: 1,
                    },
                    TutorialStep {
                        id: "create_session".to_string(),
                        title: "Creating Your First Session".to_string(),
                        description: "Learn how to create a terminal session".to_string(),
                        content: r#"To create a new terminal session:

1. Click the "New Terminal" button
2. Choose your preferred shell
3. Set the session name (optional)
4. Click "Create"

Your session will appear in the sidebar."#.to_string(),
                        action: Some(TutorialAction {
                            action_type: "create_terminal".to_string(),
                            payload: HashMap::new(),
                        }),
                        completed: false,
                        order: 2,
                    },
                    TutorialStep {
                        id: "start_server".to_string(),
                        title: "Starting the Web Server".to_string(),
                        description: "Share your sessions via web interface".to_string(),
                        content: r#"The web server lets you access your terminals from any browser:

1. Click "Start Server" in the toolbar
2. Choose your access mode:
   • Localhost - Access only from this machine
   • Network - Access from your local network
   • Ngrok - Access from anywhere (requires auth token)
3. Share the URL with others or access it yourself"#.to_string(),
                        action: Some(TutorialAction {
                            action_type: "start_server".to_string(),
                            payload: HashMap::new(),
                        }),
                        completed: false,
                        order: 3,
                    },
                ],
            },
            TutorialCategory {
                id: "advanced_features".to_string(),
                name: "Advanced Features".to_string(),
                description: "Discover powerful features".to_string(),
                icon: "⚡".to_string(),
                steps: vec![
                    TutorialStep {
                        id: "recording".to_string(),
                        title: "Recording Sessions".to_string(),
                        description: "Record and replay terminal sessions".to_string(),
                        content: r#"Record your terminal sessions in Asciinema format:

1. Right-click on a session
2. Select "Start Recording"
3. Perform your terminal tasks
4. Stop recording when done
5. Save or share the recording

Recordings can be played back later or shared with others."#.to_string(),
                        action: None,
                        completed: false,
                        order: 1,
                    },
                    TutorialStep {
                        id: "port_forwarding".to_string(),
                        title: "TTY Forwarding".to_string(),
                        description: "Forward terminal sessions over TCP".to_string(),
                        content: r#"TTY forwarding allows remote terminal access:

1. Go to Settings > Advanced
2. Enable TTY Forwarding
3. Configure the local port
4. Connect using: telnet localhost <port>

This is useful for accessing terminals from other applications."#.to_string(),
                        action: None,
                        completed: false,
                        order: 2,
                    },
                    TutorialStep {
                        id: "cli_tool".to_string(),
                        title: "Command Line Interface".to_string(),
                        description: "Use VibeTunnel from the terminal".to_string(),
                        content: r#"Install the CLI tool for quick access:

1. Go to Settings > Advanced
2. Click "Install CLI Tool"
3. Open a new terminal
4. Run: vt --help

Common commands:
• vt new - Create new session
• vt list - List sessions
• vt attach <id> - Attach to session"#.to_string(),
                        action: Some(TutorialAction {
                            action_type: "install_cli".to_string(),
                            payload: HashMap::new(),
                        }),
                        completed: false,
                        order: 3,
                    },
                ],
            },
            TutorialCategory {
                id: "security".to_string(),
                name: "Security & Settings".to_string(),
                description: "Configure security and preferences".to_string(),
                icon: "🔒".to_string(),
                steps: vec![
                    TutorialStep {
                        id: "password_protection".to_string(),
                        title: "Password Protection".to_string(),
                        description: "Secure your web interface".to_string(),
                        content: r#"Protect your sessions with a password:

1. Go to Settings > Dashboard
2. Enable "Password Protection"
3. Set a strong password
4. Save settings

Anyone accessing the web interface will need this password."#.to_string(),
                        action: Some(TutorialAction {
                            action_type: "open_settings".to_string(),
                            payload: HashMap::new(),
                        }),
                        completed: false,
                        order: 1,
                    },
                    TutorialStep {
                        id: "auto_launch".to_string(),
                        title: "Auto Launch".to_string(),
                        description: "Start VibeTunnel with your system".to_string(),
                        content: r#"Configure VibeTunnel to start automatically:

1. Go to Settings > General
2. Enable "Launch at startup"
3. Choose startup behavior:
   • Start minimized
   • Show dock icon
   • Auto-start server

VibeTunnel will be ready whenever you need it."#.to_string(),
                        action: None,
                        completed: false,
                        order: 2,
                    },
                ],
            },
        ]
    }

    /// Get tutorial progress
    pub async fn get_progress(&self) -> TutorialProgress {
        let state = self.state.read().await;
        let tutorials = self.tutorials.read().await;
        
        let total_steps: usize = tutorials.iter()
            .map(|c| c.steps.len())
            .sum();
        
        let completed_steps = state.completed_steps.len();
        let percentage = if total_steps > 0 {
            (completed_steps as f32 / total_steps as f32 * 100.0) as u32
        } else {
            0
        };
        
        TutorialProgress {
            total_steps,
            completed_steps,
            percentage,
            categories: tutorials.iter().map(|category| {
                let category_completed = category.steps.iter()
                    .filter(|s| state.completed_steps.contains(&s.id))
                    .count();
                
                CategoryProgress {
                    category_id: category.id.clone(),
                    category_name: category.name.clone(),
                    total_steps: category.steps.len(),
                    completed_steps: category_completed,
                }
            }).collect(),
        }
    }
}

/// Tutorial progress tracking
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TutorialProgress {
    pub total_steps: usize,
    pub completed_steps: usize,
    pub percentage: u32,
    pub categories: Vec<CategoryProgress>,
}

/// Category progress
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CategoryProgress {
    pub category_id: String,
    pub category_name: String,
    pub total_steps: usize,
    pub completed_steps: usize,
}