use axum::{routing::{post, get, delete}, Router, Json, extract::{Path, State}};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tokio::sync::Mutex as TokioMutex;
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    manager: Arc<TerminalManager>,
}

struct Session {
    writer: Box<dyn Write + Send>,
    output: Arc<TokioMutex<Vec<u8>>>,
    _child: Box<dyn portable_pty::Child + Send + Sync>,
    pty_pair: portable_pty::PtyPair,
}

struct TerminalManager {
    sessions: Mutex<HashMap<String, Session>>,
}

impl TerminalManager {
    fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    fn create_session(
        &self,
        command: Vec<String>,
        cwd: Option<String>,
        cols: Option<u16>,
        rows: Option<u16>,
    ) -> Result<(String, u32), String> {
        let id = Uuid::new_v4().to_string();
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: rows.unwrap_or(24),
                cols: cols.unwrap_or(80),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("openpty failed: {e}"))?;

        let mut cmd = CommandBuilder::new(&command[0]);
        if command.len() > 1 {
            cmd.args(&command[1..]);
        }
        if let Some(cwd) = &cwd {
            cmd.cwd(cwd);
        }
        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("spawn failed: {e}"))?;
        let pid = child.process_id().unwrap_or(0);

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("clone reader failed: {e}"))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("take writer failed: {e}"))?;

        let output = Arc::new(TokioMutex::new(Vec::new()));
        let output_clone = output.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let mut out = futures::executor::block_on(output_clone.lock());
                        out.extend_from_slice(&buf[..n]);
                    }
                    Err(_) => break,
                }
            }
        });

        let session = Session {
            writer,
            output,
            _child: child,
            pty_pair: pair,
        };
        self.sessions.lock().unwrap().insert(id.clone(), session);
        Ok((id, pid))
    }

    fn write(&self, id: &str, data: &[u8]) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions.get_mut(id).ok_or_else(|| "session not found".to_string())?;
        session
            .writer
            .write_all(data)
            .map_err(|e| format!("write failed: {e}"))?;
        session
            .writer
            .flush()
            .map_err(|e| format!("flush failed: {e}"))?;
        Ok(())
    }

    fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions.lock().unwrap();
        let session = sessions.get(id).ok_or_else(|| "session not found".to_string())?;
        session
            .pty_pair
            .master
            .resize(PtySize {
                cols,
                rows,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("resize failed: {e}"))?
            ;
        Ok(())
    }

    fn read(&self, id: &str) -> Result<Vec<u8>, String> {
        let sessions = self.sessions.lock().unwrap();
        let session = sessions.get(id).ok_or_else(|| "session not found".to_string())?;
        let mut output = futures::executor::block_on(session.output.lock());
        let data = output.split_off(0);
        Ok(data)
    }

    fn kill(&self, id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        sessions.remove(id);
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
struct CreateRequest {
    command: Vec<String>,
    cwd: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
}

#[derive(Debug, Serialize)]
struct CreateResponse {
    id: String,
    pid: u32,
}

#[derive(Debug, Deserialize)]
struct InputRequest {
    data: String,
}

#[derive(Debug, Deserialize)]
struct ResizeRequest {
    cols: u16,
    rows: u16,
}

async fn create_session(State(state): State<AppState>, Json(req): Json<CreateRequest>) -> Result<Json<CreateResponse>, String> {
    let (id, pid) = state.manager.create_session(req.command, req.cwd, req.cols, req.rows)?;
    Ok(Json(CreateResponse { id, pid }))
}

async fn send_input(State(state): State<AppState>, Path(id): Path<String>, Json(req): Json<InputRequest>) -> Result<(), String> {
    state.manager.write(&id, req.data.as_bytes())?;
    Ok(())
}

async fn resize(State(state): State<AppState>, Path(id): Path<String>, Json(req): Json<ResizeRequest>) -> Result<(), String> {
    state.manager.resize(&id, req.cols, req.rows)?;
    Ok(())
}

async fn read_output(State(state): State<AppState>, Path(id): Path<String>) -> Result<Vec<u8>, String> {
    state.manager.read(&id)
}

async fn kill_session(State(state): State<AppState>, Path(id): Path<String>) -> Result<(), String> {
    state.manager.kill(&id)?;
    Ok(())
}

#[tokio::main]
async fn main() {
    let manager = Arc::new(TerminalManager::new());
    let state = AppState { manager };

    let app = Router::new()
        .route("/sessions", post(create_session))
        .route("/sessions/:id/input", post(send_input))
        .route("/sessions/:id/resize", post(resize))
        .route("/sessions/:id/read", get(read_output))
        .route("/sessions/:id", delete(kill_session))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:4030")
        .await
        .unwrap();
    axum::serve(listener, app).await.unwrap();
}

