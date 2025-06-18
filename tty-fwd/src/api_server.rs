use anyhow::Result;
use data_encoding::BASE64;
use jiff::Timestamp;
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, SystemTime};
use uuid::Uuid;

use crate::http_server::{
    HttpRequest, HttpServer, Method, Response, SseResponseHelper, StatusCode,
};
use crate::protocol::{StreamEvent, StreamingIterator};
use crate::sessions;
use crate::tty_spawn::DEFAULT_TERM;

// Types matching the TypeScript interface
#[derive(Debug, Serialize, Deserialize)]
struct SessionInfo {
    cmdline: Vec<String>,
    cwd: String,
    exit_code: Option<i32>,
    name: String,
    pid: Option<u32>,
    started_at: String,
    status: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct SessionListEntry {
    session_info: SessionInfo,
    #[serde(rename = "stream-out")]
    stream_out: String,
    stdin: String,
    notification_stream: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct SessionResponse {
    id: String,
    command: String,
    #[serde(rename = "workingDir")]
    working_dir: String,
    status: String,
    #[serde(rename = "exitCode")]
    exit_code: Option<i32>,
    #[serde(rename = "startedAt")]
    started_at: String,
    #[serde(rename = "lastModified")]
    last_modified: String,
    pid: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct CreateSessionRequest {
    command: Vec<String>,
    #[serde(rename = "workingDir")]
    working_dir: Option<String>,
    #[serde(default = "default_term_value")]
    term: String,
    #[serde(default = "default_true")]
    spawn_terminal: bool,
}

fn default_term_value() -> String {
    DEFAULT_TERM.to_string()
}

const fn default_true() -> bool {
    true
}

#[derive(Debug, Deserialize)]
struct InputRequest {
    text: String,
}

#[derive(Debug, Deserialize)]
struct MkdirRequest {
    path: String,
}

#[derive(Debug, Deserialize)]
struct BrowseQuery {
    path: Option<String>,
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
struct BrowseResponse {
    #[serde(rename = "absolutePath")]
    absolute_path: String,
    files: Vec<FileInfo>,
}

#[derive(Debug, Serialize)]
struct ApiResponse {
    success: Option<bool>,
    message: Option<String>,
    error: Option<String>,
    #[serde(rename = "sessionId")]
    session_id: Option<String>,
}

fn check_basic_auth(req: &HttpRequest, expected_password: &str) -> bool {
    if let Some(auth_header) = req.headers().get("authorization") {
        if let Ok(auth_str) = auth_header.to_str() {
            if let Some(credentials) = auth_str.strip_prefix("Basic ") {
                if let Ok(decoded_bytes) = BASE64.decode(credentials.as_bytes()) {
                    if let Ok(decoded_str) = String::from_utf8(decoded_bytes) {
                        if let Some(colon_pos) = decoded_str.find(':') {
                            let password = &decoded_str[colon_pos + 1..];
                            return password == expected_password;
                        }
                    }
                }
            }
        }
    }
    false
}

fn unauthorized_response() -> Response<String> {
    Response::builder()
        .status(StatusCode::UNAUTHORIZED)
        .header("WWW-Authenticate", "Basic realm=\"tty-fwd\"")
        .header("Content-Type", "text/plain")
        .body("Unauthorized".to_string())
        .unwrap()
}

fn get_mime_type(file_path: &Path) -> &'static str {
    match file_path.extension().and_then(|ext| ext.to_str()) {
        Some("html" | "htm") => "text/html",
        Some("css") => "text/css",
        Some("js" | "mjs") => "application/javascript",
        Some("json") => "application/json",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("svg") => "image/svg+xml",
        Some("ico") => "image/x-icon",
        Some("pdf") => "application/pdf",
        Some("txt") => "text/plain",
        Some("xml") => "application/xml",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("ttf") => "font/ttf",
        Some("otf") => "font/otf",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("ogg") => "audio/ogg",
        _ => "application/octet-stream",
    }
}

fn serve_static_file(static_root: &Path, request_path: &str) -> Option<Response<Vec<u8>>> {
    // Security check: prevent directory traversal attacks
    if request_path.contains("../") || request_path.contains("..\\") {
        return None;
    }

    let cleaned_path = request_path.trim_start_matches('/');
    let file_path = static_root.join(cleaned_path);

    println!(
        "Static file request: '{}' -> cleaned: '{}' -> file_path: '{}'",
        request_path,
        cleaned_path,
        file_path.display()
    );

    // Security check: ensure the file path is within the static root
    if !file_path.starts_with(static_root) {
        println!("Security check failed: file_path does not start with static_root");
        return None;
    }

    if file_path.is_file() {
        // Serve the file directly
        if let Ok(content) = fs::read(&file_path) {
            let mime_type = get_mime_type(&file_path);

            Some(
                Response::builder()
                    .status(StatusCode::OK)
                    .header("Content-Type", mime_type)
                    .header("Access-Control-Allow-Origin", "*")
                    .body(content)
                    .unwrap(),
            )
        } else {
            let error_msg = b"Failed to read file".to_vec();
            Some(
                Response::builder()
                    .status(StatusCode::INTERNAL_SERVER_ERROR)
                    .header("Content-Type", "text/plain")
                    .body(error_msg)
                    .unwrap(),
            )
        }
    } else if file_path.is_dir() {
        // Try to serve index.html from the directory
        let index_path = file_path.join("index.html");
        println!("Checking for index.html at: {}", index_path.display());
        if index_path.is_file() {
            println!("Found index.html, serving it");
            if let Ok(content) = fs::read(&index_path) {
                Some(
                    Response::builder()
                        .status(StatusCode::OK)
                        .header("Content-Type", "text/html")
                        .header("Access-Control-Allow-Origin", "*")
                        .body(content)
                        .unwrap(),
                )
            } else {
                let error_msg = b"Failed to read index.html".to_vec();
                Some(
                    Response::builder()
                        .status(StatusCode::INTERNAL_SERVER_ERROR)
                        .header("Content-Type", "text/plain")
                        .body(error_msg)
                        .unwrap(),
                )
            }
        } else {
            println!("index.html not found at: {}", index_path.display());
            None // Directory doesn't have index.html
        }
    } else {
        println!(
            "Path is neither file nor directory: {}",
            file_path.display()
        );
        None // File doesn't exist
    }
}

pub fn start_server(
    bind_address: &str,
    control_path: PathBuf,
    static_path: Option<String>,
    password: Option<String>,
) -> Result<()> {
    fs::create_dir_all(&control_path)?;

    let server = HttpServer::bind(bind_address)
        .map_err(|e| anyhow::anyhow!("Failed to bind server: {}", e))?;

    // Set up auth if password is provided
    let auth_password = if let Some(ref password) = password {
        println!(
            "HTTP API server listening on {bind_address} with Basic Auth enabled (any username)"
        );
        Some(password.clone())
    } else {
        println!("HTTP API server listening on {bind_address} with no authentication");
        None
    };

    for req in server.incoming() {
        let control_path = control_path.clone();
        let static_path = static_path.clone();
        let auth_password = auth_password.clone();

        thread::spawn(move || {
            let mut req = match req {
                Ok(req) => req,
                Err(e) => {
                    eprintln!("Request error: {e}");
                    return;
                }
            };

            let method = req.method();
            let path = req.uri().path().to_string();
            let full_uri = req.uri().to_string();

            println!("{method:?} {path} (full URI: {full_uri})");

            // Check authentication if enabled (but skip /api/health)
            if let Some(ref expected_password) = auth_password {
                if path != "/api/health" && !check_basic_auth(&req, expected_password) {
                    let _ = req.respond(unauthorized_response());
                    return;
                }
            }

            // Check for static file serving first
            if method == Method::GET && !path.starts_with("/api/") {
                if let Some(ref static_dir) = static_path {
                    let static_dir_path = Path::new(static_dir);
                    println!(
                        "Static dir check: '{}' -> exists: {}, is_dir: {}",
                        static_dir,
                        static_dir_path.exists(),
                        static_dir_path.is_dir()
                    );
                    if static_dir_path.exists() && static_dir_path.is_dir() {
                        if let Some(static_response) = serve_static_file(static_dir_path, &path) {
                            let _ = req.respond(static_response);
                            return;
                        }
                    }
                } else {
                    println!("No static_path configured");
                }
            }

            let response = match (method, path.as_str()) {
                (&Method::GET, "/api/health") => handle_health(),
                (&Method::GET, "/api/sessions") => handle_list_sessions(&control_path),
                (&Method::POST, "/api/sessions") => handle_create_session(&control_path, &req),
                (&Method::POST, "/api/cleanup-exited") => handle_cleanup_exited(&control_path),
                (&Method::POST, "/api/mkdir") => handle_mkdir(&req),
                (&Method::GET, "/api/fs/browse") => handle_browse(&req),
                (&Method::GET, "/api/sessions/multistream") => {
                    return handle_multi_stream(&control_path, &mut req);
                }
                (&Method::GET, path)
                    if path.starts_with("/api/sessions/") && path.ends_with("/stream") =>
                {
                    return handle_session_stream_direct(&control_path, path, &mut req);
                }
                (&Method::GET, path)
                    if path.starts_with("/api/sessions/") && path.ends_with("/snapshot") =>
                {
                    handle_session_snapshot(&control_path, path)
                }
                (&Method::POST, path)
                    if path.starts_with("/api/sessions/") && path.ends_with("/input") =>
                {
                    handle_session_input(&control_path, path, &req)
                }
                (&Method::DELETE, path)
                    if path.starts_with("/api/sessions/") && path.ends_with("/cleanup") =>
                {
                    handle_session_cleanup(&control_path, path)
                }
                (&Method::DELETE, path) if path.starts_with("/api/sessions/") => {
                    handle_session_kill(&control_path, path)
                }
                _ => {
                    let error = ApiResponse {
                        success: None,
                        message: None,
                        error: Some("Not found".to_string()),
                        session_id: None,
                    };
                    json_response(StatusCode::NOT_FOUND, &error)
                }
            };

            let _ = req.respond(response);
        });
    }

    Ok(())
}

fn extract_session_id(path: &str) -> Option<String> {
    let re = Regex::new(r"/api/sessions/([^/]+)($|/)").unwrap();
    re.captures(path)
        .and_then(|caps| caps.get(1))
        .map(|m| m.as_str().to_string())
}

fn json_response<T: Serialize>(status: StatusCode, data: &T) -> Response<String> {
    let json = serde_json::to_string(data).unwrap_or_else(|_| "{}".to_string());
    Response::builder()
        .status(status)
        .header("Content-Type", "application/json")
        .header("Access-Control-Allow-Origin", "*")
        .body(json)
        .unwrap()
}

fn handle_health() -> Response<String> {
    let response = ApiResponse {
        success: Some(true),
        message: Some("OK".to_string()),
        error: None,
        session_id: None,
    };
    json_response(StatusCode::OK, &response)
}

fn handle_list_sessions(control_path: &Path) -> Response<String> {
    match sessions::list_sessions(control_path) {
        Ok(sessions) => {
            let mut session_responses = Vec::new();

            for (session_id, entry) in sessions {
                let started_at_str = entry
                    .session_info
                    .started_at
                    .map_or_else(|| "unknown".to_string(), |ts| ts.to_string());

                let last_modified =
                    get_last_modified(&entry.stream_out).unwrap_or_else(|| started_at_str.clone());

                session_responses.push(SessionResponse {
                    id: session_id,
                    command: entry.session_info.cmdline.join(" "),
                    working_dir: entry.session_info.cwd,
                    status: entry.session_info.status,
                    exit_code: entry.session_info.exit_code,
                    started_at: started_at_str,
                    last_modified,
                    pid: entry.session_info.pid,
                });
            }

            session_responses.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
            json_response(StatusCode::OK, &session_responses)
        }
        Err(e) => {
            let error = ApiResponse {
                success: None,
                message: None,
                error: Some(format!("Failed to list sessions: {e}")),
                session_id: None,
            };
            json_response(StatusCode::INTERNAL_SERVER_ERROR, &error)
        }
    }
}

fn handle_create_session(
    control_path: &Path,
    req: &crate::http_server::HttpRequest,
) -> Response<String> {
    // Read the request body
    let body_bytes = req.body();
    let body = String::from_utf8_lossy(body_bytes);

    let create_request = if let Ok(request) = serde_json::from_str::<CreateSessionRequest>(&body) {
        request
    } else {
        let error = ApiResponse {
            success: None,
            message: None,
            error: Some("Invalid request body. Expected JSON with 'command' array and optional 'workingDir'".to_string()),
            session_id: None,
        };
        return json_response(StatusCode::BAD_REQUEST, &error);
    };

    if create_request.command.is_empty() {
        let error = ApiResponse {
            success: None,
            message: None,
            error: Some("Command cannot be empty".to_string()),
            session_id: None,
        };
        return json_response(StatusCode::BAD_REQUEST, &error);
    }

    // Handle terminal spawning if requested
    if create_request.spawn_terminal {
        match crate::term::spawn_terminal_command(
            &create_request.command,
            create_request.working_dir.as_deref(),
            None,
        ) {
            Ok(terminal_session_id) => {
                println!("Terminal spawned with session ID: {terminal_session_id}");
                let response = ApiResponse {
                    success: Some(true),
                    message: Some("Session created successfully".to_string()),
                    error: None,
                    session_id: Some(terminal_session_id),
                };
                return json_response(StatusCode::OK, &response);
            }
            Err(e) => {
                let error = ApiResponse {
                    success: None,
                    message: None,
                    error: Some(format!("Failed to spawn terminal: {e}")),
                    session_id: None,
                };
                return json_response(StatusCode::INTERNAL_SERVER_ERROR, &error);
            }
        }
    }

    // Create session directory
    let session_id = Uuid::new_v4().to_string();
    let session_path = control_path.join(&session_id);
    if let Err(e) = fs::create_dir_all(&session_path) {
        let error = ApiResponse {
            success: None,
            message: None,
            error: Some(format!("Failed to create session directory: {e}")),
            session_id: None,
        };
        return json_response(StatusCode::INTERNAL_SERVER_ERROR, &error);
    }

    // Paths are set up within the spawned thread

    // Convert command to OsString vector
    let cmdline: Vec<std::ffi::OsString> = create_request
        .command
        .iter()
        .map(std::ffi::OsString::from)
        .collect();

    // Set working directory if specified, with tilde expansion
    let current_dir = if let Some(ref working_dir) = create_request.working_dir {
        // Expand ~ to home directory if needed
        let expanded_dir = if let Some(remaining_path) = working_dir.strip_prefix('~') {
            if let Some(home_dir) = std::env::var_os("HOME") {
                let home_path = std::path::Path::new(&home_dir);
                // Remove the ~ character
                if remaining_path.is_empty() {
                    home_path.to_path_buf()
                } else {
                    home_path.join(remaining_path.trim_start_matches('/'))
                }
            } else {
                // Fall back to the original path if HOME is not set
                std::path::PathBuf::from(working_dir)
            }
        } else {
            std::path::PathBuf::from(working_dir)
        };

        // Validate the expanded directory exists
        if !expanded_dir.exists() {
            let error = ApiResponse {
                success: None,
                message: None,
                error: Some(format!(
                    "Working directory does not exist: {}",
                    expanded_dir.display()
                )),
                session_id: None,
            };
            return json_response(StatusCode::BAD_REQUEST, &error);
        }
        expanded_dir.to_string_lossy().to_string()
    } else {
        std::env::current_dir()
            .map_or_else(|_| "/".to_string(), |p| p.to_string_lossy().to_string())
    };

    // Spawn the process in a detached manner using a separate thread
    let control_path_clone = control_path.to_path_buf();
    let session_id_clone = session_id.clone();
    let cmdline_clone = cmdline;
    let working_dir_clone = current_dir;
    let term_clone = create_request.term;

    std::thread::Builder::new()
        .name(format!("session-{session_id_clone}"))
        .spawn(move || {
            // Change to the specified working directory before spawning
            let original_dir = std::env::current_dir().ok();
            if let Err(e) = std::env::set_current_dir(&working_dir_clone) {
                eprintln!("Failed to change to working directory {working_dir_clone}: {e}");
                return;
            }

            // Set up TtySpawn
            let mut tty_spawn = crate::tty_spawn::TtySpawn::new_cmdline(
                cmdline_clone.iter().map(std::ffi::OsString::as_os_str),
            );
            let session_path = control_path_clone.join(&session_id_clone);
            let session_info_path = session_path.join("session.json");
            let stream_out_path = session_path.join("stream-out");
            let stdin_path = session_path.join("stdin");
            let notification_stream_path = session_path.join("notification-stream");

            if let Err(e) = tty_spawn
                .stdout_path(&stream_out_path, true)
                .and_then(|spawn| spawn.stdin_path(&stdin_path))
            {
                eprintln!("Failed to set up TTY paths for session {session_id_clone}: {e}");
                return;
            }

            tty_spawn.session_json_path(&session_info_path);

            if let Err(e) = tty_spawn.notification_path(&notification_stream_path) {
                eprintln!("Failed to set up notification path for session {session_id_clone}: {e}");
                return;
            }

            // Set session name based on the first command
            let session_name = cmdline_clone
                .first()
                .and_then(|cmd| cmd.to_str())
                .map_or("unknown", |s| s.split('/').next_back().unwrap_or(s))
                .to_string();
            tty_spawn.session_name(session_name);

            // Set the TERM environment variable
            tty_spawn.term(term_clone);

            // Enable detached mode for API-created sessions
            tty_spawn.detached(true);

            // Spawn the process (this will block until the process exits)
            match tty_spawn.spawn() {
                Ok(exit_code) => {
                    println!("Session {session_id_clone} exited with code {exit_code}");
                }
                Err(e) => {
                    eprintln!("Failed to spawn session {session_id_clone}: {e}");
                }
            }

            // Restore original directory
            if let Some(original) = original_dir {
                let _ = std::env::set_current_dir(original);
            }
        })
        .expect("Failed to spawn session thread");

    // Return success response immediately
    let response = ApiResponse {
        success: Some(true),
        message: Some("Session created successfully".to_string()),
        error: None,
        session_id: Some(session_id),
    };
    json_response(StatusCode::OK, &response)
}

fn handle_cleanup_exited(control_path: &Path) -> Response<String> {
    match sessions::cleanup_sessions(control_path, None) {
        Ok(()) => {
            let response = ApiResponse {
                success: Some(true),
                message: Some("All exited sessions cleaned up".to_string()),
                error: None,
                session_id: None,
            };
            json_response(StatusCode::OK, &response)
        }
        Err(e) => {
            let error = ApiResponse {
                success: None,
                message: None,
                error: Some(format!("Failed to cleanup sessions: {e}")),
                session_id: None,
            };
            json_response(StatusCode::INTERNAL_SERVER_ERROR, &error)
        }
    }
}

fn handle_session_snapshot(control_path: &Path, path: &str) -> Response<String> {
    if let Some(session_id) = extract_session_id(path) {
        let stream_path = control_path.join(&session_id).join("stream-out");

        if let Ok(content) = fs::read_to_string(&stream_path) {
            // Optimize snapshot by finding last clear command
            let optimized_content = optimize_snapshot_content(&content);

            // Log optimization results
            let original_lines = content.lines().count();
            let optimized_lines = optimized_content.lines().count();
            let reduction = if original_lines > 0 {
                #[allow(clippy::cast_precision_loss)]
                {
                    (original_lines - optimized_lines) as f64 / original_lines as f64 * 100.0
                }
            } else {
                0.0
            };

            println!(
                "Snapshot for {session_id}: {original_lines} lines → {optimized_lines} lines ({reduction:.1}% reduction)"
            );

            Response::builder()
                .status(StatusCode::OK)
                .header("Content-Type", "text/plain")
                .body(optimized_content)
                .unwrap()
        } else {
            let error = ApiResponse {
                success: None,
                message: None,
                error: Some("Session not found".to_string()),
                session_id: None,
            };
            json_response(StatusCode::NOT_FOUND, &error)
        }
    } else {
        let error = ApiResponse {
            success: None,
            message: None,
            error: Some("Invalid session ID".to_string()),
            session_id: None,
        };
        json_response(StatusCode::BAD_REQUEST, &error)
    }
}

fn optimize_snapshot_content(content: &str) -> String {
    let lines: Vec<&str> = content.lines().collect();
    let mut header_line: Option<&str> = None;
    let mut all_events: Vec<&str> = Vec::new();

    // Parse all lines first
    for line in &lines {
        if line.trim().is_empty() {
            continue;
        }

        // Try to parse as JSON to identify headers vs events
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(line) {
            // Check if it's a header (has version, width, height)
            if parsed.get("version").is_some()
                && parsed.get("width").is_some()
                && parsed.get("height").is_some()
            {
                header_line = Some(line);
            } else if parsed.as_array().is_some() {
                // It's an event array [timestamp, type, data]
                all_events.push(line);
            }
        }
    }

    // Find the last clear command
    let mut last_clear_index = None;
    let mut last_resize_before_clear: Option<&str> = None;

    for (i, event_line) in all_events.iter().enumerate().rev() {
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(event_line) {
            if let Some(array) = parsed.as_array() {
                if array.len() >= 3 {
                    if let (Some(event_type), Some(data)) = (array[1].as_str(), array[2].as_str()) {
                        if event_type == "o" {
                            // Look for clear screen escape sequences
                            if data.contains("\x1b[2J") ||      // Clear entire screen
                               data.contains("\x1b[H\x1b[2J") || // Home cursor + clear screen  
                               data.contains("\x1b[3J") ||      // Clear scrollback
                               data.contains("\x1bc")
                            {
                                // Full reset
                                last_clear_index = Some(i);
                                break;
                            }
                        }
                    }
                }
            }
        }
    }

    // Find the last resize event before the clear (if any)
    if let Some(clear_idx) = last_clear_index {
        for event_line in all_events.iter().take(clear_idx).rev() {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(event_line) {
                if let Some(array) = parsed.as_array() {
                    if array.len() >= 3 {
                        if let Some(event_type) = array[1].as_str() {
                            if event_type == "r" {
                                last_resize_before_clear = Some(event_line);
                                break;
                            }
                        }
                    }
                }
            }
        }
    }

    // Build optimized content
    let mut result_lines = Vec::new();

    // Add header if found
    if let Some(header) = header_line {
        result_lines.push(header.to_string());
    }

    // Add last resize before clear if found
    if let Some(resize_line) = last_resize_before_clear {
        // Modify the resize event to have timestamp 0
        if let Ok(mut parsed) = serde_json::from_str::<serde_json::Value>(resize_line) {
            if let Some(array) = parsed.as_array_mut() {
                if array.len() >= 3 {
                    array[0] = serde_json::Value::Number(serde_json::Number::from(0));
                    result_lines.push(
                        serde_json::to_string(&parsed).unwrap_or_else(|_| resize_line.to_string()),
                    );
                }
            }
        }
    }

    // Add events after the last clear (or all events if no clear found)
    let start_index = last_clear_index.unwrap_or(0);
    for event_line in all_events.iter().skip(start_index) {
        // Modify event to have timestamp 0 for immediate playback
        if let Ok(mut parsed) = serde_json::from_str::<serde_json::Value>(event_line) {
            if let Some(array) = parsed.as_array_mut() {
                if array.len() >= 3 {
                    array[0] = serde_json::Value::Number(serde_json::Number::from(0));
                    result_lines.push(
                        serde_json::to_string(&parsed)
                            .unwrap_or_else(|_| (*event_line).to_string()),
                    );
                }
            }
        }
    }

    result_lines.join("\n")
}

fn handle_session_input(
    control_path: &Path,
    path: &str,
    req: &crate::http_server::HttpRequest,
) -> Response<String> {
    if let Some(session_id) = extract_session_id(path) {
        // Try to read the request body using the body() method
        let body_bytes = req.body();
        let body = String::from_utf8_lossy(body_bytes);
        if let Ok(input_req) = serde_json::from_str::<InputRequest>(&body) {
            // Check if text is empty
            if input_req.text.is_empty() {
                let error = ApiResponse {
                    success: None,
                    message: None,
                    error: Some("Text is required".to_string()),
                    session_id: None,
                };
                return json_response(StatusCode::BAD_REQUEST, &error);
            }

            // First validate session exists and is running (like Node.js version)
            match sessions::list_sessions(control_path) {
                Ok(sessions) => {
                    if let Some(session_entry) = sessions.get(&session_id) {
                        // Check if session is running
                        if session_entry.session_info.status != "running" {
                            let error = ApiResponse {
                                success: None,
                                message: None,
                                error: Some("Session is not running".to_string()),
                                session_id: None,
                            };
                            return json_response(StatusCode::BAD_REQUEST, &error);
                        }

                        // Check if process is still alive
                        if let Some(pid) = session_entry.session_info.pid {
                            // Check if process exists (equivalent to Node.js process.kill(pid, 0))
                            let result = unsafe { libc::kill(pid as i32, 0) };
                            if result != 0 {
                                let error = ApiResponse {
                                    success: None,
                                    message: None,
                                    error: Some("Session process has died".to_string()),
                                    session_id: None,
                                };
                                return json_response(StatusCode::GONE, &error);
                            }
                        }

                        // Check if this is a special key (like Node.js version)
                        let special_keys = [
                            "arrow_up",
                            "arrow_down",
                            "arrow_left",
                            "arrow_right",
                            "escape",
                            "enter",
                            "ctrl_enter",
                            "shift_enter",
                        ];
                        let is_special_key = special_keys.contains(&input_req.text.as_str());

                        let result = if is_special_key {
                            sessions::send_key_to_session(
                                control_path,
                                &session_id,
                                &input_req.text,
                            )
                        } else {
                            sessions::send_text_to_session(
                                control_path,
                                &session_id,
                                &input_req.text,
                            )
                        };

                        match result {
                            Ok(()) => {
                                let response = ApiResponse {
                                    success: Some(true),
                                    message: Some("Input sent successfully".to_string()),
                                    error: None,
                                    session_id: None,
                                };
                                json_response(StatusCode::OK, &response)
                            }
                            Err(e) => {
                                let error = ApiResponse {
                                    success: None,
                                    message: None,
                                    error: Some(format!("Failed to send input: {e}")),
                                    session_id: None,
                                };
                                json_response(StatusCode::INTERNAL_SERVER_ERROR, &error)
                            }
                        }
                    } else {
                        // Session not found
                        let error = ApiResponse {
                            success: None,
                            message: None,
                            error: Some("Session not found".to_string()),
                            session_id: None,
                        };
                        json_response(StatusCode::NOT_FOUND, &error)
                    }
                }
                Err(e) => {
                    let error = ApiResponse {
                        success: None,
                        message: None,
                        error: Some(format!("Failed to list sessions: {e}")),
                        session_id: None,
                    };
                    json_response(StatusCode::INTERNAL_SERVER_ERROR, &error)
                }
            }
        } else {
            let error = ApiResponse {
                success: None,
                message: None,
                error: Some("Invalid request body".to_string()),
                session_id: None,
            };
            json_response(StatusCode::BAD_REQUEST, &error)
        }
    } else {
        let error = ApiResponse {
            success: None,
            message: None,
            error: Some("Invalid session ID".to_string()),
            session_id: None,
        };
        json_response(StatusCode::BAD_REQUEST, &error)
    }
}

fn handle_session_kill(control_path: &Path, path: &str) -> Response<String> {
    let session_id = if let Some(id) = extract_session_id(path) {
        id
    } else {
        let response = ApiResponse {
            success: None,
            message: None,
            error: Some("Invalid session ID".to_string()),
            session_id: None,
        };
        return json_response(StatusCode::BAD_REQUEST, &response);
    };

    let sessions = match sessions::list_sessions(control_path) {
        Ok(sessions) => sessions,
        Err(e) => {
            let response = ApiResponse {
                success: None,
                message: None,
                error: Some(format!("Failed to list sessions: {e}")),
                session_id: None,
            };
            return json_response(StatusCode::INTERNAL_SERVER_ERROR, &response);
        }
    };

    let session_entry = if let Some(entry) = sessions.get(&session_id) {
        entry
    } else {
        let response = ApiResponse {
            success: None,
            message: None,
            error: Some("Session not found".to_string()),
            session_id: None,
        };
        return json_response(StatusCode::NOT_FOUND, &response);
    };

    // If session has no PID, consider it already dead but update status if needed
    if session_entry.session_info.pid.is_none() {
        // Update session status to exited if not already
        let session_path = control_path.join(&session_id);
        let session_json_path = session_path.join("session.json");

        if let Ok(content) = std::fs::read_to_string(&session_json_path) {
            if let Ok(mut session_info) = serde_json::from_str::<serde_json::Value>(&content) {
                if session_info.get("status").and_then(|s| s.as_str()) != Some("exited") {
                    session_info["status"] = serde_json::json!("exited");
                    if let Ok(updated_content) = serde_json::to_string_pretty(&session_info) {
                        let _ = std::fs::write(&session_json_path, updated_content);
                    }
                }
            }
        }

        let response = ApiResponse {
            success: Some(true),
            message: Some("Session killed".to_string()),
            error: None,
            session_id: None,
        };
        return json_response(StatusCode::OK, &response);
    }

    // Try SIGKILL and wait for process to actually die
    let (status, message) = match sessions::send_signal_to_session(control_path, &session_id, 9) {
        Ok(()) => {
            // Wait up to 3 seconds for the process to actually die
            let session_path = control_path.join(&session_id);
            let session_json_path = session_path.join("session.json");

            let mut process_died = false;
            if let Ok(content) = std::fs::read_to_string(&session_json_path) {
                if let Ok(session_info) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(pid) = session_info.get("pid").and_then(serde_json::Value::as_u64) {
                        // Wait for the process to actually die
                        for _ in 0..30 {
                            // 30 * 100ms = 3 seconds max
                            // Only reap zombies for PTY sessions
                            if let Some(spawn_type) =
                                session_info.get("spawn_type").and_then(|s| s.as_str())
                            {
                                if spawn_type == "pty" {
                                    sessions::reap_zombies();
                                }
                            }

                            if !sessions::is_pid_alive(pid as u32) {
                                process_died = true;
                                break;
                            }
                            std::thread::sleep(std::time::Duration::from_millis(100));
                        }
                    }
                }
            }

            // Update session status to exited after confirming kill
            if let Ok(content) = std::fs::read_to_string(&session_json_path) {
                if let Ok(mut session_info) = serde_json::from_str::<serde_json::Value>(&content) {
                    session_info["status"] = serde_json::json!("exited");
                    session_info["exit_code"] = serde_json::json!(9); // SIGKILL exit code
                    if let Ok(updated_content) = serde_json::to_string_pretty(&session_info) {
                        let _ = std::fs::write(&session_json_path, updated_content);
                    }
                }
            }

            if process_died {
                (StatusCode::OK, "Session killed")
            } else {
                (
                    StatusCode::OK,
                    "Session kill signal sent (process may still be terminating)",
                )
            }
        }
        Err(e) => {
            let response = ApiResponse {
                success: None,
                message: None,
                error: Some(format!("Failed to kill session: {e}")),
                session_id: None,
            };
            return json_response(StatusCode::GONE, &response);
        }
    };

    let response = ApiResponse {
        success: Some(true),
        message: Some(message.to_string()),
        error: None,
        session_id: None,
    };
    json_response(status, &response)
}

fn handle_session_cleanup(control_path: &Path, path: &str) -> Response<String> {
    if let Some(session_id) = extract_session_id(path) {
        match sessions::cleanup_sessions(control_path, Some(&session_id)) {
            Ok(()) => {
                let response = ApiResponse {
                    success: Some(true),
                    message: Some("Session cleaned up".to_string()),
                    error: None,
                    session_id: None,
                };
                json_response(StatusCode::OK, &response)
            }
            Err(e) => {
                let error = ApiResponse {
                    success: None,
                    message: None,
                    error: Some(format!("Failed to cleanup session: {e}")),
                    session_id: None,
                };
                json_response(StatusCode::INTERNAL_SERVER_ERROR, &error)
            }
        }
    } else {
        let error = ApiResponse {
            success: None,
            message: None,
            error: Some("Invalid session ID".to_string()),
            session_id: None,
        };
        json_response(StatusCode::BAD_REQUEST, &error)
    }
}

fn get_last_modified(file_path: &str) -> Option<String> {
    fs::metadata(file_path)
        .and_then(|metadata| metadata.modified())
        .map(|time| {
            time.duration_since(SystemTime::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs()
                .to_string()
        })
        .ok()
}

fn handle_session_stream_direct(control_path: &Path, path: &str, req: &mut HttpRequest) {
    let sessions = sessions::list_sessions(control_path).expect("Failed to list sessions");

    // Extract session ID and find the corresponding entry
    let Some((session_id, session_entry)) =
        extract_session_id(path).and_then(|id| sessions.get(&id).map(|entry| (id, entry)))
    else {
        let error = ApiResponse {
            success: None,
            message: None,
            error: Some("Session not found".to_string()),
            session_id: None,
        };
        let response = json_response(StatusCode::NOT_FOUND, &error);
        let _ = req.respond(response);
        return;
    };

    println!("Starting streaming SSE for session {session_id}");

    // Initialize SSE response helper
    let mut sse_helper = match SseResponseHelper::new(req) {
        Ok(helper) => helper,
        Err(e) => {
            println!("Failed to initialize SSE helper: {e}");
            return;
        }
    };

    // Process events from the channel and send as SSE
    for event in StreamingIterator::new(session_entry.stream_out.clone()) {
        // Log errors for debugging
        if let StreamEvent::Error { message } = &event {
            println!("Stream error: {message}");
            break;
        }

        // Serialize and send the event as SSE data
        if let Ok(event_json) = serde_json::to_string(&event) {
            if let Err(e) = sse_helper.write_event(&event_json) {
                println!("Failed to send SSE data: {e}");
                break;
            }
        }

        // Break on End event
        if matches!(event, StreamEvent::End) {
            break;
        }
    }

    println!("Ended streaming SSE for session {session_id}");
}

fn handle_multi_stream(control_path: &Path, req: &mut HttpRequest) {
    println!("Starting multiplex streaming with dynamic session discovery");

    // Initialize SSE response helper
    let mut sse_helper = match SseResponseHelper::new(req) {
        Ok(helper) => helper,
        Err(e) => {
            println!("Failed to initialize SSE helper: {e}");
            return;
        }
    };

    // Create channels for communication
    let (sender, receiver) = mpsc::sync_channel::<(String, StreamEvent)>(100);
    let (session_discovery_tx, session_discovery_rx) = mpsc::channel::<String>();

    // Spawn session discovery thread to watch for new session directories
    let control_path_clone = control_path.to_path_buf();
    let discovery_sender = session_discovery_tx.clone();
    let session_discovery_handle = thread::spawn(move || {
        // Set up watcher for the control directory
        let (watcher_tx, watcher_rx) = mpsc::channel();
        let mut watcher: RecommendedWatcher = match notify::Watcher::new(
            move |res: notify::Result<Event>| {
                if let Ok(event) = res {
                    let _ = watcher_tx.send(event);
                }
            },
            notify::Config::default(),
        ) {
            Ok(w) => w,
            Err(e) => {
                println!("Failed to create session discovery watcher: {e}");
                return;
            }
        };

        if let Err(e) = watcher.watch(&control_path_clone, RecursiveMode::NonRecursive) {
            println!(
                "Failed to watch control directory {}: {e}",
                control_path_clone.display()
            );
            return;
        }

        println!(
            "Session discovery thread started, watching {}",
            control_path_clone.display()
        );

        // Also discover existing sessions at startup
        if let Ok(sessions) = sessions::list_sessions(&control_path_clone) {
            for session_id in sessions.keys() {
                if discovery_sender.send(session_id.clone()).is_err() {
                    println!("Failed to send initial session discovery");
                    return;
                }
            }
        }

        // Watch for new directories being created
        while let Ok(event) = watcher_rx.recv() {
            if let EventKind::Create(_) = event.kind {
                for path in event.paths {
                    if path.is_dir() {
                        if let Some(session_id) = path.file_name().and_then(|n| n.to_str()) {
                            // Check if this looks like a session directory (has session.json)
                            let session_json_path = path.join("session.json");
                            if session_json_path.exists() {
                                println!("New session directory detected: {session_id}");
                                if discovery_sender.send(session_id.to_string()).is_err() {
                                    println!("Session discovery channel closed");
                                    return;
                                }
                            }
                        }
                    }
                }
            }
        }

        println!("Session discovery thread ended");
    });

    // Spawn session manager thread to handle new sessions
    let control_path_clone2 = control_path.to_path_buf();
    let main_sender = sender.clone();
    let session_manager_handle = thread::spawn(move || {
        use std::collections::HashSet;
        let mut active_sessions = HashSet::new();
        let mut session_handles = Vec::new();

        while let Ok(session_id) = session_discovery_rx.recv() {
            // Skip if we already have this session
            if active_sessions.contains(&session_id) {
                continue;
            }

            // Get session info
            let sessions = match sessions::list_sessions(&control_path_clone2) {
                Ok(sessions) => sessions,
                Err(e) => {
                    println!("Failed to list sessions: {e}");
                    continue;
                }
            };

            let session_entry = if let Some(entry) = sessions.get(&session_id) {
                entry.clone()
            } else {
                println!("Session {session_id} not found in session list");
                continue;
            };

            println!("Starting stream thread for new session: {session_id}");
            active_sessions.insert(session_id.clone());

            // Spawn thread for this session
            let session_id_clone = session_id.clone();
            let stream_path = session_entry.stream_out.clone();
            let thread_sender = main_sender.clone();

            let handle = thread::spawn(move || {
                loop {
                    let stream = StreamingIterator::new(stream_path.clone());

                    println!("Starting stream for session {session_id_clone}");

                    // Process events from this session's stream
                    for event in stream {
                        // Send event through channel
                        if thread_sender
                            .send((session_id_clone.clone(), event.clone()))
                            .is_err()
                        {
                            println!(
                                "Channel closed, ending stream thread for session {session_id_clone}"
                            );
                            return;
                        }

                        // If this is an End event, the stream is finished
                        if matches!(event, StreamEvent::End) {
                            println!(
                                "Stream ended for session {session_id_clone}, waiting for file changes"
                            );
                            break;
                        }
                    }

                    // Set up FS notify to watch for file recreation
                    let (watcher_tx, watcher_rx) = mpsc::channel();
                    let mut watcher: RecommendedWatcher = match notify::Watcher::new(
                        move |res: notify::Result<Event>| {
                            if let Ok(event) = res {
                                let _ = watcher_tx.send(event);
                            }
                        },
                        notify::Config::default(),
                    ) {
                        Ok(w) => w,
                        Err(e) => {
                            println!(
                                "Failed to create file watcher for session {session_id_clone}: {e}"
                            );
                            return;
                        }
                    };

                    // Watch the stream file's parent directory
                    let stream_path_buf = std::path::PathBuf::from(&stream_path);
                    let parent_dir = if let Some(parent) = stream_path_buf.parent() {
                        parent
                    } else {
                        println!("Cannot determine parent directory for {stream_path}");
                        return;
                    };

                    if let Err(e) = watcher.watch(parent_dir, RecursiveMode::NonRecursive) {
                        println!(
                            "Failed to watch directory {} for session {session_id_clone}: {e}",
                            parent_dir.display()
                        );
                        return;
                    }

                    // Wait for the file to be recreated or timeout
                    let mut file_recreated = false;
                    let timeout = Duration::from_secs(30);
                    let start_time = std::time::Instant::now();

                    while start_time.elapsed() < timeout {
                        if let Ok(event) = watcher_rx.recv_timeout(Duration::from_millis(100)) {
                            match event.kind {
                                EventKind::Create(_) | EventKind::Modify(_) => {
                                    for path in event.paths {
                                        if path.to_string_lossy() == stream_path {
                                            println!(
                                                "Stream file recreated for session {session_id_clone}"
                                            );
                                            file_recreated = true;
                                            break;
                                        }
                                    }
                                    if file_recreated {
                                        break;
                                    }
                                }
                                _ => {}
                            }
                        }

                        // Also check if file exists (in case we missed the event)
                        if std::path::Path::new(&stream_path).exists() {
                            file_recreated = true;
                            break;
                        }
                    }

                    if !file_recreated {
                        println!(
                            "Timeout waiting for stream file recreation for session {session_id_clone}, ending thread"
                        );
                        return;
                    }

                    // Small delay before restarting to ensure file is ready
                    std::thread::sleep(Duration::from_millis(100));
                }
            });

            session_handles.push((session_id.clone(), handle));
        }

        println!(
            "Session manager thread ended, waiting for {} session threads",
            session_handles.len()
        );

        // Wait for all session threads to finish
        for (session_id, handle) in session_handles {
            println!("Waiting for session thread {session_id} to finish");
            let _ = handle.join();
        }

        println!("All session threads finished");
    });

    // Drop original senders so channels close when threads finish
    drop(sender);
    drop(session_discovery_tx);

    // Process events from the channel and send as SSE
    while let Ok((session_id, event)) = receiver.recv() {
        // Log errors for debugging
        if let StreamEvent::Error { message } = &event {
            println!("Stream error for session {session_id}: {message}");
            continue;
        }

        // Serialize the normal event
        if let Ok(event_json) = serde_json::to_string(&event) {
            // Create the prefixed format: session_id:serialized_normal_event
            let prefixed_event = format!("{session_id}:{event_json}");

            // Send as SSE data
            if let Err(e) = sse_helper.write_event(&prefixed_event) {
                println!("Failed to send SSE data: {e}");
                break;
            }
        }
    }

    println!("Multiplex streaming ended, cleaning up threads");

    // Wait for discovery and manager threads to finish
    let _ = session_discovery_handle.join();
    let _ = session_manager_handle.join();

    println!("All threads finished");
}

fn resolve_path(path: &str, home_dir: &str) -> PathBuf {
    if path.starts_with('~') {
        if path == "~" {
            PathBuf::from(home_dir)
        } else {
            PathBuf::from(home_dir).join(&path[2..]) // Skip ~/
        }
    } else {
        PathBuf::from(path)
    }
}

fn handle_browse(req: &crate::http_server::HttpRequest) -> Response<String> {
    let query_string = req.uri().query().unwrap_or("");

    let query: BrowseQuery = if let Ok(query) = serde_urlencoded::from_str(query_string) {
        query
    } else {
        let error = ApiResponse {
            success: None,
            message: None,
            error: Some("Invalid query parameters".to_string()),
            session_id: None,
        };
        return json_response(StatusCode::BAD_REQUEST, &error);
    };

    let dir_path = query.path.as_deref().unwrap_or("~");

    // Get home directory
    let home_dir = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
    let expanded_path = resolve_path(dir_path, &home_dir);

    if !expanded_path.exists() {
        let error = ApiResponse {
            success: None,
            message: None,
            error: Some("Directory not found".to_string()),
            session_id: None,
        };
        return json_response(StatusCode::NOT_FOUND, &error);
    }

    let metadata = if let Ok(metadata) = fs::metadata(&expanded_path) {
        metadata
    } else {
        let error = ApiResponse {
            success: None,
            message: None,
            error: Some("Failed to read directory metadata".to_string()),
            session_id: None,
        };
        return json_response(StatusCode::INTERNAL_SERVER_ERROR, &error);
    };

    if !metadata.is_dir() {
        let error = ApiResponse {
            success: None,
            message: None,
            error: Some("Path is not a directory".to_string()),
            session_id: None,
        };
        return json_response(StatusCode::BAD_REQUEST, &error);
    }

    let entries = if let Ok(entries) = fs::read_dir(&expanded_path) {
        entries
    } else {
        let error = ApiResponse {
            success: None,
            message: None,
            error: Some("Failed to list directory".to_string()),
            session_id: None,
        };
        return json_response(StatusCode::INTERNAL_SERVER_ERROR, &error);
    };

    let mut files = Vec::new();
    for entry in entries.flatten() {
        if let Ok(file_metadata) = entry.metadata() {
            let name = entry.file_name().to_string_lossy().to_string();

            fn system_time_to_iso_string(time: SystemTime) -> String {
                let duration = time
                    .duration_since(SystemTime::UNIX_EPOCH)
                    .unwrap_or_default();
                let timestamp = Timestamp::from_second(duration.as_secs() as i64)
                    .unwrap_or(Timestamp::UNIX_EPOCH);
                timestamp.to_string()
            }

            let created = file_metadata
                .created()
                .or_else(|_| file_metadata.modified())
                .map_or_else(
                    |_| "1970-01-01T00:00:00Z".to_string(),
                    system_time_to_iso_string,
                );

            let last_modified = file_metadata.modified().map_or_else(
                |_| "1970-01-01T00:00:00Z".to_string(),
                system_time_to_iso_string,
            );

            files.push(FileInfo {
                name,
                created,
                last_modified,
                size: file_metadata.len(),
                is_dir: file_metadata.is_dir(),
            });
        }
    }

    // Sort: directories first, then files, alphabetically
    files.sort_by(|a, b| {
        if a.is_dir && !b.is_dir {
            std::cmp::Ordering::Less
        } else if !a.is_dir && b.is_dir {
            std::cmp::Ordering::Greater
        } else {
            a.name.cmp(&b.name)
        }
    });

    let response = BrowseResponse {
        absolute_path: expanded_path.to_string_lossy().to_string(),
        files,
    };

    json_response(StatusCode::OK, &response)
}

fn handle_mkdir(req: &crate::http_server::HttpRequest) -> Response<String> {
    let body_bytes = req.body();
    let body = String::from_utf8_lossy(body_bytes);

    let mkdir_request = if let Ok(request) = serde_json::from_str::<MkdirRequest>(&body) {
        request
    } else {
        let error = ApiResponse {
            success: None,
            message: None,
            error: Some("Invalid request body. Expected JSON with 'path' field".to_string()),
            session_id: None,
        };
        return json_response(StatusCode::BAD_REQUEST, &error);
    };

    if mkdir_request.path.is_empty() {
        let error = ApiResponse {
            success: None,
            message: None,
            error: Some("Path cannot be empty".to_string()),
            session_id: None,
        };
        return json_response(StatusCode::BAD_REQUEST, &error);
    }

    match fs::create_dir_all(&mkdir_request.path) {
        Ok(()) => {
            let response = ApiResponse {
                success: Some(true),
                message: Some("Directory created successfully".to_string()),
                error: None,
                session_id: None,
            };
            json_response(StatusCode::OK, &response)
        }
        Err(e) => {
            let error = ApiResponse {
                success: None,
                message: None,
                error: Some(format!("Failed to create directory: {e}")),
                session_id: None,
            };
            json_response(StatusCode::INTERNAL_SERVER_ERROR, &error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_base64_auth_parsing() {
        // Test valid credentials
        let credentials = BASE64.encode("user:test123".as_bytes());
        let decoded_bytes = BASE64.decode(credentials.as_bytes()).unwrap();
        let decoded_str = String::from_utf8(decoded_bytes).unwrap();
        let colon_pos = decoded_str.find(':').unwrap();
        let password = &decoded_str[colon_pos + 1..];
        assert_eq!(password, "test123");

        // Test empty password
        let credentials = BASE64.encode("user:".as_bytes());
        let decoded_bytes = BASE64.decode(credentials.as_bytes()).unwrap();
        let decoded_str = String::from_utf8(decoded_bytes).unwrap();
        let colon_pos = decoded_str.find(':').unwrap();
        let password = &decoded_str[colon_pos + 1..];
        assert_eq!(password, "");
    }

    #[test]
    fn test_unauthorized_response() {
        let response = unauthorized_response();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            response.headers().get("WWW-Authenticate").unwrap(),
            "Basic realm=\"tty-fwd\""
        );
    }

    #[test]
    fn test_get_mime_type() {
        assert_eq!(get_mime_type(Path::new("test.html")), "text/html");
        assert_eq!(get_mime_type(Path::new("test.css")), "text/css");
        assert_eq!(
            get_mime_type(Path::new("test.js")),
            "application/javascript"
        );
        assert_eq!(get_mime_type(Path::new("test.json")), "application/json");
        assert_eq!(get_mime_type(Path::new("test.png")), "image/png");
        assert_eq!(get_mime_type(Path::new("test.jpg")), "image/jpeg");
        assert_eq!(
            get_mime_type(Path::new("test.unknown")),
            "application/octet-stream"
        );
    }

    #[test]
    fn test_extract_session_id() {
        assert_eq!(
            extract_session_id("/api/sessions/123-456"),
            Some("123-456".to_string())
        );
        assert_eq!(
            extract_session_id("/api/sessions/abc-def/stream"),
            Some("abc-def".to_string())
        );
        assert_eq!(
            extract_session_id("/api/sessions/test-id/input"),
            Some("test-id".to_string())
        );
        assert_eq!(extract_session_id("/api/sessions/"), None);
        assert_eq!(extract_session_id("/api/sessions"), None);
        assert_eq!(extract_session_id("/other/path"), None);
    }

    #[test]
    fn test_json_response() {
        #[derive(Serialize)]
        struct TestData {
            message: String,
            value: i32,
        }

        let data = TestData {
            message: "test".to_string(),
            value: 42,
        };

        let response = json_response(StatusCode::OK, &data);
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get("Content-Type").unwrap(),
            "application/json"
        );
        assert_eq!(
            response
                .headers()
                .get("Access-Control-Allow-Origin")
                .unwrap(),
            "*"
        );
        assert_eq!(response.body(), r#"{"message":"test","value":42}"#);
    }

    #[test]
    fn test_handle_health() {
        let response = handle_health();
        assert_eq!(response.status(), StatusCode::OK);
        assert!(response.body().contains(r#""success":true"#));
        assert!(response.body().contains(r#""message":"OK""#));
    }

    #[test]
    fn test_api_response_serialization() {
        let response = ApiResponse {
            success: Some(true),
            message: Some("Test message".to_string()),
            error: None,
            session_id: Some("123".to_string()),
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains(r#""success":true"#));
        assert!(json.contains(r#""message":"Test message""#));
        assert!(json.contains(r#""sessionId":"123""#));
        // error field should be None, which means it won't be serialized with skip_serializing_if
    }

    #[test]
    fn test_create_session_request_deserialization() {
        let json = r#"{
            "command": ["bash", "-l"],
            "workingDir": "/tmp"
        }"#;

        let request: CreateSessionRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.command, vec!["bash", "-l"]);
        assert_eq!(request.working_dir, Some("/tmp".to_string()));
        assert_eq!(request.term, DEFAULT_TERM);
        assert_eq!(request.spawn_terminal, true);

        // Test with explicit term and spawn_terminal
        let json = r#"{
            "command": ["vim"],
            "term": "xterm-256color",
            "spawn_terminal": false
        }"#;

        let request: CreateSessionRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.command, vec!["vim"]);
        assert_eq!(request.term, "xterm-256color");
        assert_eq!(request.spawn_terminal, false);
    }

    #[test]
    fn test_session_response_serialization() {
        let response = SessionResponse {
            id: "123".to_string(),
            command: "bash -l".to_string(),
            working_dir: "/home/user".to_string(),
            status: "running".to_string(),
            exit_code: None,
            started_at: "2024-01-01T00:00:00Z".to_string(),
            last_modified: "2024-01-01T00:01:00Z".to_string(),
            pid: Some(1234),
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains(r#""id":"123""#));
        assert!(json.contains(r#""command":"bash -l""#));
        assert!(json.contains(r#""workingDir":"/home/user""#));
        assert!(json.contains(r#""status":"running""#));
        assert!(json.contains(r#""startedAt":"2024-01-01T00:00:00Z""#));
        assert!(json.contains(r#""lastModified":"2024-01-01T00:01:00Z""#));
        assert!(json.contains(r#""pid":1234"#));
        // exitCode field should be None, which means it won't be serialized with skip_serializing_if
    }

    #[test]
    fn test_browse_response_serialization() {
        let response = BrowseResponse {
            absolute_path: "/home/user".to_string(),
            files: vec![
                FileInfo {
                    name: "dir1".to_string(),
                    created: "2024-01-01T00:00:00Z".to_string(),
                    last_modified: "2024-01-01T00:01:00Z".to_string(),
                    size: 4096,
                    is_dir: true,
                },
                FileInfo {
                    name: "file1.txt".to_string(),
                    created: "2024-01-01T00:00:00Z".to_string(),
                    last_modified: "2024-01-01T00:01:00Z".to_string(),
                    size: 1024,
                    is_dir: false,
                },
            ],
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains(r#""absolutePath":"/home/user""#));
        assert!(json.contains(r#""name":"dir1""#));
        assert!(json.contains(r#""isDir":true"#));
        assert!(json.contains(r#""name":"file1.txt""#));
        assert!(json.contains(r#""isDir":false"#));
        assert!(json.contains(r#""size":1024"#));
    }

    #[test]
    fn test_resolve_path() {
        let home_dir = "/home/user";

        assert_eq!(resolve_path("~", home_dir), PathBuf::from("/home/user"));
        assert_eq!(
            resolve_path("~/Documents", home_dir),
            PathBuf::from("/home/user/Documents")
        );
        assert_eq!(
            resolve_path("/absolute/path", home_dir),
            PathBuf::from("/absolute/path")
        );
        assert_eq!(
            resolve_path("relative/path", home_dir),
            PathBuf::from("relative/path")
        );
    }

    #[test]
    fn test_optimize_snapshot_content() {
        // Test with empty content
        assert_eq!(optimize_snapshot_content(""), "");

        // Test with header only
        let header = r#"{"version":2,"width":80,"height":24}"#;
        assert_eq!(optimize_snapshot_content(header), header);

        // Test with header and events
        let content = r#"{"version":2,"width":80,"height":24}
[0.5,"o","Hello"]
[1.0,"o","\u001b[2J"]
[1.5,"o","World"]"#;

        let optimized = optimize_snapshot_content(content);
        let lines: Vec<&str> = optimized.lines().collect();

        // Should have header and events after clear
        assert!(lines.len() >= 2);
        assert!(lines[0].contains("version"));
        // Events after clear should have timestamp 0
        assert!(lines[1].contains("[0,"));
    }

    #[test]
    fn test_serve_static_file_security() {
        let temp_dir = TempDir::new().unwrap();
        let static_root = temp_dir.path();

        // Test directory traversal attempts
        assert!(serve_static_file(static_root, "../etc/passwd").is_none());
        assert!(serve_static_file(static_root, "..\\windows\\system32").is_none());
        assert!(serve_static_file(static_root, "/etc/passwd").is_none());
    }

    #[test]
    fn test_serve_static_file() {
        let temp_dir = TempDir::new().unwrap();
        let static_root = temp_dir.path();

        // Create test files
        fs::write(static_root.join("test.html"), "<h1>Test</h1>").unwrap();
        fs::write(static_root.join("test.css"), "body { color: red; }").unwrap();
        fs::create_dir(static_root.join("subdir")).unwrap();
        fs::write(static_root.join("subdir/index.html"), "<h1>Subdir</h1>").unwrap();

        // Test serving a file
        let response = serve_static_file(static_root, "/test.html").unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers().get("Content-Type").unwrap(), "text/html");
        assert_eq!(response.body(), b"<h1>Test</h1>");

        // Test serving a CSS file
        let response = serve_static_file(static_root, "/test.css").unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers().get("Content-Type").unwrap(), "text/css");

        // Test serving index.html from directory
        let response = serve_static_file(static_root, "/subdir/").unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.body(), b"<h1>Subdir</h1>");

        // Test non-existent file
        assert!(serve_static_file(static_root, "/nonexistent.txt").is_none());

        // Test directory without index.html
        fs::create_dir(static_root.join("empty")).unwrap();
        assert!(serve_static_file(static_root, "/empty/").is_none());
    }

    #[test]
    fn test_input_request_deserialization() {
        let json = r#"{"text":"Hello, World!"}"#;
        let request: InputRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.text, "Hello, World!");

        // Test special keys
        let json = r#"{"text":"arrow_up"}"#;
        let request: InputRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.text, "arrow_up");
    }

    #[test]
    fn test_mkdir_request_deserialization() {
        let json = r#"{"path":"/tmp/test"}"#;
        let request: MkdirRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.path, "/tmp/test");
    }

    #[test]
    fn test_browse_query_deserialization() {
        // Test with path
        let query_string = "path=/home/user";
        let query: BrowseQuery = serde_urlencoded::from_str(query_string).unwrap();
        assert_eq!(query.path, Some("/home/user".to_string()));

        // Test without path
        let query_string = "";
        let query: BrowseQuery = serde_urlencoded::from_str(query_string).unwrap();
        assert_eq!(query.path, None);
    }

    #[test]
    fn test_mkdir_functionality() {
        let temp_dir = TempDir::new().unwrap();
        let new_dir = temp_dir.path().join("test_dir/nested");

        // Test creating directory
        fs::create_dir_all(&new_dir).unwrap();
        assert!(new_dir.exists());
        assert!(new_dir.is_dir());
    }

    #[test]
    fn test_browse_functionality() {
        let temp_dir = TempDir::new().unwrap();
        let test_dir = temp_dir.path();

        // Create test files and directories
        fs::create_dir(test_dir.join("subdir")).unwrap();
        fs::write(test_dir.join("file1.txt"), "content").unwrap();
        fs::write(test_dir.join("file2.txt"), "more content").unwrap();

        // Test reading directory
        let entries = fs::read_dir(test_dir).unwrap();
        let mut found_files = vec![];
        for entry in entries {
            let entry = entry.unwrap();
            found_files.push(entry.file_name().to_string_lossy().to_string());
        }
        assert!(found_files.contains(&"subdir".to_string()));
        assert!(found_files.contains(&"file1.txt".to_string()));
        assert!(found_files.contains(&"file2.txt".to_string()));
    }

    #[test]
    fn test_file_info_sorting() {
        let mut files = vec![
            FileInfo {
                name: "file2.txt".to_string(),
                created: "2024-01-01T00:00:00Z".to_string(),
                last_modified: "2024-01-01T00:01:00Z".to_string(),
                size: 100,
                is_dir: false,
            },
            FileInfo {
                name: "dir2".to_string(),
                created: "2024-01-01T00:00:00Z".to_string(),
                last_modified: "2024-01-01T00:01:00Z".to_string(),
                size: 4096,
                is_dir: true,
            },
            FileInfo {
                name: "file1.txt".to_string(),
                created: "2024-01-01T00:00:00Z".to_string(),
                last_modified: "2024-01-01T00:01:00Z".to_string(),
                size: 200,
                is_dir: false,
            },
            FileInfo {
                name: "dir1".to_string(),
                created: "2024-01-01T00:00:00Z".to_string(),
                last_modified: "2024-01-01T00:01:00Z".to_string(),
                size: 4096,
                is_dir: true,
            },
        ];

        // Apply the same sorting logic as in handle_browse
        files.sort_by(|a, b| {
            if a.is_dir && !b.is_dir {
                std::cmp::Ordering::Less
            } else if !a.is_dir && b.is_dir {
                std::cmp::Ordering::Greater
            } else {
                a.name.cmp(&b.name)
            }
        });

        // Verify directories come first, then files, all alphabetically sorted
        assert_eq!(files[0].name, "dir1");
        assert_eq!(files[1].name, "dir2");
        assert_eq!(files[2].name, "file1.txt");
        assert_eq!(files[3].name, "file2.txt");
    }

    #[test]
    fn test_handle_list_sessions() {
        let temp_dir = TempDir::new().unwrap();
        let control_path = temp_dir.path();

        // Create test session
        let session_id = "test-session";
        let session_path = control_path.join(session_id);
        fs::create_dir_all(&session_path).unwrap();

        let session_info = crate::protocol::SessionInfo {
            cmdline: vec!["bash".to_string()],
            name: "test".to_string(),
            cwd: "/tmp".to_string(),
            pid: Some(999999),
            status: "running".to_string(),
            exit_code: None,
            started_at: Some(jiff::Timestamp::now()),
            term: "xterm".to_string(),
            spawn_type: "pty".to_string(),
        };

        fs::write(
            session_path.join("session.json"),
            serde_json::to_string_pretty(&session_info).unwrap(),
        )
        .unwrap();
        fs::write(session_path.join("stream-out"), "").unwrap();
        fs::write(session_path.join("stdin"), "").unwrap();
        fs::write(session_path.join("notification-stream"), "").unwrap();

        let response = handle_list_sessions(control_path);
        assert_eq!(response.status(), StatusCode::OK);

        let body = response.body();
        assert!(body.contains(r#""id":"test-session""#));
        assert!(body.contains(r#""command":"bash""#));
        assert!(body.contains(r#""workingDir":"/tmp""#));
    }

    #[test]
    fn test_handle_cleanup_exited() {
        let temp_dir = TempDir::new().unwrap();
        let control_path = temp_dir.path();

        // Create a dead session
        let session_id = "dead-session";
        let session_path = control_path.join(session_id);
        fs::create_dir_all(&session_path).unwrap();

        let session_info = crate::protocol::SessionInfo {
            cmdline: vec!["test".to_string()],
            name: "dead".to_string(),
            cwd: "/tmp".to_string(),
            pid: Some(999999), // Non-existent PID
            status: "exited".to_string(),
            exit_code: Some(0),
            started_at: None,
            term: "xterm".to_string(),
            spawn_type: "pty".to_string(),
        };

        fs::write(
            session_path.join("session.json"),
            serde_json::to_string_pretty(&session_info).unwrap(),
        )
        .unwrap();

        assert!(session_path.exists());

        let response = handle_cleanup_exited(control_path);
        assert_eq!(response.status(), StatusCode::OK);
        assert!(response.body().contains(r#""success":true"#));

        // Session should be cleaned up
        assert!(!session_path.exists());
    }
}
