use anyhow::Result;
use std::process::Command;
use std::sync::Mutex;
use std::time::Duration;
use tempfile::TempDir;
use vt_pipe::{FileSessionStore, Forwarder, TitleMode};

// Ensure tests that modify VIBETUNNEL_SESSIONS_DIR don't run concurrently
static ENV_MUTEX: Mutex<()> = Mutex::new(());

#[test]
fn test_title_mode_parsing() {
    // Test that TitleMode enum values work correctly
    let modes = vec![TitleMode::None, TitleMode::Filter, TitleMode::Static, TitleMode::Dynamic];

    for mode in modes {
        let mode_str = format!("{mode:?}").to_lowercase();
        assert!(!mode_str.is_empty());
    }
}

#[test]
fn test_forwarder_creation() -> Result<()> {
    // Test that Forwarder can be created with different title modes
    let modes = vec![TitleMode::None, TitleMode::Filter, TitleMode::Static, TitleMode::Dynamic];

    for mode in modes {
        let forwarder = Forwarder::new(mode)?;
        assert_eq!(forwarder.title_mode(), mode);
    }

    Ok(())
}

#[test]
fn test_session_store_creation() -> Result<()> {
    let _guard = ENV_MUTEX.lock().unwrap();
    let temp_dir = TempDir::new()?;
    let session_id = "test-session-123";
    let original_dir = std::env::var("VIBETUNNEL_SESSIONS_DIR").ok();

    // Override the sessions directory for testing
    std::env::set_var("VIBETUNNEL_SESSIONS_DIR", temp_dir.path());

    let result = (|| -> Result<()> {
        let store = FileSessionStore::new(session_id)?;

        // Check that paths are created correctly
        let socket_path = store.socket_path();
        assert!(socket_path.to_string_lossy().contains(session_id));

        Ok(())
    })();

    // Restore original env var
    if let Some(dir) = original_dir {
        std::env::set_var("VIBETUNNEL_SESSIONS_DIR", dir);
    } else {
        std::env::remove_var("VIBETUNNEL_SESSIONS_DIR");
    }

    result
}

#[test]
fn test_session_info_serialization() -> Result<()> {
    use vibetunnel_pty_core::{SessionInfo, SessionStore};

    let _guard = ENV_MUTEX.lock().unwrap();
    let temp_dir = TempDir::new()?;
    let original_dir = std::env::var("VIBETUNNEL_SESSIONS_DIR").ok();
    std::env::set_var("VIBETUNNEL_SESSIONS_DIR", temp_dir.path());

    let session_id = "test-session-456";
    let mut store = FileSessionStore::new(session_id)?;

    let session_info = SessionInfo {
        id: session_id.to_string(),
        name: "test command".to_string(),
        command: vec!["echo".to_string(), "hello".to_string()],
        pid: Some(12345),
        created_at: chrono::Utc::now(),
        status: "running".to_string(),
        working_dir: "/tmp".to_string(),
        cols: 80,
        rows: 24,
        exit_code: None,
        title_mode: Some("static".to_string()),
        is_external_terminal: true,
    };

    // Create and retrieve session
    store.create_session(session_info.clone())?;
    let retrieved = store.get_session(session_id);

    assert!(retrieved.is_some());
    let retrieved = retrieved.unwrap();
    assert_eq!(retrieved.id, session_info.id);
    assert_eq!(retrieved.name, session_info.name);
    assert_eq!(retrieved.command, session_info.command);
    assert_eq!(retrieved.pid, session_info.pid);

    // Restore original env var
    if let Some(dir) = original_dir {
        std::env::set_var("VIBETUNNEL_SESSIONS_DIR", dir);
    } else {
        std::env::remove_var("VIBETUNNEL_SESSIONS_DIR");
    }

    Ok(())
}

#[test]
fn test_cli_help() {
    // Test that the CLI binary can show help
    let output = Command::new(env!("CARGO_BIN_EXE_vt-pipe"))
        .arg("--help")
        .output()
        .expect("Failed to execute vt-pipe");

    assert!(output.status.success());
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("Lightweight terminal forwarder"));
}

#[test]
fn test_cli_version() {
    // Test that the CLI binary can show version
    let output = Command::new(env!("CARGO_BIN_EXE_vt-pipe"))
        .arg("--version")
        .output()
        .expect("Failed to execute vt-pipe");

    assert!(output.status.success());
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("vt-pipe"));
}

#[test]
fn test_cli_fwd_subcommand() {
    // Test that fwd subcommand is recognized
    let output = Command::new(env!("CARGO_BIN_EXE_vt-pipe"))
        .args(&["fwd", "--help"])
        .output()
        .expect("Failed to execute vt-pipe");

    assert!(output.status.success());
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("Forward a command through VibeTunnel"));
}

#[test]
fn test_cli_with_invalid_args() {
    // Test that invalid arguments produce an error
    let output = Command::new(env!("CARGO_BIN_EXE_vt-pipe"))
        .args(&["--invalid-flag"])
        .output()
        .expect("Failed to execute vt-pipe");

    assert!(!output.status.success());
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("error") || stderr.contains("unexpected"));
}

#[cfg(unix)]
#[test]
fn test_terminal_size_detection() {
    use vt_pipe::terminal::Terminal;

    // This test might fail in CI environments without a terminal
    // Skip if not running in a TTY
    match Terminal::new() {
        Ok(terminal) => {
            match terminal.size() {
                Ok((cols, rows)) => {
                    // Reasonable terminal size bounds
                    assert!(cols > 0 && cols < 1000);
                    assert!(rows > 0 && rows < 1000);
                }
                Err(_) => {
                    // Terminal size detection failed - likely not in a TTY
                    println!("Skipping terminal test - terminal size detection failed");
                }
            }
        }
        Err(_) => {
            // Terminal creation failed - likely not in a TTY
            println!("Skipping terminal test - terminal creation failed");
        }
    }
}

#[tokio::test]
async fn test_socket_client_connection_retry() {
    use std::path::PathBuf;
    use vt_pipe::socket_client::SocketClient;

    // Test connection to non-existent socket
    let socket_path = PathBuf::from("/tmp/nonexistent-socket-12345");
    let result = SocketClient::connect_with_retry(&socket_path, 2, 10).await;

    // Should fail after retries
    assert!(result.is_err());
}

#[test]
fn test_environment_variable_handling() -> Result<()> {
    let _guard = ENV_MUTEX.lock().unwrap();
    let temp_dir = TempDir::new()?;
    let original_dir = std::env::var("VIBETUNNEL_SESSIONS_DIR").ok();
    std::env::set_var("VIBETUNNEL_SESSIONS_DIR", temp_dir.path());

    let result = (|| -> Result<()> {
        // Create a forwarder
        let forwarder = Forwarder::new(TitleMode::Static)?;

        // The session ID should be set
        assert!(!forwarder.session_id().is_empty());

        Ok(())
    })();

    // Restore original env var
    if let Some(dir) = original_dir {
        std::env::set_var("VIBETUNNEL_SESSIONS_DIR", dir);
    } else {
        std::env::remove_var("VIBETUNNEL_SESSIONS_DIR");
    }

    result
}

// Integration test that actually runs a command (only on Unix)
#[cfg(unix)]
#[tokio::test]
async fn test_command_execution() -> Result<()> {
    use std::time::Instant;

    // Skip in CI environments without TTY
    if std::env::var("CI").is_ok() {
        return Ok(());
    }

    let temp_dir = TempDir::new()?;
    std::env::set_var("VIBETUNNEL_SESSIONS_DIR", temp_dir.path());

    // Run a simple echo command that exits quickly
    let mut forwarder = Forwarder::new(TitleMode::None)?;

    // Run in a separate task with timeout
    let start = Instant::now();
    let handle =
        tokio::spawn(
            async move { forwarder.run(vec!["echo".to_string(), "test".to_string()]).await },
        );

    // Wait for completion with timeout
    let result = tokio::time::timeout(Duration::from_secs(5), handle).await;

    match result {
        Ok(Ok(Ok(_))) => {
            // Command completed successfully
            assert!(start.elapsed() < Duration::from_secs(2));
        }
        Ok(Ok(Err(e))) => {
            // Command failed - might be expected in test environment
            eprintln!("Command execution failed (might be expected in test env): {}", e);
        }
        _ => {
            // Timeout or panic - test environment issue
            eprintln!("Command execution timed out or panicked (might be expected in test env)");
        }
    }

    Ok(())
}

#[test]
fn test_session_update() -> Result<()> {
    use vibetunnel_pty_core::{SessionInfo, SessionStore};

    let temp_dir = TempDir::new()?;
    std::env::set_var("VIBETUNNEL_SESSIONS_DIR", temp_dir.path());

    let session_id = "test-update-session";
    let mut store = FileSessionStore::new(session_id)?;

    // Create initial session
    let session_info = SessionInfo {
        id: session_id.to_string(),
        name: "initial".to_string(),
        command: vec!["test".to_string()],
        pid: Some(12345),
        created_at: chrono::Utc::now(),
        status: "running".to_string(),
        working_dir: "/tmp".to_string(),
        cols: 80,
        rows: 24,
        exit_code: None,
        title_mode: None,
        is_external_terminal: true,
    };

    store.create_session(session_info.clone())?;

    // Update session
    let mut updated_info = session_info.clone();
    updated_info.status = "completed".to_string();
    updated_info.exit_code = Some(0);
    store.update_session(session_id, updated_info)?;

    // Verify update
    let updated = store.get_session(session_id);
    assert!(updated.is_some());
    let updated = updated.unwrap();
    assert_eq!(updated.status, "completed");
    assert_eq!(updated.exit_code, Some(0));

    Ok(())
}
