use axum::{
    Router,
    routing::{get, post, delete},
    response::IntoResponse,
    extract::{ws::WebSocketUpgrade, Path, State as AxumState, Query},
    http::StatusCode,
    Json,
    middleware,
};
use axum::extract::ws::{WebSocket, Message};
use axum::response::sse::{Event, KeepAlive, Sse};
use futures::stream::{Stream, StreamExt as FuturesStreamExt};
use std::convert::Infallible;
use tokio::time::{interval, Duration};
use tower_http::cors::{CorsLayer, Any};
use std::sync::Arc;
use tokio::net::TcpListener;
use futures::sink::SinkExt;
use serde::{Deserialize, Serialize};
use tracing::{info, error, debug};
use std::path::PathBuf;
use std::fs;

use crate::terminal::TerminalManager;
use crate::auth::{AuthConfig, auth_middleware, check_auth, login};
use crate::session_monitor::SessionMonitor;

// Combined app state for Axum
#[derive(Clone)]
struct AppState {
    terminal_manager: Arc<TerminalManager>,
    auth_config: Arc<AuthConfig>,
    session_monitor: Arc<SessionMonitor>,
}

pub struct HttpServer {
    terminal_manager: Arc<TerminalManager>,
    auth_config: Arc<AuthConfig>,
    session_monitor: Arc<SessionMonitor>,
    port: u16,
    shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
    handle: Option<tokio::task::JoinHandle<()>>,
}

#[derive(Debug, Serialize, Deserialize)]
struct SessionInfo {
    id: String,
    name: String,
    status: String,
    created_at: String,
}

#[derive(Debug, Deserialize)]
struct CreateSessionRequest {
    name: Option<String>,
    rows: Option<u16>,
    cols: Option<u16>,
    cwd: Option<String>,
}

#[derive(Debug, Serialize)]
struct FileInfo {
    name: String,
    created: String,
    #[serde(rename = "lastModified")]
    last_modified: String,
    size: u64,
    #[serde(rename = "isDir")]
    is_dir: bool,
}

#[derive(Debug, Serialize)]
struct DirectoryListing {
    #[serde(rename = "absolutePath")]
    absolute_path: String,
    files: Vec<FileInfo>,
}

#[derive(Debug, Deserialize)]
struct BrowseQuery {
    path: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CreateDirRequest {
    path: String,
    name: String,
}

#[derive(Debug, Serialize)]
struct CleanupResponse {
    success: bool,
    message: String,
    #[serde(rename = "cleanedSessions")]
    cleaned_sessions: Vec<String>,
}

impl HttpServer {
    pub fn port(&self) -> u16 {
        self.port
    }
    
    pub fn new(terminal_manager: Arc<TerminalManager>, session_monitor: Arc<SessionMonitor>) -> Self {
        Self {
            terminal_manager,
            auth_config: Arc::new(AuthConfig::new(false, None)),
            session_monitor,
            port: 0,
            shutdown_tx: None,
            handle: None,
        }
    }
    
    pub fn with_auth(terminal_manager: Arc<TerminalManager>, session_monitor: Arc<SessionMonitor>, auth_config: AuthConfig) -> Self {
        Self {
            terminal_manager,
            auth_config: Arc::new(auth_config),
            session_monitor,
            port: 0,
            shutdown_tx: None,
            handle: None,
        }
    }

    pub async fn start(&mut self) -> Result<u16, String> {
        self.start_with_mode("localhost").await
    }
    
    pub async fn start_with_mode(&mut self, mode: &str) -> Result<u16, String> {
        // Determine bind address based on mode
        let bind_addr = match mode {
            "localhost" => "127.0.0.1:0",
            "network" => "0.0.0.0:0",  // Bind to all interfaces
            _ => "127.0.0.1:0",
        };
        
        // Find available port
        let listener = TcpListener::bind(bind_addr)
            .await
            .map_err(|e| format!("Failed to bind to {}: {}", bind_addr, e))?;
            
        let addr = listener.local_addr()
            .map_err(|e| format!("Failed to get local address: {}", e))?;
            
        self.port = addr.port();
        
        info!("Starting HTTP server on port {}", self.port);
        
        // Create shutdown channel
        let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel();
        self.shutdown_tx = Some(shutdown_tx);
        
        // Build router
        let app = self.build_router();
        
        // Start server
        let handle = tokio::spawn(async move {
            let server = axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    let _ = shutdown_rx.await;
                    info!("Graceful shutdown initiated");
                });
                
            if let Err(e) = server.await {
                error!("Server error: {}", e);
            }
            
            info!("Server task completed");
        });
        
        self.handle = Some(handle);
        
        Ok(self.port)
    }
    
    pub async fn stop(&mut self) -> Result<(), String> {
        info!("Stopping HTTP server...");
        
        // Send shutdown signal
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
        
        // Wait for server task to complete
        if let Some(handle) = self.handle.take() {
            match tokio::time::timeout(
                tokio::time::Duration::from_secs(10),
                handle
            ).await {
                Ok(Ok(())) => {
                    info!("HTTP server stopped gracefully");
                }
                Ok(Err(e)) => {
                    error!("Server task join error: {}", e);
                    return Err("Server task failed".to_string());
                }
                Err(_) => {
                    error!("Server shutdown timeout");
                    return Err("Server shutdown timeout".to_string());
                }
            }
        }
        
        Ok(())
    }
    
    fn build_router(&self) -> Router {
        let app_state = AppState {
            terminal_manager: self.terminal_manager.clone(),
            auth_config: self.auth_config.clone(),
            session_monitor: self.session_monitor.clone(),
        };
        
        // Don't serve static files in Tauri - the frontend is served by Tauri itself
        // This server is only for the terminal API
        
        // Create auth routes that use auth config
        let auth_routes = Router::new()
            .route("/api/auth/check", get(check_auth))
            .route("/api/auth/login", post(login))
            .with_state(app_state.auth_config.clone());
            
        // Create protected routes that use full app state
        let protected_routes = Router::new()
            .route("/api/sessions", get(list_sessions).post(create_session))
            .route("/api/sessions/:id", delete(delete_session))
            .route("/api/sessions/:id", get(get_session))
            .route("/api/sessions/:id/resize", post(resize_session))
            .route("/api/sessions/:id/input", post(send_input))
            .route("/api/sessions/:id/stream", get(terminal_stream))
            .route("/api/sessions/:id/snapshot", get(get_snapshot))
            .route("/api/sessions/events", get(session_events_stream))
            .route("/api/ws/:id", get(terminal_websocket))
            .route("/api/fs/browse", get(browse_directory))
            .route("/api/fs/info", get(crate::fs_api::get_file_info))
            .route("/api/fs/read", get(crate::fs_api::read_file))
            .route("/api/fs/write", post(crate::fs_api::write_file))
            .route("/api/fs/delete", delete(crate::fs_api::delete_file))
            .route("/api/fs/move", post(crate::fs_api::move_file))
            .route("/api/fs/copy", post(crate::fs_api::copy_file))
            .route("/api/fs/search", get(crate::fs_api::search_files))
            .route("/api/mkdir", post(create_directory))
            .route("/api/cleanup-exited", post(cleanup_exited))
            .layer(middleware::from_fn_with_state(
                app_state.auth_config.clone(),
                auth_middleware
            ))
            .with_state(app_state);
            
        Router::new()
            .merge(auth_routes)
            .merge(protected_routes)
            .layer(CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any))
    }
}

// API handlers
async fn list_sessions(
    AxumState(state): AxumState<AppState>,
) -> Result<Json<Vec<SessionInfo>>, StatusCode> {
    let sessions = state.terminal_manager.list_sessions().await;
    
    let session_infos: Vec<SessionInfo> = sessions.into_iter().map(|s| SessionInfo {
        id: s.id,
        name: s.name,
        status: "running".to_string(),
        created_at: s.created_at,
    }).collect();
    
    Ok(Json(session_infos))
}

async fn create_session(
    AxumState(state): AxumState<AppState>,
    Json(req): Json<CreateSessionRequest>,
) -> Result<Json<SessionInfo>, StatusCode> {
    let session = state.terminal_manager.create_session(
        req.name.unwrap_or_else(|| "Terminal".to_string()),
        req.rows.unwrap_or(24),
        req.cols.unwrap_or(80),
        req.cwd,
        None,
        None,
    ).await.map_err(|e| {
        error!("Failed to create session: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    
    Ok(Json(SessionInfo {
        id: session.id,
        name: session.name,
        status: "running".to_string(),
        created_at: session.created_at,
    }))
}

async fn get_session(
    Path(id): Path<String>,
    AxumState(state): AxumState<AppState>,
) -> Result<Json<SessionInfo>, StatusCode> {
    let sessions = state.terminal_manager.list_sessions().await;
    
    sessions.into_iter()
        .find(|s| s.id == id)
        .map(|s| Json(SessionInfo {
            id: s.id,
            name: s.name,
            status: "running".to_string(),
            created_at: s.created_at,
        }))
        .ok_or(StatusCode::NOT_FOUND)
}

async fn delete_session(
    Path(id): Path<String>,
    AxumState(state): AxumState<AppState>,
) -> Result<StatusCode, StatusCode> {
    state.terminal_manager.close_session(&id).await
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(|_| StatusCode::NOT_FOUND)
}

#[derive(Deserialize)]
struct ResizeRequest {
    rows: u16,
    cols: u16,
}

async fn resize_session(
    Path(id): Path<String>,
    AxumState(state): AxumState<AppState>,
    Json(req): Json<ResizeRequest>,
) -> Result<StatusCode, StatusCode> {
    state.terminal_manager.resize_session(&id, req.rows, req.cols).await
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(|_| StatusCode::NOT_FOUND)
}

async fn terminal_websocket(
    Path(id): Path<String>,
    ws: WebSocketUpgrade,
    AxumState(state): AxumState<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_terminal_websocket(socket, id, state.terminal_manager))
}

async fn handle_terminal_websocket(
    socket: WebSocket,
    session_id: String,
    terminal_manager: Arc<TerminalManager>,
) {
    let (mut sender, mut receiver) = socket.split();
    
    // Get the terminal session
    let _session = match terminal_manager.get_session(&session_id).await {
        Some(s) => s,
        None => {
            let _ = sender.send(Message::Text("Session not found".to_string())).await;
            return;
        }
    };
    
    // Spawn task to read from terminal and send to WebSocket
    let session_id_clone = session_id.clone();
    let terminal_manager_clone = terminal_manager.clone();
    let read_task = tokio::spawn(async move {
        loop {
            match terminal_manager_clone.read_from_session(&session_id_clone).await {
                Ok(data) if !data.is_empty() => {
                    if sender.send(Message::Binary(data)).await.is_err() {
                        break;
                    }
                }
                Ok(_) => {
                    // No data, wait a bit
                    tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
                }
                Err(e) => {
                    error!("Error reading from terminal: {}", e);
                    break;
                }
            }
        }
    });
    
    // Handle incoming WebSocket messages
    while let Some(msg) = receiver.next().await {
        match msg {
            Ok(Message::Binary(data)) => {
                if let Err(e) = terminal_manager.write_to_session(&session_id, &data).await {
                    error!("Error writing to terminal: {}", e);
                    break;
                }
            }
            Ok(Message::Text(text)) => {
                // Handle text messages (e.g., resize commands)
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                    if json["type"] == "resize" {
                        if let (Some(rows), Some(cols)) = (
                            json["rows"].as_u64(),
                            json["cols"].as_u64()
                        ) {
                            let _ = terminal_manager.resize_session(
                                &session_id,
                                rows as u16,
                                cols as u16
                            ).await;
                        }
                    }
                }
            }
            Ok(Message::Close(_)) => break,
            Err(e) => {
                error!("WebSocket error: {}", e);
                break;
            }
            _ => {}
        }
    }
    
    // Cancel the read task
    read_task.abort();
    
    debug!("WebSocket connection closed for session {}", session_id);
}

#[derive(Deserialize)]
struct InputRequest {
    input: String,
}

async fn send_input(
    Path(id): Path<String>,
    AxumState(state): AxumState<AppState>,
    Json(req): Json<InputRequest>,
) -> Result<StatusCode, StatusCode> {
    state.terminal_manager.write_to_session(&id, req.input.as_bytes()).await
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(|_| StatusCode::NOT_FOUND)
}

async fn terminal_stream(
    Path(id): Path<String>,
    AxumState(state): AxumState<AppState>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, StatusCode> {
    // Check if session exists
    let sessions = state.terminal_manager.list_sessions().await;
    let session = sessions.into_iter()
        .find(|s| s.id == id)
        .ok_or(StatusCode::NOT_FOUND)?;
    
    // Create the SSE stream
    let session_id = id.clone();
    let terminal_manager = state.terminal_manager.clone();
    
    let stream = async_stream::stream! {
        // Send initial header
        let header = serde_json::json!({
            "version": 2,
            "width": session.cols,
            "height": session.rows
        });
        
        yield Ok(Event::default()
            .event("header")
            .data(header.to_string()));
        
        // Poll for terminal output
        let mut poll_interval = interval(Duration::from_millis(10));
        let exit_sent = false;
        
        loop {
            poll_interval.tick().await;
            
            // Check if session still exists
            let sessions = terminal_manager.list_sessions().await;
            if !sessions.iter().any(|s| s.id == session_id) && !exit_sent {
                // Session closed - send exit event
                let exit_event = format!("[\"exit\", 0, \"{}\"]", session_id);
                yield Ok(Event::default()
                    .event("data")
                    .data(exit_event));
                let _ = exit_sent; // Prevent duplicate exit events
                break;
            }
            
            // Read any available output
            match terminal_manager.read_from_session(&session_id).await {
                Ok(data) if !data.is_empty() => {
                    // Convert to cast format: [timestamp, "o", data]
                    let timestamp = chrono::Utc::now().timestamp();
                    let output = String::from_utf8_lossy(&data);
                    let event_data = serde_json::json!([timestamp, "o", output]);
                    
                    yield Ok(Event::default()
                        .event("data")
                        .data(event_data.to_string()));
                }
                Ok(_) => {
                    // No data available
                }
                Err(_) => {
                    // Session might have been closed
                    if !exit_sent {
                        let exit_event = format!("[\"exit\", 0, \"{}\"]", session_id);
                        yield Ok(Event::default()
                            .event("data")
                            .data(exit_event));
                    }
                    break;
                }
            }
        }
    };
    
    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}

// Session monitoring SSE endpoint
async fn session_events_stream(
    AxumState(state): AxumState<AppState>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, StatusCode> {
    // Clone the session monitor Arc to avoid lifetime issues
    let session_monitor = state.session_monitor.clone();
    
    // Start monitoring if not already started
    session_monitor.start_monitoring().await;
    
    // Create SSE stream from session monitor
    let stream = session_monitor.create_sse_stream()
        .map(|data| {
            data.map(|json| Event::default().data(json))
                .map_err(|_| unreachable!())
        });
    
    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}

// File system endpoints
async fn browse_directory(
    Query(params): Query<BrowseQuery>,
) -> Result<Json<DirectoryListing>, StatusCode> {
    let path_str = params.path.unwrap_or_else(|| "~".to_string());
    
    // Expand tilde to home directory
    let path = if path_str.starts_with('~') {
        let home = dirs::home_dir()
            .ok_or_else(|| StatusCode::INTERNAL_SERVER_ERROR)?;
        home.join(path_str.strip_prefix("~/").unwrap_or(""))
    } else {
        PathBuf::from(&path_str)
    };
    
    // Check if path exists and is a directory
    if !path.exists() {
        return Err(StatusCode::NOT_FOUND);
    }
    
    if !path.is_dir() {
        return Err(StatusCode::BAD_REQUEST);
    }
    
    // Read directory entries
    let mut files = Vec::new();
    let entries = fs::read_dir(&path)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
    for entry in entries {
        let entry = entry.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let metadata = entry.metadata()
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        
        let created = metadata.created()
            .map(|t| {
                let datetime: chrono::DateTime<chrono::Utc> = t.into();
                datetime.to_rfc3339()
            })
            .unwrap_or_else(|_| String::new());
            
        let modified = metadata.modified()
            .map(|t| {
                let datetime: chrono::DateTime<chrono::Utc> = t.into();
                datetime.to_rfc3339()
            })
            .unwrap_or_else(|_| String::new());
        
        files.push(FileInfo {
            name: entry.file_name().to_string_lossy().to_string(),
            created,
            last_modified: modified,
            size: metadata.len(),
            is_dir: metadata.is_dir(),
        });
    }
    
    // Sort directories first, then files, alphabetically
    files.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.cmp(&b.name),
        }
    });
    
    Ok(Json(DirectoryListing {
        absolute_path: path.to_string_lossy().to_string(),
        files,
    }))
}

async fn create_directory(
    Json(req): Json<CreateDirRequest>,
) -> Result<StatusCode, StatusCode> {
    // Validate directory name
    if req.name.is_empty() || 
       req.name.contains('/') || 
       req.name.contains('\\') || 
       req.name.starts_with('.') {
        return Err(StatusCode::BAD_REQUEST);
    }
    
    // Expand path
    let base_path = if req.path.starts_with('~') {
        let home = dirs::home_dir()
            .ok_or_else(|| StatusCode::INTERNAL_SERVER_ERROR)?;
        home.join(req.path.strip_prefix("~/").unwrap_or(""))
    } else {
        PathBuf::from(&req.path)
    };
    
    // Create full path
    let full_path = base_path.join(&req.name);
    
    // Check if directory already exists
    if full_path.exists() {
        return Err(StatusCode::CONFLICT);
    }
    
    // Create directory
    fs::create_dir(&full_path)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
    Ok(StatusCode::CREATED)
}

async fn cleanup_exited(
    AxumState(state): AxumState<AppState>,
) -> Result<Json<CleanupResponse>, StatusCode> {
    // Get list of all sessions
    let sessions = state.terminal_manager.list_sessions().await;
    let mut cleaned_sessions = Vec::new();
    
    // Check each session and close if the process has exited
    for session in sessions {
        // Try to write empty data to check if session is alive
        if state.terminal_manager.write_to_session(&session.id, &[]).await.is_err() {
            // Session is dead, clean it up
            if state.terminal_manager.close_session(&session.id).await.is_ok() {
                cleaned_sessions.push(session.id);
            }
        }
    }
    
    let count = cleaned_sessions.len();
    
    Ok(Json(CleanupResponse {
        success: true,
        message: format!("{} exited sessions cleaned up", count),
        cleaned_sessions,
    }))
}

async fn get_snapshot(
    Path(id): Path<String>,
    AxumState(state): AxumState<AppState>,
) -> Result<String, StatusCode> {
    // Check if session exists
    let sessions = state.terminal_manager.list_sessions().await;
    let session = sessions.into_iter()
        .find(|s| s.id == id)
        .ok_or(StatusCode::NOT_FOUND)?;
    
    // For Tauri, we don't have access to the stream-out file like the Node.js version
    // Instead, we'll return a minimal snapshot with just the header
    // The frontend can use the regular stream endpoint for actual content
    
    let cast_data = serde_json::json!({
        "version": 2,
        "width": session.cols,
        "height": session.rows,
        "timestamp": chrono::Utc::now().timestamp(),
        "theme": {
            "fg": "#d4d4d4",
            "bg": "#1e1e1e",
            "palette": [
                "#000000", "#cd3131", "#0dbc79", "#e5e510",
                "#2472c8", "#bc3fbc", "#11a8cd", "#e5e5e5",
                "#666666", "#f14c4c", "#23d18b", "#f5f543",
                "#3b8eea", "#d670d6", "#29b8db", "#e5e5e5"
            ]
        }
    });
    
    // Return as a single line JSON (asciicast v2 format)
    Ok(cast_data.to_string())
}