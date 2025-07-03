use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TailscaleStatus {
    pub is_installed: bool,
    pub is_running: bool,
    pub hostname: Option<String>,
    pub ip_address: Option<String>,
    pub status_error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct TailscaleAPIResponse {
    status: String,
    device_name: String,
    tailnet_name: String,
    #[serde(rename = "IPv4")]
    ipv4: Option<String>,
}

pub struct TailscaleService {
    status: Arc<RwLock<TailscaleStatus>>,
}

impl TailscaleService {
    const TAILSCALE_API_ENDPOINT: &'static str = "http://100.100.100.100/api/data";
    const API_TIMEOUT: Duration = Duration::from_secs(5);

    pub fn new() -> Self {
        Self {
            status: Arc::new(RwLock::new(TailscaleStatus {
                is_installed: false,
                is_running: false,
                hostname: None,
                ip_address: None,
                status_error: None,
            })),
        }
    }

    /// Get the current Tailscale status
    pub async fn get_status(&self) -> TailscaleStatus {
        self.status.read().await.clone()
    }

    /// Check if Tailscale app is installed
    fn check_app_installation() -> bool {
        #[cfg(target_os = "macos")]
        {
            std::path::Path::new("/Applications/Tailscale.app").exists()
        }
        #[cfg(target_os = "linux")]
        {
            // Check common Linux installation paths
            std::path::Path::new("/usr/bin/tailscale").exists()
                || std::path::Path::new("/usr/local/bin/tailscale").exists()
                || std::path::Path::new("/opt/tailscale/tailscale").exists()
        }
        #[cfg(target_os = "windows")]
        {
            // Check Windows installation
            std::path::Path::new("C:\\Program Files\\Tailscale\\tailscale.exe").exists()
                || std::path::Path::new("C:\\Program Files (x86)\\Tailscale\\tailscale.exe").exists()
        }
    }

    /// Fetch Tailscale status from the API
    async fn fetch_tailscale_status() -> Option<TailscaleAPIResponse> {
        let client = reqwest::Client::builder()
            .timeout(Self::API_TIMEOUT)
            .build()
            .ok()?;

        match client.get(Self::TAILSCALE_API_ENDPOINT).send().await {
            Ok(response) if response.status().is_success() => {
                response.json::<TailscaleAPIResponse>().await.ok()
            }
            _ => None,
        }
    }

    /// Check the current Tailscale status and update properties
    pub async fn check_tailscale_status(&self) -> TailscaleStatus {
        let is_installed = Self::check_app_installation();
        
        if !is_installed {
            let status = TailscaleStatus {
                is_installed: false,
                is_running: false,
                hostname: None,
                ip_address: None,
                status_error: Some("Tailscale is not installed".to_string()),
            };
            *self.status.write().await = status.clone();
            return status;
        }

        // Try to fetch status from API
        match Self::fetch_tailscale_status().await {
            Some(api_response) => {
                let is_running = api_response.status.to_lowercase() == "running";
                
                let (hostname, ip_address, status_error) = if is_running {
                    // Extract hostname from device name and tailnet name
                    let device_name = api_response.device_name
                        .to_lowercase()
                        .replace(' ', "-");
                    let tailnet_name = api_response.tailnet_name
                        .replace(".ts.net", "")
                        .replace(".tailscale.net", "");
                    
                    let hostname = format!("{}.{}.ts.net", device_name, tailnet_name);
                    
                    (Some(hostname), api_response.ipv4, None)
                } else {
                    (None, None, Some("Tailscale is not running".to_string()))
                };

                let status = TailscaleStatus {
                    is_installed,
                    is_running,
                    hostname,
                    ip_address,
                    status_error,
                };
                *self.status.write().await = status.clone();
                status
            }
            None => {
                // API not responding - Tailscale not running
                let status = TailscaleStatus {
                    is_installed,
                    is_running: false,
                    hostname: None,
                    ip_address: None,
                    status_error: Some("Please start the Tailscale app".to_string()),
                };
                *self.status.write().await = status.clone();
                status
            }
        }
    }

    /// Start monitoring Tailscale status
    pub async fn start_monitoring(&self) {
        let status = self.status.clone();
        let service = Self::new();
        
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(30));
            loop {
                interval.tick().await;
                let new_status = service.check_tailscale_status().await;
                *status.write().await = new_status;
            }
        });
    }

    /// Open the Tailscale app
    pub fn open_tailscale_app() -> Result<(), String> {
        #[cfg(target_os = "macos")]
        {
            open::that("/Applications/Tailscale.app")
                .map_err(|e| format!("Failed to open Tailscale app: {}", e))
        }
        #[cfg(target_os = "linux")]
        {
            // Try to launch via desktop file or command
            std::process::Command::new("tailscale")
                .arg("up")
                .spawn()
                .map_err(|e| format!("Failed to start Tailscale: {}", e))?;
            Ok(())
        }
        #[cfg(target_os = "windows")]
        {
            open::that("C:\\Program Files\\Tailscale\\tailscale.exe")
                .or_else(|_| open::that("C:\\Program Files (x86)\\Tailscale\\tailscale.exe"))
                .map_err(|e| format!("Failed to open Tailscale app: {}", e))
        }
    }

    /// Open the Tailscale download page
    pub fn open_download_page() -> Result<(), String> {
        let url = if cfg!(target_os = "macos") {
            "https://tailscale.com/download/macos"
        } else if cfg!(target_os = "windows") {
            "https://tailscale.com/download/windows"
        } else {
            "https://tailscale.com/download/linux"
        };
        
        open::that(url).map_err(|e| format!("Failed to open download page: {}", e))
    }

    /// Open the Tailscale setup guide
    pub fn open_setup_guide() -> Result<(), String> {
        open::that("https://tailscale.com/kb/1017/install/")
            .map_err(|e| format!("Failed to open setup guide: {}", e))
    }
}