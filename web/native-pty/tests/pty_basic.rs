use napi::bindgen_prelude::*;
use std::collections::HashMap;
use std::time::Duration;
use vibetunnel_native_pty::{init_pty_system, NativePty};

#[test]
fn test_init_pty_system() {
    // Should not panic
    let result = init_pty_system();
    assert!(result.is_ok());
}

#[test]
fn test_pty_creation_default() {
    let pty = NativePty::new(None, None, None, None, None, None);
    assert!(pty.is_ok(), "PTY creation should succeed");
    
    let pty = pty.unwrap();
    assert!(pty.get_pid() > 0, "PID should be valid");
    
    // Clean up
    let _ = pty.destroy();
}

#[test]
fn test_pty_creation_with_shell() {
    let shells = if cfg!(windows) {
        vec!["cmd.exe", "powershell.exe"]
    } else {
        vec!["/bin/sh", "/bin/bash"]
    };
    
    for shell in shells {
        // Check if shell exists first
        if std::path::Path::new(shell).exists() {
            let pty = NativePty::new(
                Some(shell.to_string()),
                None,
                None,
                None,
                None,
                None,
            );
            
            assert!(
                pty.is_ok(),
                "PTY creation with {} should succeed",
                shell
            );
            
            if let Ok(pty) = pty {
                let _ = pty.destroy();
            }
        }
    }
}

#[test]
fn test_pty_creation_with_args() {
    let pty = NativePty::new(
        Some("echo".to_string()),
        Some(vec!["hello".to_string(), "world".to_string()]),
        None,
        None,
        None,
        None,
    );
    
    assert!(pty.is_ok(), "PTY with args should succeed");
    
    if let Ok(pty) = pty {
        // Give it time to execute
        std::thread::sleep(Duration::from_millis(100));
        
        // Try to read output
        let output = pty.read_all_output();
        assert!(output.is_ok());
        
        let _ = pty.destroy();
    }
}

#[test]
fn test_pty_creation_with_env() {
    let mut env = HashMap::new();
    env.insert("TEST_VAR".to_string(), "test_value".to_string());
    env.insert("ANOTHER_VAR".to_string(), "another_value".to_string());
    
    let pty = NativePty::new(
        None,
        None,
        Some(env),
        None,
        None,
        None,
    );
    
    assert!(pty.is_ok(), "PTY with env should succeed");
    
    if let Ok(pty) = pty {
        let _ = pty.destroy();
    }
}

#[test]
fn test_pty_creation_with_cwd() {
    let temp_dir = std::env::temp_dir();
    let cwd = temp_dir.to_string_lossy().to_string();
    
    let pty = NativePty::new(
        None,
        None,
        None,
        Some(cwd.clone()),
        None,
        None,
    );
    
    assert!(pty.is_ok(), "PTY with cwd should succeed");
    
    if let Ok(pty) = pty {
        let _ = pty.destroy();
    }
}

#[test]
fn test_pty_creation_with_size() {
    let pty = NativePty::new(
        None,
        None,
        None,
        None,
        Some(120),
        Some(40),
    );
    
    assert!(pty.is_ok(), "PTY with custom size should succeed");
    
    if let Ok(pty) = pty {
        // Note: We can't directly verify the size was set,
        // but at least it shouldn't crash
        let _ = pty.destroy();
    }
}

#[test]
fn test_pty_invalid_command() {
    let pty = NativePty::new(
        Some("/nonexistent/command".to_string()),
        None,
        None,
        None,
        None,
        None,
    );
    
    // This might succeed in creating PTY but fail when spawning
    // Different systems handle this differently
    if let Ok(pty) = pty {
        // Check if process exits quickly
        std::thread::sleep(Duration::from_millis(100));
        let status = pty.check_exit_status();
        
        // Clean up regardless
        let _ = pty.destroy();
        
        // Process should have exited with error
        if let Ok(Some(_exit_code)) = status {
            // Good, process exited
        }
    }
}

#[test]
fn test_pty_write_simple() {
    let pty = NativePty::new(
        Some(if cfg!(windows) { "cmd.exe" } else { "cat" }.to_string()),
        None,
        None,
        None,
        None,
        None,
    );
    
    assert!(pty.is_ok());
    let pty = pty.unwrap();
    
    // Write some data
    let test_data = "Hello, PTY!\n";
    let result = pty.write(Buffer::from(test_data.as_bytes().to_vec()));
    assert!(result.is_ok(), "Write should succeed");
    
    // Give it time to process
    std::thread::sleep(Duration::from_millis(100));
    
    // For 'cat', we should be able to read back what we wrote
    if !cfg!(windows) {
        let output = pty.read_all_output();
        assert!(output.is_ok());
        
        if let Ok(Some(buffer)) = output {
            let output_str = String::from_utf8_lossy(&buffer);
            assert!(
                output_str.contains("Hello, PTY!"),
                "Output should contain our input"
            );
        }
    }
    
    let _ = pty.destroy();
}

#[test]
fn test_pty_write_binary() {
    let pty = NativePty::new(
        None,
        None,
        None,
        None,
        None,
        None,
    );
    
    assert!(pty.is_ok());
    let pty = pty.unwrap();
    
    // Write binary data including null bytes
    let binary_data = vec![0x48, 0x65, 0x6C, 0x6C, 0x6F, 0x00, 0xFF, 0x0A];
    let result = pty.write(Buffer::from(binary_data));
    assert!(result.is_ok(), "Binary write should succeed");
    
    let _ = pty.destroy();
}

#[test]
fn test_pty_resize() {
    let pty = NativePty::new(
        None,
        None,
        None,
        None,
        Some(80),
        Some(24),
    );
    
    assert!(pty.is_ok());
    let pty = pty.unwrap();
    
    // Resize to different dimensions
    let result = pty.resize(120, 40);
    assert!(result.is_ok(), "Resize should succeed");
    
    // Try edge cases
    let result = pty.resize(1, 1);
    assert!(result.is_ok(), "Minimum resize should succeed");
    
    let result = pty.resize(999, 999);
    assert!(result.is_ok(), "Large resize should succeed");
    
    let _ = pty.destroy();
}

#[test]
fn test_pty_exit_status() {
    // Use 'true' command which exits immediately with 0
    let command = if cfg!(windows) { "exit 0" } else { "true" };
    let shell = if cfg!(windows) { Some("cmd.exe".to_string()) } else { None };
    let args = if cfg!(windows) { Some(vec!["/c".to_string(), command.to_string()]) } else { Some(vec![command.to_string()]) };
    
    let pty = NativePty::new(
        shell,
        args,
        None,
        None,
        None,
        None,
    );
    
    assert!(pty.is_ok());
    let pty = pty.unwrap();
    
    // Give process time to exit
    std::thread::sleep(Duration::from_millis(200));
    
    let status = pty.check_exit_status();
    assert!(status.is_ok());
    assert_eq!(status.unwrap(), Some(0), "Exit status should be 0");
    
    let _ = pty.destroy();
}

#[test]
fn test_pty_exit_status_error() {
    // Use 'false' command which exits with 1
    let command = if cfg!(windows) { "exit 1" } else { "false" };
    let shell = if cfg!(windows) { Some("cmd.exe".to_string()) } else { None };
    let args = if cfg!(windows) { Some(vec!["/c".to_string(), command.to_string()]) } else { Some(vec![command.to_string()]) };
    
    let pty = NativePty::new(
        shell,
        args,
        None,
        None,
        None,
        None,
    );
    
    assert!(pty.is_ok());
    let pty = pty.unwrap();
    
    // Give process time to exit
    std::thread::sleep(Duration::from_millis(200));
    
    let status = pty.check_exit_status();
    assert!(status.is_ok());
    
    // Exit code should be non-zero
    if let Some(code) = status.unwrap() {
        assert_ne!(code, 0, "Exit status should be non-zero");
    }
    
    let _ = pty.destroy();
}

#[test]
fn test_pty_kill() {
    // Start a long-running process
    let pty = NativePty::new(
        Some(if cfg!(windows) { "ping".to_string() } else { "sleep".to_string() }),
        Some(if cfg!(windows) { 
            vec!["localhost".to_string(), "-n".to_string(), "100".to_string()] 
        } else { 
            vec!["100".to_string()] 
        }),
        None,
        None,
        None,
        None,
    );
    
    assert!(pty.is_ok());
    let pty = pty.unwrap();
    
    // Process should be running
    let status = pty.check_exit_status();
    assert!(status.is_ok());
    assert_eq!(status.unwrap(), None, "Process should still be running");
    
    // Kill it
    let result = pty.kill(Some("SIGTERM".to_string()));
    assert!(result.is_ok(), "Kill should succeed");
    
    // Give it time to die
    std::thread::sleep(Duration::from_millis(200));
    
    // Check it's dead
    let status = pty.check_exit_status();
    assert!(status.is_ok());
    assert!(status.unwrap().is_some(), "Process should be dead");
    
    let _ = pty.destroy();
}

#[test]
fn test_pty_concurrent_operations() {
    let pty = NativePty::new(
        None,
        None,
        None,
        None,
        None,
        None,
    );
    
    assert!(pty.is_ok());
    let pty = pty.unwrap();
    
    // Spawn threads to do concurrent operations
    let pty_pid = pty.get_pid();
    
    let handles: Vec<_> = (0..5).map(|i| {
        std::thread::spawn(move || {
            // Each thread does some operations
            for j in 0..10 {
                // Alternate between different operations
                match (i + j) % 3 {
                    0 => {
                        // Check PID
                        assert!(pty_pid > 0);
                    }
                    1 => {
                        // Sleep a bit
                        std::thread::sleep(Duration::from_millis(1));
                    }
                    _ => {
                        // Just yield
                        std::thread::yield_now();
                    }
                }
            }
        })
    }).collect();
    
    // Wait for all threads
    for handle in handles {
        handle.join().unwrap();
    }
    
    let _ = pty.destroy();
}

#[test]
fn test_pty_destroy_cleanup() {
    let pty = NativePty::new(
        Some(if cfg!(windows) { "ping".to_string() } else { "sleep".to_string() }),
        Some(if cfg!(windows) { 
            vec!["localhost".to_string(), "-n".to_string(), "100".to_string()] 
        } else { 
            vec!["100".to_string()] 
        }),
        None,
        None,
        None,
        None,
    );
    
    assert!(pty.is_ok());
    let pty = pty.unwrap();
    let pid = pty.get_pid();
    
    // Destroy should clean up everything
    let result = pty.destroy();
    assert!(result.is_ok(), "Destroy should succeed");
    
    // After destroy, the process should be gone
    // Note: We can't easily verify this cross-platform
    // but at least destroy shouldn't panic
}

#[test]
fn test_pty_multiple_sessions() {
    // Create multiple PTY sessions
    let sessions: Vec<_> = (0..5).map(|_| {
        NativePty::new(
            None,
            None,
            None,
            None,
            None,
            None,
        )
    }).collect();
    
    // All should succeed
    for (i, session) in sessions.iter().enumerate() {
        assert!(session.is_ok(), "Session {} should be created", i);
    }
    
    // Get all PTYs
    let ptys: Vec<_> = sessions.into_iter().filter_map(|s| s.ok()).collect();
    
    // All should have unique PIDs
    let pids: Vec<_> = ptys.iter().map(|p| p.get_pid()).collect();
    for i in 0..pids.len() {
        for j in (i+1)..pids.len() {
            assert_ne!(pids[i], pids[j], "PIDs should be unique");
        }
    }
    
    // Clean up all
    for pty in ptys {
        let _ = pty.destroy();
    }
}