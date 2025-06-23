use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::process::{Child, Command};
use std::sync::{Arc, Mutex};
use tauri::State;
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

impl Default for NgrokManager {
    fn default() -> Self {
        Self::new()
    }
}

impl NgrokManager {
    pub fn new() -> Self {
        Self {
            process: Arc::new(Mutex::new(None)),
            tunnel_info: Arc::new(Mutex::new(None)),
        }
    }

    pub async fn start_tunnel(
        &self,
        port: u16,
        auth_token: Option<String>,
    ) -> Result<NgrokTunnel, String> {
        // Check if ngrok is installed
        let ngrok_path = which::which("ngrok")
            .map_err(|_| "ngrok not found. Please install ngrok first.".to_string())?;

        // Set auth token if provided
        if let Some(token) = auth_token {
            Command::new(&ngrok_path)
                .args(["config", "add-authtoken", &token])
                .output()
                .map_err(|e| format!("Failed to set ngrok auth token: {e}"))?;
        }

        // Start ngrok tunnel
        let child = Command::new(&ngrok_path)
            .args(["http", &port.to_string(), "--log=stdout"])
            .spawn()
            .map_err(|e| format!("Failed to start ngrok: {e}"))?;

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
            child
                .kill()
                .map_err(|e| format!("Failed to stop ngrok: {e}"))?;

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
            .map_err(|e| format!("Failed to query ngrok API: {e}"))?;

        let data: serde_json::Value = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse ngrok API response: {e}"))?;

        // Extract tunnel URL
        let tunnels = data["tunnels"]
            .as_array()
            .ok_or_else(|| "No tunnels found".to_string())?;

        let tunnel = tunnels
            .iter()
            .find(|t| t["proto"].as_str() == Some("https"))
            .or_else(|| tunnels.first())
            .ok_or_else(|| "No tunnel found".to_string())?;

        let url = tunnel["public_url"]
            .as_str()
            .ok_or_else(|| "No public URL found".to_string())?;

        let port = tunnel["config"]["addr"]
            .as_str()
            .and_then(|addr| addr.split(':').next_back())
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
pub async fn stop_ngrok_tunnel(state: State<'_, AppState>) -> Result<(), String> {
    state.ngrok_manager.stop_tunnel().await
}

#[tauri::command]
pub async fn get_ngrok_status(state: State<'_, AppState>) -> Result<Option<NgrokTunnel>, String> {
    Ok(state.ngrok_manager.get_tunnel_status())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ngrok_tunnel_creation() {
        let tunnel = NgrokTunnel {
            url: "https://abc123.ngrok.io".to_string(),
            port: 8080,
            status: "active".to_string(),
        };

        assert_eq!(tunnel.url, "https://abc123.ngrok.io");
        assert_eq!(tunnel.port, 8080);
        assert_eq!(tunnel.status, "active");
    }

    #[test]
    fn test_ngrok_tunnel_serialization() {
        let tunnel = NgrokTunnel {
            url: "https://test.ngrok.io".to_string(),
            port: 3000,
            status: "running".to_string(),
        };

        // Test serialization
        let json = serde_json::to_string(&tunnel).unwrap();
        assert!(json.contains("\"url\":\"https://test.ngrok.io\""));
        assert!(json.contains("\"port\":3000"));
        assert!(json.contains("\"status\":\"running\""));

        // Test deserialization
        let deserialized: NgrokTunnel = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.url, tunnel.url);
        assert_eq!(deserialized.port, tunnel.port);
        assert_eq!(deserialized.status, tunnel.status);
    }

    #[test]
    fn test_ngrok_manager_creation() {
        let manager = NgrokManager::new();

        // Verify initial state
        assert!(manager.process.lock().unwrap().is_none());
        assert!(manager.tunnel_info.lock().unwrap().is_none());
    }

    #[test]
    fn test_get_tunnel_status_when_none() {
        let manager = NgrokManager::new();

        // Should return None when no tunnel is active
        assert!(manager.get_tunnel_status().is_none());
    }

    #[test]
    fn test_get_tunnel_status_when_active() {
        let manager = NgrokManager::new();

        // Set up a mock tunnel
        let tunnel = NgrokTunnel {
            url: "https://mock.ngrok.io".to_string(),
            port: 4000,
            status: "active".to_string(),
        };

        *manager.tunnel_info.lock().unwrap() = Some(tunnel.clone());

        // Should return the tunnel info
        let status = manager.get_tunnel_status();
        assert!(status.is_some());

        let returned_tunnel = status.unwrap();
        assert_eq!(returned_tunnel.url, tunnel.url);
        assert_eq!(returned_tunnel.port, tunnel.port);
        assert_eq!(returned_tunnel.status, tunnel.status);
    }

    #[test]
    fn test_parse_tunnel_info() {
        // Test parsing tunnel address
        let addr = "http://localhost:3000";
        let port = addr
            .split(':')
            .last()
            .and_then(|p| p.parse::<u16>().ok())
            .unwrap_or(3000);
        assert_eq!(port, 3000);

        // Test with different formats
        let addr = "127.0.0.1:8080";
        let port = addr
            .split(':')
            .last()
            .and_then(|p| p.parse::<u16>().ok())
            .unwrap_or(3000);
        assert_eq!(port, 8080);

        // Test invalid format
        let addr = "invalid-address";
        let port = addr
            .split(':')
            .last()
            .and_then(|p| p.parse::<u16>().ok())
            .unwrap_or(3000);
        assert_eq!(port, 3000); // Should use default
    }

    #[test]
    fn test_tunnel_info_extraction_from_json() {
        // Simulate ngrok API response
        let json_response = r#"{
            "tunnels": [
                {
                    "name": "http",
                    "proto": "http",
                    "public_url": "http://abc123.ngrok.io",
                    "config": {
                        "addr": "http://localhost:8080"
                    }
                },
                {
                    "name": "https",
                    "proto": "https",
                    "public_url": "https://abc123.ngrok.io",
                    "config": {
                        "addr": "http://localhost:8080"
                    }
                }
            ]
        }"#;

        let data: serde_json::Value = serde_json::from_str(json_response).unwrap();
        let tunnels = data["tunnels"].as_array().unwrap();

        // Should prefer HTTPS tunnel
        let tunnel = tunnels
            .iter()
            .find(|t| t["proto"].as_str() == Some("https"))
            .or_else(|| tunnels.first())
            .unwrap();

        assert_eq!(tunnel["proto"].as_str(), Some("https"));
        assert_eq!(
            tunnel["public_url"].as_str(),
            Some("https://abc123.ngrok.io")
        );
    }

    #[test]
    fn test_tunnel_info_extraction_no_https() {
        // Simulate ngrok API response with only HTTP
        let json_response = r#"{
            "tunnels": [
                {
                    "name": "http",
                    "proto": "http",
                    "public_url": "http://xyz789.ngrok.io",
                    "config": {
                        "addr": "http://localhost:5000"
                    }
                }
            ]
        }"#;

        let data: serde_json::Value = serde_json::from_str(json_response).unwrap();
        let tunnels = data["tunnels"].as_array().unwrap();

        // Should fall back to first tunnel if no HTTPS
        let tunnel = tunnels
            .iter()
            .find(|t| t["proto"].as_str() == Some("https"))
            .or_else(|| tunnels.first())
            .unwrap();

        assert_eq!(tunnel["proto"].as_str(), Some("http"));
        assert_eq!(
            tunnel["public_url"].as_str(),
            Some("http://xyz789.ngrok.io")
        );
    }

    #[test]
    fn test_clone_trait() {
        let tunnel1 = NgrokTunnel {
            url: "https://test.ngrok.io".to_string(),
            port: 3000,
            status: "active".to_string(),
        };

        let tunnel2 = tunnel1.clone();

        assert_eq!(tunnel1.url, tunnel2.url);
        assert_eq!(tunnel1.port, tunnel2.port);
        assert_eq!(tunnel1.status, tunnel2.status);
    }

    #[test]
    fn test_thread_safety() {
        use std::thread;

        let manager = Arc::new(NgrokManager::new());
        let manager_clone = manager.clone();

        // Test concurrent access
        let handle = thread::spawn(move || {
            let tunnel = NgrokTunnel {
                url: "https://thread1.ngrok.io".to_string(),
                port: 8080,
                status: "active".to_string(),
            };
            *manager_clone.tunnel_info.lock().unwrap() = Some(tunnel);
        });

        handle.join().unwrap();

        // Verify the tunnel was set
        let status = manager.get_tunnel_status();
        assert!(status.is_some());
        assert_eq!(status.unwrap().url, "https://thread1.ngrok.io");
    }

    #[tokio::test]
    async fn test_stop_tunnel_when_none() {
        let manager = NgrokManager::new();

        // Should succeed even when no tunnel is running
        let result = manager.stop_tunnel().await;
        assert!(result.is_ok());

        // Tunnel info should remain None
        assert!(manager.tunnel_info.lock().unwrap().is_none());
    }

    #[test]
    fn test_port_parsing_edge_cases() {
        // Test various address formats
        let test_cases = vec![
            ("http://localhost:8080", 8080),
            ("https://0.0.0.0:3000", 3000),
            ("127.0.0.1:5000", 5000),
            ("localhost:65535", 65535),
            ("invalid", 3000),                       // Default
            ("http://localhost", 3000),              // No port, use default
            ("http://localhost:not-a-number", 3000), // Invalid port
        ];

        for (addr, expected_port) in test_cases {
            let port = addr
                .split(':')
                .last()
                .and_then(|p| p.parse::<u16>().ok())
                .unwrap_or(3000);
            assert_eq!(port, expected_port, "Failed for address: {}", addr);
        }
    }

    #[test]
    fn test_debug_trait() {
        let tunnel = NgrokTunnel {
            url: "https://debug.ngrok.io".to_string(),
            port: 9000,
            status: "debugging".to_string(),
        };

        let debug_str = format!("{:?}", tunnel);
        assert!(debug_str.contains("NgrokTunnel"));
        assert!(debug_str.contains("url"));
        assert!(debug_str.contains("port"));
        assert!(debug_str.contains("status"));
    }
}
