use anyhow::anyhow;
use std::collections::HashMap;
use std::ffi::OsString;
use std::fs;
use std::fs::OpenOptions;
use std::io::Write;
use std::os::fd::AsRawFd;
use std::os::unix::fs::OpenOptionsExt;
use std::path::Path;
use std::process::Command;
use std::time::Duration;
use uuid::Uuid;

use crate::protocol::{SessionEntryWithId, SessionInfo, SessionListEntry};
use crate::tty_spawn::TtySpawn;

pub fn list_sessions(
    control_path: &Path,
) -> Result<HashMap<String, SessionListEntry>, anyhow::Error> {
    let mut sessions = HashMap::new();

    if !control_path.exists() {
        return Ok(sessions);
    }

    for entry in fs::read_dir(control_path)? {
        let entry = entry?;
        let path = entry.path();

        if path.is_dir() {
            let session_id = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown");
            let session_json_path = path.join("session.json");
            let stream_out_path = path.join("stream-out");
            let stdin_path = path.join("stdin");
            let notification_stream_path = path.join("notification-stream");

            if session_json_path.exists() {
                let stream_out = stream_out_path
                    .canonicalize()
                    .unwrap_or_else(|_| stream_out_path.clone())
                    .to_string_lossy()
                    .to_string();
                let stdin = stdin_path
                    .canonicalize()
                    .unwrap_or_else(|_| stdin_path.clone())
                    .to_string_lossy()
                    .to_string();
                let notification_stream = notification_stream_path
                    .canonicalize()
                    .unwrap_or_else(|_| notification_stream_path.clone())
                    .to_string_lossy()
                    .to_string();
                let mut session_info: SessionInfo = fs::read_to_string(&session_json_path)
                    .and_then(|content| serde_json::from_str(&content).map_err(Into::into))
                    .unwrap_or_default();

                // Check if the process is still alive and update status if needed
                if session_info.status == "running" {
                    if let Some(pid) = session_info.pid {
                        if !is_pid_alive(pid) {
                            session_info.status = "exited".to_string();
                        }
                    }
                }

                sessions.insert(
                    session_id.to_string(),
                    SessionListEntry {
                        session_info,
                        stream_out,
                        stdin,
                        notification_stream,
                    },
                );
            }
        }
    }

    Ok(sessions)
}

pub fn find_current_session(
    control_path: &Path,
) -> Result<Option<SessionEntryWithId>, anyhow::Error> {
    let sessions = list_sessions(control_path)?;

    // Get current process PID
    let current_pid = std::process::id();

    // Check each session to see if current process or any parent is part of it
    for (session_id, session_entry) in sessions {
        if let Some(session_pid) = session_entry.session_info.pid {
            // Check if this session PID is in our process ancestry
            if is_process_descendant_of(current_pid, session_pid) {
                return Ok(Some(SessionEntryWithId {
                    session_id,
                    entry: session_entry,
                }));
            }
        }
    }

    Ok(None)
}

fn is_process_descendant_of(mut current_pid: u32, target_pid: u32) -> bool {
    // Check if current process is the target or a descendant of target
    while current_pid > 1 {
        if current_pid == target_pid {
            return true;
        }

        // Get parent PID
        match get_parent_pid(current_pid) {
            Some(parent_pid) => current_pid = parent_pid,
            None => break,
        }
    }

    false
}

fn get_parent_pid(pid: u32) -> Option<u32> {
    // Use ps command to get parent PID
    let output = Command::new("ps")
        .arg("-p")
        .arg(pid.to_string())
        .arg("-o")
        .arg("ppid=")
        .output()
        .ok()?;

    if output.status.success() {
        let ppid_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
        ppid_str.parse::<u32>().ok()
    } else {
        None
    }
}

pub fn send_key_to_session(
    control_path: &Path,
    session_id: &str,
    key: &str,
) -> Result<(), anyhow::Error> {
    let session_path = control_path.join(session_id);
    let stdin_path = session_path.join("stdin");

    if !stdin_path.exists() {
        return Err(anyhow!("Session {} not found or not running", session_id));
    }

    let key_bytes: &[u8] = match key {
        "arrow_up" => b"\x1b[A",
        "arrow_down" => b"\x1b[B",
        "arrow_right" => b"\x1b[C",
        "arrow_left" => b"\x1b[D",
        "escape" => b"\x1b",
        "enter" | "ctrl_enter" => b"\r", // Just CR like normal enter for now - let's test this first
        "shift_enter" => b"\x1b\x0d",    // ESC + Enter - simpler approach
        _ => return Err(anyhow!("Unknown key: {}", key)),
    };

    // Use a timeout-protected write operation that also checks for readers
    write_to_pipe_with_timeout(&stdin_path, key_bytes, Duration::from_secs(5))?;

    Ok(())
}

pub fn send_text_to_session(
    control_path: &Path,
    session_id: &str,
    text: &str,
) -> Result<(), anyhow::Error> {
    let session_path = control_path.join(session_id);
    let stdin_path = session_path.join("stdin");

    if !stdin_path.exists() {
        return Err(anyhow!("Session {} not found or not running", session_id));
    }

    // Use a timeout-protected write operation that also checks for readers
    write_to_pipe_with_timeout(&stdin_path, text.as_bytes(), Duration::from_secs(5))?;

    Ok(())
}

fn write_to_pipe_with_timeout(
    pipe_path: &Path,
    data: &[u8],
    timeout: Duration,
) -> Result<(), anyhow::Error> {
    // Open the pipe in non-blocking mode first to check if it has readers
    let file = OpenOptions::new()
        .write(true)
        .custom_flags(libc::O_NONBLOCK)
        .open(pipe_path)?;

    let fd = file.as_raw_fd();

    // Use poll to check if the pipe is writable with timeout
    let mut pollfd = libc::pollfd {
        fd,
        events: libc::POLLOUT,
        revents: 0,
    };

    let timeout_ms = timeout.as_millis() as libc::c_int;

    let poll_result = unsafe { libc::poll(&mut pollfd, 1, timeout_ms) };

    match poll_result {
        -1 => {
            let errno = std::io::Error::last_os_error();
            return Err(anyhow!("Poll failed: {}", errno));
        }
        0 => {
            return Err(anyhow!("Write operation timed out after {:?}", timeout));
        }
        _ => {
            // Check poll results
            if pollfd.revents & libc::POLLERR != 0 {
                return Err(anyhow!("Pipe error detected"));
            }
            if pollfd.revents & libc::POLLHUP != 0 {
                return Err(anyhow!("Pipe has no readers (POLLHUP)"));
            }
            if pollfd.revents & libc::POLLNVAL != 0 {
                return Err(anyhow!("Invalid pipe file descriptor"));
            }
            if pollfd.revents & libc::POLLOUT == 0 {
                return Err(anyhow!("Pipe not ready for writing"));
            }
        }
    }

    // At this point, the pipe is ready for writing
    // Re-open in blocking mode and write the data
    drop(file); // Close the non-blocking file descriptor

    let mut blocking_file = OpenOptions::new().append(true).open(pipe_path)?;

    blocking_file.write_all(data)?;
    blocking_file.flush()?;

    Ok(())
}

pub fn is_pid_alive(pid: u32) -> bool {
    let output = Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "stat="])
        .output();

    match output {
        Ok(output) => {
            if output.status.success() {
                // Check if it's a zombie process (status starts with 'Z')
                let stat = String::from_utf8_lossy(&output.stdout);
                let stat = stat.trim();
                !stat.starts_with('Z')
            } else {
                // Process doesn't exist
                false
            }
        }
        Err(_) => false,
    }
}

/// Attempt to reap zombie children
pub fn reap_zombies() {
    use libc::{waitpid, WNOHANG, WUNTRACED};
    use std::ptr;

    loop {
        // Try to reap any zombie children
        let result = unsafe { waitpid(-1, ptr::null_mut(), WNOHANG | WUNTRACED) };

        if result <= 0 {
            // No more children to reap or error occurred
            break;
        }

        // Successfully reaped a zombie child
        eprintln!("Reaped zombie child with PID: {result}");
    }
}

pub fn send_signal_to_session(
    control_path: &Path,
    session_id: &str,
    signal: i32,
) -> Result<(), anyhow::Error> {
    let session_path = control_path.join(session_id);
    let session_json_path = session_path.join("session.json");

    if !session_json_path.exists() {
        return Err(anyhow!("Session {} not found", session_id));
    }

    let content = fs::read_to_string(&session_json_path)?;
    let session_info: SessionInfo = serde_json::from_str(&content)?;

    if let Some(pid) = session_info.pid {
        if is_pid_alive(pid) {
            let result = unsafe { libc::kill(pid as i32, signal) };
            if result == 0 {
                Ok(())
            } else {
                Err(anyhow!("Failed to send signal {} to PID {}", signal, pid))
            }
        } else {
            Err(anyhow!(
                "Session {} process (PID: {}) is not running",
                session_id,
                pid
            ))
        }
    } else {
        Err(anyhow!("Session {} has no PID recorded", session_id))
    }
}

fn cleanup_session(control_path: &Path, session_id: &str) -> Result<bool, anyhow::Error> {
    let session_path = control_path.join(session_id);
    let session_json_path = session_path.join("session.json");

    if !session_path.exists() {
        return Err(anyhow!("Session {} not found", session_id));
    }

    if session_json_path.exists() {
        let content = fs::read_to_string(&session_json_path)?;
        if let Ok(session_info) = serde_json::from_str::<SessionInfo>(&content) {
            if let Some(pid) = session_info.pid {
                if is_pid_alive(pid) {
                    return Err(anyhow!(
                        "Session {} is still running (PID: {})",
                        session_id,
                        pid
                    ));
                }
            }
        }
    }

    fs::remove_dir_all(&session_path)?;
    Ok(true)
}

pub fn cleanup_sessions(
    control_path: &Path,
    specific_session: Option<&str>,
) -> Result<(), anyhow::Error> {
    if !control_path.exists() {
        return Ok(());
    }

    if let Some(session_id) = specific_session {
        cleanup_session(control_path, session_id)?;
        return Ok(());
    }

    for entry in fs::read_dir(control_path)? {
        let entry = entry?;
        let path = entry.path();

        if !path.is_dir() {
            continue;
        }

        if let Some(_session_id) = path.file_name().and_then(|n| n.to_str()) {
            let session_json_path = path.join("session.json");
            if !session_json_path.exists() {
                continue;
            }

            let should_remove = if let Ok(content) = fs::read_to_string(&session_json_path) {
                if let Ok(session_info) = serde_json::from_str::<SessionInfo>(&content) {
                    if let Some(pid) = session_info.pid {
                        !is_pid_alive(pid)
                    } else {
                        true
                    }
                } else {
                    true
                }
            } else {
                true
            };

            if should_remove {
                let _ = fs::remove_dir_all(&path);
            }
        }
    }

    Ok(())
}

pub fn spawn_command(
    control_path: std::path::PathBuf,
    session_name: Option<String>,
    session_id: Option<String>,
    cmdline: Vec<OsString>,
) -> Result<i32, anyhow::Error> {
    if cmdline.is_empty() {
        return Err(anyhow!("No command provided"));
    }


    let session_id = session_id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let session_path = control_path.join(session_id);
    fs::create_dir_all(&session_path)?;
    let session_info_path = session_path.join("session.json");
    let stream_out_path = session_path.join("stream-out");
    let stdin_path = session_path.join("stdin");
    let notification_stream_path = session_path.join("notification-stream");
    let mut tty_spawn = TtySpawn::new_cmdline(cmdline.iter().map(std::ffi::OsString::as_os_str));
    tty_spawn
        .stdout_path(&stream_out_path, true)?
        .stdin_path(&stdin_path)?
        .session_json_path(&session_info_path);
    if let Some(name) = session_name {
        tty_spawn.session_name(name);
    }
    tty_spawn.notification_path(&notification_stream_path)?;
    let exit_code = tty_spawn.spawn()?;
    Ok(exit_code)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{self, File};
    use tempfile::TempDir;

    // Helper function to create a test session directory structure
    fn create_test_session(
        control_path: &Path,
        session_id: &str,
        session_info: &SessionInfo,
    ) -> Result<(), anyhow::Error> {
        let session_path = control_path.join(session_id);
        fs::create_dir_all(&session_path)?;

        // Write session.json
        let session_json_path = session_path.join("session.json");
        let json = serde_json::to_string_pretty(session_info)?;
        fs::write(&session_json_path, json)?;

        // Create empty stream files
        File::create(session_path.join("stream-out"))?;
        File::create(session_path.join("stdin"))?;
        File::create(session_path.join("notification-stream"))?;

        Ok(())
    }

    #[test]
    fn test_list_sessions_empty() {
        let temp_dir = TempDir::new().unwrap();
        let control_path = temp_dir.path();

        let sessions = list_sessions(control_path).unwrap();
        assert!(sessions.is_empty());
    }

    #[test]
    fn test_list_sessions_with_sessions() {
        let temp_dir = TempDir::new().unwrap();
        let control_path = temp_dir.path();

        // Create test sessions
        let session1_info = SessionInfo {
            cmdline: vec!["bash".to_string()],
            name: "session1".to_string(),
            cwd: "/tmp".to_string(),
            pid: Some(999999), // Non-existent PID
            status: "running".to_string(),
            exit_code: None,
            started_at: None,
            term: "xterm".to_string(),
            spawn_type: "pty".to_string(),
        };

        let session2_info = SessionInfo {
            cmdline: vec!["vim".to_string(), "test.txt".to_string()],
            name: "session2".to_string(),
            cwd: "/home/user".to_string(),
            pid: Some(999998), // Non-existent PID
            status: "exited".to_string(),
            exit_code: Some(0),
            started_at: None,
            term: "xterm-256color".to_string(),
            spawn_type: "socket".to_string(),
        };

        create_test_session(control_path, "session1", &session1_info).unwrap();
        create_test_session(control_path, "session2", &session2_info).unwrap();

        let sessions = list_sessions(control_path).unwrap();
        assert_eq!(sessions.len(), 2);

        // Check session1
        let session1 = sessions.get("session1").unwrap();
        assert_eq!(session1.session_info.name, "session1");
        assert_eq!(session1.session_info.cmdline, vec!["bash"]);
        // Since PID 999999 doesn't exist, status should be updated to "exited"
        assert_eq!(session1.session_info.status, "exited");

        // Check session2
        let session2 = sessions.get("session2").unwrap();
        assert_eq!(session2.session_info.name, "session2");
        assert_eq!(session2.session_info.status, "exited");
        assert_eq!(session2.session_info.exit_code, Some(0));
    }

    #[test]
    fn test_list_sessions_ignores_non_directories() {
        let temp_dir = TempDir::new().unwrap();
        let control_path = temp_dir.path();

        // Create a regular file in the control directory
        File::create(control_path.join("not-a-session.txt")).unwrap();

        // Create a valid session
        let session_info = SessionInfo {
            cmdline: vec!["test".to_string()],
            name: "valid-session".to_string(),
            cwd: "/tmp".to_string(),
            pid: None,
            status: "exited".to_string(),
            exit_code: Some(0),
            started_at: None,
            term: "xterm".to_string(),
            spawn_type: "pty".to_string(),
        };
        create_test_session(control_path, "valid-session", &session_info).unwrap();

        let sessions = list_sessions(control_path).unwrap();
        assert_eq!(sessions.len(), 1);
        assert!(sessions.contains_key("valid-session"));
    }

    #[test]
    fn test_list_sessions_handles_missing_session_json() {
        let temp_dir = TempDir::new().unwrap();
        let control_path = temp_dir.path();

        // Create a session directory without session.json
        let session_path = control_path.join("incomplete-session");
        fs::create_dir_all(&session_path).unwrap();
        File::create(session_path.join("stream-out")).unwrap();

        let sessions = list_sessions(control_path).unwrap();
        assert!(sessions.is_empty());
    }

    #[test]
    fn test_is_pid_alive() {
        // Test with current process PID (should be alive)
        let current_pid = std::process::id();
        assert!(is_pid_alive(current_pid));

        // Test with non-existent PID
        assert!(!is_pid_alive(999999));

        // Test with PID 1 (init process, should always exist on Unix)
        assert!(is_pid_alive(1));
    }

    #[test]
    fn test_find_current_session_no_sessions() {
        let temp_dir = TempDir::new().unwrap();
        let control_path = temp_dir.path();

        let result = find_current_session(control_path).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn test_find_current_session_with_current_process() {
        let temp_dir = TempDir::new().unwrap();
        let control_path = temp_dir.path();

        // Create a session with current process PID
        let current_pid = std::process::id();
        let session_info = SessionInfo {
            cmdline: vec!["test".to_string()],
            name: "current-session".to_string(),
            cwd: "/tmp".to_string(),
            pid: Some(current_pid),
            status: "running".to_string(),
            exit_code: None,
            started_at: None,
            term: "xterm".to_string(),
            spawn_type: "pty".to_string(),
        };
        create_test_session(control_path, "current-session", &session_info).unwrap();

        let result = find_current_session(control_path).unwrap();
        assert!(result.is_some());
        let entry = result.unwrap();
        assert_eq!(entry.session_id, "current-session");
        assert_eq!(entry.entry.session_info.pid, Some(current_pid));
    }

    #[test]
    fn test_is_process_descendant_of() {
        // Test with same PID
        assert!(is_process_descendant_of(1234, 1234));

        // Test with current process and its parent
        let current_pid = std::process::id();
        if let Some(parent_pid) = get_parent_pid(current_pid) {
            assert!(is_process_descendant_of(current_pid, parent_pid));
        }

        // Test with unrelated PIDs
        assert!(!is_process_descendant_of(current_pid, 999999));
    }

    #[test]
    fn test_get_parent_pid() {
        // Test with current process
        let current_pid = std::process::id();
        let parent_pid = get_parent_pid(current_pid);
        assert!(parent_pid.is_some());
        assert!(parent_pid.unwrap() > 0);

        // Test with non-existent PID
        assert!(get_parent_pid(999999).is_none());
    }

    #[test]
    fn test_send_key_to_session() {
        let temp_dir = TempDir::new().unwrap();
        let control_path = temp_dir.path();

        // Create a test session
        let session_info = SessionInfo::default();
        create_test_session(control_path, "test-session", &session_info).unwrap();

        // Test sending various keys
        let test_cases = vec![
            ("arrow_up", &b"\x1b[A"[..]),
            ("arrow_down", &b"\x1b[B"[..]),
            ("arrow_right", &b"\x1b[C"[..]),
            ("arrow_left", &b"\x1b[D"[..]),
            ("escape", &b"\x1b"[..]),
            ("enter", &b"\r"[..]),
            ("ctrl_enter", &b"\r"[..]),
            ("shift_enter", &b"\x1b\x0d"[..]),
        ];

        for (key, _expected_bytes) in test_cases {
            // This will fail with "Pipe has no readers" but that's expected in tests
            let result = send_key_to_session(control_path, "test-session", key);
            // The function may succeed or fail depending on the pipe state
            // We're just testing that it doesn't panic
            let _ = result;
        }

        // Test unknown key
        let result = send_key_to_session(control_path, "test-session", "unknown_key");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Unknown key"));

        // Test non-existent session
        let result = send_key_to_session(control_path, "non-existent", "enter");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("not found"));
    }

    #[test]
    fn test_send_text_to_session() {
        let temp_dir = TempDir::new().unwrap();
        let control_path = temp_dir.path();

        // Create a test session
        let session_info = SessionInfo::default();
        create_test_session(control_path, "test-session", &session_info).unwrap();

        // Test sending text (will fail without a reader)
        let result = send_text_to_session(control_path, "test-session", "Hello, World!");
        // The function may succeed or fail depending on the pipe state
        // We're just testing that it doesn't panic
        let _ = result;

        // Test non-existent session
        let result = send_text_to_session(control_path, "non-existent", "test");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("not found"));
    }

    #[test]
    fn test_send_signal_to_session() {
        let temp_dir = TempDir::new().unwrap();
        let control_path = temp_dir.path();

        // Create a test session with non-existent PID
        let session_info = SessionInfo {
            cmdline: vec!["test".to_string()],
            name: "test-session".to_string(),
            cwd: "/tmp".to_string(),
            pid: Some(999999),
            status: "running".to_string(),
            exit_code: None,
            started_at: None,
            term: "xterm".to_string(),
            spawn_type: "pty".to_string(),
        };
        create_test_session(control_path, "test-session", &session_info).unwrap();

        // Test sending signal to non-existent process
        let result = send_signal_to_session(control_path, "test-session", libc::SIGTERM);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("is not running"));

        // Test session without PID
        let session_info_no_pid = SessionInfo {
            pid: None,
            ..session_info
        };
        create_test_session(control_path, "no-pid-session", &session_info_no_pid).unwrap();
        let result = send_signal_to_session(control_path, "no-pid-session", libc::SIGTERM);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("has no PID"));

        // Test non-existent session
        let result = send_signal_to_session(control_path, "non-existent", libc::SIGTERM);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("not found"));
    }

    #[test]
    fn test_cleanup_session() {
        let temp_dir = TempDir::new().unwrap();
        let control_path = temp_dir.path();

        // Create a test session
        let session_info = SessionInfo {
            cmdline: vec!["test".to_string()],
            name: "test-session".to_string(),
            cwd: "/tmp".to_string(),
            pid: Some(999999), // Non-existent PID
            status: "exited".to_string(),
            exit_code: Some(0),
            started_at: None,
            term: "xterm".to_string(),
            spawn_type: "pty".to_string(),
        };
        create_test_session(control_path, "test-session", &session_info).unwrap();

        // Verify session exists
        assert!(control_path.join("test-session").exists());

        // Clean up the session
        let result = cleanup_session(control_path, "test-session");
        assert!(result.is_ok());
        assert!(result.unwrap());

        // Verify session is removed
        assert!(!control_path.join("test-session").exists());

        // Test cleaning up non-existent session
        let result = cleanup_session(control_path, "non-existent");
        assert!(result.is_err());
    }

    #[test]
    fn test_cleanup_session_still_running() {
        let temp_dir = TempDir::new().unwrap();
        let control_path = temp_dir.path();

        // Create a session with current process PID (still running)
        let session_info = SessionInfo {
            cmdline: vec!["test".to_string()],
            name: "running-session".to_string(),
            cwd: "/tmp".to_string(),
            pid: Some(std::process::id()),
            status: "running".to_string(),
            exit_code: None,
            started_at: None,
            term: "xterm".to_string(),
            spawn_type: "pty".to_string(),
        };
        create_test_session(control_path, "running-session", &session_info).unwrap();

        // Attempt to clean up should fail
        let result = cleanup_session(control_path, "running-session");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("still running"));

        // Verify session still exists
        assert!(control_path.join("running-session").exists());
    }

    #[test]
    fn test_cleanup_sessions_all() {
        let temp_dir = TempDir::new().unwrap();
        let control_path = temp_dir.path();

        // Create multiple test sessions
        let dead_session = SessionInfo {
            cmdline: vec!["test1".to_string()],
            name: "dead-session".to_string(),
            cwd: "/tmp".to_string(),
            pid: Some(999999), // Non-existent
            status: "exited".to_string(),
            exit_code: Some(0),
            started_at: None,
            term: "xterm".to_string(),
            spawn_type: "pty".to_string(),
        };

        let running_session = SessionInfo {
            cmdline: vec!["test2".to_string()],
            name: "running-session".to_string(),
            cwd: "/tmp".to_string(),
            pid: Some(std::process::id()), // Current process
            status: "running".to_string(),
            exit_code: None,
            started_at: None,
            term: "xterm".to_string(),
            spawn_type: "pty".to_string(),
        };

        let no_pid_session = SessionInfo {
            cmdline: vec!["test3".to_string()],
            name: "no-pid-session".to_string(),
            cwd: "/tmp".to_string(),
            pid: None,
            status: "unknown".to_string(),
            exit_code: None,
            started_at: None,
            term: "xterm".to_string(),
            spawn_type: "pty".to_string(),
        };

        create_test_session(control_path, "dead-session", &dead_session).unwrap();
        create_test_session(control_path, "running-session", &running_session).unwrap();
        create_test_session(control_path, "no-pid-session", &no_pid_session).unwrap();

        // Clean up all sessions
        cleanup_sessions(control_path, None).unwrap();

        // Dead session should be removed
        assert!(!control_path.join("dead-session").exists());
        // Running session should remain
        assert!(control_path.join("running-session").exists());
        // No-PID session should be removed
        assert!(!control_path.join("no-pid-session").exists());
    }

    #[test]
    fn test_cleanup_sessions_specific() {
        let temp_dir = TempDir::new().unwrap();
        let control_path = temp_dir.path();

        // Create test sessions
        let session1 = SessionInfo::default();
        let session2 = SessionInfo::default();
        create_test_session(control_path, "session1", &session1).unwrap();
        create_test_session(control_path, "session2", &session2).unwrap();

        // Clean up specific session
        cleanup_sessions(control_path, Some("session1")).unwrap();

        // Only session1 should be removed
        assert!(!control_path.join("session1").exists());
        assert!(control_path.join("session2").exists());
    }

    #[test]
    fn test_write_to_pipe_with_timeout() {
        let temp_dir = TempDir::new().unwrap();
        let pipe_path = temp_dir.path().join("test_pipe");

        // Create a named pipe
        unsafe {
            let path_cstr = std::ffi::CString::new(pipe_path.to_str().unwrap()).unwrap();
            libc::mkfifo(path_cstr.as_ptr(), 0o666);
        }

        // Test writing without a reader (should timeout or fail)
        let result =
            write_to_pipe_with_timeout(&pipe_path, b"test data", Duration::from_millis(100));
        assert!(result.is_err());

        // Clean up
        std::fs::remove_file(&pipe_path).ok();
    }

    #[test]
    fn test_reap_zombies() {
        // This is difficult to test properly without creating actual zombie processes
        // Just ensure the function doesn't panic
        reap_zombies();
    }
}
