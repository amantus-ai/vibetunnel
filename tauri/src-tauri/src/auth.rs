use axum::{
    body::Body,
    http::{Request, StatusCode},
    middleware::Next,
    response::Response,
    Json,
};
use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Clone)]
pub struct AuthConfig {
    pub enabled: bool,
    pub password: Option<String>,
}

impl AuthConfig {
    pub fn new(enabled: bool, password: Option<String>) -> Self {
        Self { enabled, password }
    }
}

#[derive(Serialize, Deserialize)]
pub struct LoginRequest {
    pub password: String,
}

#[derive(Serialize, Deserialize)]
pub struct LoginResponse {
    pub success: bool,
    pub message: String,
}

pub async fn auth_middleware(
    auth_config: axum::extract::State<Arc<AuthConfig>>,
    request: Request<Body>,
    next: Next,
) -> Result<Response, StatusCode> {
    if !auth_config.enabled {
        return Ok(next.run(request).await);
    }

    // Skip auth for login endpoint
    if request.uri().path() == "/api/auth/login" {
        return Ok(next.run(request).await);
    }

    // Check Authorization header
    if let Some(auth_header) = request.headers().get("authorization") {
        if let Ok(auth_str) = auth_header.to_str() {
            if let Some(encoded) = auth_str.strip_prefix("Basic ") {
                if let Ok(decoded) = general_purpose::STANDARD.decode(encoded) {
                    if let Ok(credentials) = String::from_utf8(decoded) {
                        let parts: Vec<&str> = credentials.splitn(2, ':').collect();
                        if parts.len() == 2 {
                            if let Some(ref password) = auth_config.password {
                                if parts[1] == password {
                                    return Ok(next.run(request).await);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Err(StatusCode::UNAUTHORIZED)
}

pub async fn check_auth(
    axum::extract::State(auth_config): axum::extract::State<Arc<AuthConfig>>,
) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "authenticated": !auth_config.enabled,
        "requiresAuth": auth_config.enabled
    }))
}

pub async fn login(
    axum::extract::State(auth_config): axum::extract::State<Arc<AuthConfig>>,
    Json(req): Json<LoginRequest>,
) -> Result<Json<LoginResponse>, StatusCode> {
    if !auth_config.enabled {
        return Ok(Json(LoginResponse {
            success: true,
            message: "Authentication not required".to_string(),
        }));
    }

    if let Some(ref password) = auth_config.password {
        if req.password == *password {
            Ok(Json(LoginResponse {
                success: true,
                message: "Login successful".to_string(),
            }))
        } else {
            Ok(Json(LoginResponse {
                success: false,
                message: "Invalid password".to_string(),
            }))
        }
    } else {
        Ok(Json(LoginResponse {
            success: false,
            message: "No password configured".to_string(),
        }))
    }
}
