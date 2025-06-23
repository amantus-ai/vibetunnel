use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct ApiClient {
    client: Client,
    base_url: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateSessionRequest {
    pub name: Option<String>,
    pub rows: Option<u16>,
    pub cols: Option<u16>,
    pub cwd: Option<String>,
    pub env: Option<HashMap<String, String>>,
    pub shell: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SessionResponse {
    pub id: String,
    pub name: String,
    pub pid: u32,
    pub rows: u16,
    pub cols: u16,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct InputRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ResizeRequest {
    pub cols: u16,
    pub rows: u16,
}

impl ApiClient {
    pub fn new(port: u16) -> Self {
        Self {
            client: Client::new(),
            base_url: format!("http://127.0.0.1:{port}"),
        }
    }

    pub async fn create_session(
        &self,
        req: CreateSessionRequest,
    ) -> Result<SessionResponse, String> {
        let url = format!("{}/api/sessions", self.base_url);

        let response = self
            .client
            .post(&url)
            .json(&req)
            .send()
            .await
            .map_err(|e| format!("Failed to create session: {e}"))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("Server returned error {status}: {error_text}"));
        }

        response
            .json::<SessionResponse>()
            .await
            .map_err(|e| format!("Failed to parse response: {e}"))
    }

    pub async fn list_sessions(&self) -> Result<Vec<SessionResponse>, String> {
        let url = format!("{}/api/sessions", self.base_url);

        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Failed to list sessions: {e}"))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("Server returned error {status}: {error_text}"));
        }

        response
            .json::<Vec<SessionResponse>>()
            .await
            .map_err(|e| format!("Failed to parse response: {e}"))
    }

    pub async fn close_session(&self, id: &str) -> Result<(), String> {
        let url = format!("{}/api/sessions/{}", self.base_url, id);

        let response = self
            .client
            .delete(&url)
            .send()
            .await
            .map_err(|e| format!("Failed to close session: {e}"))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("Server returned error {status}: {error_text}"));
        }

        Ok(())
    }

    pub async fn send_input(&self, id: &str, input: &[u8]) -> Result<(), String> {
        let url = format!("{}/api/sessions/{}/input", self.base_url, id);

        // Convert bytes to string
        let text = String::from_utf8_lossy(input).into_owned();
        let req = InputRequest {
            text: Some(text),
            key: None,
        };

        let response = self
            .client
            .post(&url)
            .json(&req)
            .send()
            .await
            .map_err(|e| format!("Failed to send input: {e}"))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("Server returned error {status}: {error_text}"));
        }

        Ok(())
    }

    pub async fn resize_session(&self, id: &str, rows: u16, cols: u16) -> Result<(), String> {
        let url = format!("{}/api/sessions/{}/resize", self.base_url, id);

        let req = ResizeRequest { cols, rows };

        let response = self
            .client
            .post(&url)
            .json(&req)
            .send()
            .await
            .map_err(|e| format!("Failed to resize session: {e}"))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("Server returned error {status}: {error_text}"));
        }

        Ok(())
    }

    pub async fn get_session_output(&self, id: &str) -> Result<Vec<u8>, String> {
        let url = format!("{}/api/sessions/{}/buffer", self.base_url, id);

        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Failed to get session output: {e}"))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("Server returned error {status}: {error_text}"));
        }

        response
            .bytes()
            .await
            .map(|b| b.to_vec())
            .map_err(|e| format!("Failed to read response: {e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mockito::Server;
    use serde_json::json;

    #[tokio::test]
    async fn test_api_client_new() {
        let client = ApiClient::new(8080);
        assert_eq!(client.base_url, "http://127.0.0.1:8080");
    }

    #[tokio::test]
    async fn test_create_session_success() {
        let mut server = Server::new_async().await;
        let _m = server.mock("POST", "/api/sessions")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!({
                    "id": "test-session-123",
                    "name": "Test Session",
                    "pid": 1234,
                    "rows": 24,
                    "cols": 80,
                    "created_at": "2025-01-01T00:00:00Z"
                })
                .to_string(),
            )
            .create_async()
            .await;

        let client = ApiClient {
            client: Client::new(),
            base_url: server.url(),
        };

        let req = CreateSessionRequest {
            name: Some("Test Session".to_string()),
            rows: Some(24),
            cols: Some(80),
            cwd: None,
            env: None,
            shell: None,
        };

        let result = client.create_session(req).await;
        assert!(result.is_ok());

        let session = result.unwrap();
        assert_eq!(session.id, "test-session-123");
        assert_eq!(session.name, "Test Session");
        assert_eq!(session.pid, 1234);
        assert_eq!(session.rows, 24);
        assert_eq!(session.cols, 80);
    }

    #[tokio::test]
    async fn test_create_session_server_error() {
        let mut server = Server::new_async().await;
        let _m = server.mock("POST", "/api/sessions")
            .with_status(500)
            .with_body("Internal Server Error")
            .create_async()
            .await;

        let client = ApiClient {
            client: Client::new(),
            base_url: server.url(),
        };

        let req = CreateSessionRequest {
            name: None,
            rows: None,
            cols: None,
            cwd: None,
            env: None,
            shell: None,
        };

        let result = client.create_session(req).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Server returned error 500"));
    }

    #[tokio::test]
    async fn test_list_sessions_success() {
        let mut server = Server::new_async().await;
        let _m = server.mock("GET", "/api/sessions")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!([
                    {
                        "id": "session-1",
                        "name": "Session 1",
                        "pid": 1001,
                        "rows": 24,
                        "cols": 80,
                        "created_at": "2025-01-01T00:00:00Z"
                    },
                    {
                        "id": "session-2",
                        "name": "Session 2",
                        "pid": 1002,
                        "rows": 30,
                        "cols": 100,
                        "created_at": "2025-01-01T00:01:00Z"
                    }
                ])
                .to_string(),
            )
            .create_async()
            .await;

        let client = ApiClient {
            client: Client::new(),
            base_url: server.url(),
        };

        let result = client.list_sessions().await;
        assert!(result.is_ok());

        let sessions = result.unwrap();
        assert_eq!(sessions.len(), 2);
        assert_eq!(sessions[0].id, "session-1");
        assert_eq!(sessions[1].id, "session-2");
    }

    #[tokio::test]
    async fn test_close_session_success() {
        let mut server = Server::new_async().await;
        let _m = server.mock("DELETE", "/api/sessions/test-session")
            .with_status(200)
            .create_async()
            .await;

        let client = ApiClient {
            client: Client::new(),
            base_url: server.url(),
        };

        let result = client.close_session("test-session").await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_send_input_success() {
        let mut server = Server::new_async().await;
        let _m = server.mock("POST", "/api/sessions/test-session/input")
            .with_status(200)
            .create_async()
            .await;

        let client = ApiClient {
            client: Client::new(),
            base_url: server.url(),
        };

        let result = client.send_input("test-session", b"echo hello").await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_send_input_with_special_chars() {
        let mut server = Server::new_async().await;
        let _m = server.mock("POST", "/api/sessions/test-session/input")
            .with_status(200)
            .match_body(mockito::Matcher::PartialJson(json!({
                "text": "echo 'hello\\nworld'"
            })))
            .create_async()
            .await;

        let client = ApiClient {
            client: Client::new(),
            base_url: server.url(),
        };

        let result = client
            .send_input("test-session", b"echo 'hello\\nworld'")
            .await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_resize_session_success() {
        let mut server = Server::new_async().await;
        let _m = server.mock("POST", "/api/sessions/test-session/resize")
            .with_status(200)
            .match_body(mockito::Matcher::Json(json!({
                "cols": 120,
                "rows": 40
            })))
            .create_async()
            .await;

        let client = ApiClient {
            client: Client::new(),
            base_url: server.url(),
        };

        let result = client.resize_session("test-session", 40, 120).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_get_session_output_success() {
        let mut server = Server::new_async().await;
        let output_data = b"Hello, VibeTunnel!";
        let _m = server.mock("GET", "/api/sessions/test-session/buffer")
            .with_status(200)
            .with_body(output_data)
            .create_async()
            .await;

        let client = ApiClient {
            client: Client::new(),
            base_url: server.url(),
        };

        let result = client.get_session_output("test-session").await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), output_data);
    }

    #[tokio::test]
    async fn test_network_error_handling() {
        // Use an invalid port that will fail to connect
        let client = ApiClient::new(65535);

        let req = CreateSessionRequest {
            name: None,
            rows: None,
            cols: None,
            cwd: None,
            env: None,
            shell: None,
        };

        let result = client.create_session(req).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed to create session"));
    }
}