use serde::{Deserialize, Serialize};
use std::process::{Command, Child};
use std::sync::{Arc, Mutex};
use tauri::State;
use crate::state::AppState;
use tracing::info;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NgrokTunnel {
    pub url: String,
    pub port: u16,
    pub status: String,
}

pub struct NgrokManager {
    process: Arc<Mutex<Option<Child>>>,
    tunnel_info: Arc<Mutex<Option<NgrokTunnel>>>,
}

impl NgrokManager {
    pub fn new() -> Self {
        Self {
            process: Arc::new(Mutex::new(None)),
            tunnel_info: Arc::new(Mutex::new(None)),
        }
    }
    
    pub async fn start_tunnel(&self, port: u16, auth_token: Option<String>) -> Result<NgrokTunnel, String> {
        // Check if ngrok is installed
        let ngrok_path = which::which("ngrok")
            .map_err(|_| "ngrok not found. Please install ngrok first.".to_string())?;
            
        // Set auth token if provided
        if let Some(token) = auth_token {
            Command::new(&ngrok_path)
                .args(&["config", "add-authtoken", &token])
                .output()
                .map_err(|e| format!("Failed to set ngrok auth token: {}", e))?;
        }
        
        // Start ngrok tunnel
        let child = Command::new(&ngrok_path)
            .args(&["http", &port.to_string(), "--log=stdout"])
            .spawn()
            .map_err(|e| format!("Failed to start ngrok: {}", e))?;
            
        // Wait a bit for ngrok to start
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
        
        // Get tunnel information via ngrok API
        let tunnel_info = self.get_tunnel_info().await?;
        
        // Store process and tunnel info
        *self.process.lock().unwrap() = Some(child);
        *self.tunnel_info.lock().unwrap() = Some(tunnel_info.clone());
        
        info!("ngrok tunnel started: {}", tunnel_info.url);
        
        Ok(tunnel_info)
    }
    
    pub async fn stop_tunnel(&self) -> Result<(), String> {
        if let Some(mut child) = self.process.lock().unwrap().take() {
            child.kill()
                .map_err(|e| format!("Failed to stop ngrok: {}", e))?;
                
            info!("ngrok tunnel stopped");
        }
        
        *self.tunnel_info.lock().unwrap() = None;
        
        Ok(())
    }
    
    pub fn get_tunnel_status(&self) -> Option<NgrokTunnel> {
        self.tunnel_info.lock().unwrap().clone()
    }
    
    async fn get_tunnel_info(&self) -> Result<NgrokTunnel, String> {
        // Query ngrok local API
        let response = reqwest::get("http://localhost:4040/api/tunnels")
            .await
            .map_err(|e| format!("Failed to query ngrok API: {}", e))?;
            
        let data: serde_json::Value = response.json()
            .await
            .map_err(|e| format!("Failed to parse ngrok API response: {}", e))?;
            
        // Extract tunnel URL
        let tunnels = data["tunnels"].as_array()
            .ok_or_else(|| "No tunnels found".to_string())?;
            
        let tunnel = tunnels.iter()
            .find(|t| t["proto"].as_str() == Some("https"))
            .or_else(|| tunnels.first())
            .ok_or_else(|| "No tunnel found".to_string())?;
            
        let url = tunnel["public_url"].as_str()
            .ok_or_else(|| "No public URL found".to_string())?;
            
        let port = tunnel["config"]["addr"].as_str()
            .and_then(|addr| addr.split(':').last())
            .and_then(|p| p.parse::<u16>().ok())
            .unwrap_or(3000);
            
        Ok(NgrokTunnel {
            url: url.to_string(),
            port,
            status: "active".to_string(),
        })
    }
}

#[tauri::command]
pub async fn start_ngrok_tunnel(
    port: u16,
    auth_token: Option<String>,
    state: State<'_, AppState>,
) -> Result<NgrokTunnel, String> {
    state.ngrok_manager.start_tunnel(port, auth_token).await
}

#[tauri::command]
pub async fn stop_ngrok_tunnel(
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.ngrok_manager.stop_tunnel().await
}

#[tauri::command]
pub async fn get_ngrok_status(
    state: State<'_, AppState>,
) -> Result<Option<NgrokTunnel>, String> {
    Ok(state.ngrok_manager.get_tunnel_status())
}