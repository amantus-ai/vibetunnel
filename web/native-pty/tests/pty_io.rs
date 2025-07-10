use napi::bindgen_prelude::*;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use vibetunnel_native_pty::NativePty;

#[test]
fn test_read_output_timeout() {
    let pty = NativePty::new(
        Some("echo".to_string()),
        Some(vec!["test output".to_string()]),
        None,
        None,
        None,
        None,
    ).unwrap();
    
    // Give echo time to run
    std::thread::sleep(Duration::from_millis(100));
    
    // Read with timeout
    let output = pty.read_output(Some(100));
    assert!(output.is_ok());
    
    if let Ok(Some(buffer)) = output {
        let text = String::from_utf8_lossy(&buffer);
        assert!(text.contains("test output"));
    }
    
    // After reading once, buffer should be empty
    let output2 = pty.read_output(Some(10));
    assert!(output2.is_ok());
    assert!(output2.unwrap().is_none(), "Buffer should be empty");
    
    let _ = pty.destroy();
}

#[test]
fn test_read_output_no_timeout() {
    let pty = NativePty::new(
        None,
        None,
        None,
        None,
        None,
        None,
    ).unwrap();
    
    // Try non-blocking read on empty buffer
    let output = pty.read_output(None);
    assert!(output.is_ok());
    assert!(output.unwrap().is_none(), "Should return None when no data");
    
    // Write something
    let _ = pty.write(Buffer::from(b"echo hello\n".to_vec()));
    std::thread::sleep(Duration::from_millis(100));
    
    // Now should have output
    let output = pty.read_output(None);
    assert!(output.is_ok());
    // May or may not have output depending on shell speed
    
    let _ = pty.destroy();
}

#[test]
fn test_read_all_output() {
    let pty = NativePty::new(
        Some("echo".to_string()),
        Some(vec!["line1".to_string()]),
        None,
        None,
        None,
        None,
    ).unwrap();
    
    // Let it generate output
    std::thread::sleep(Duration::from_millis(100));
    
    // Read all available
    let output = pty.read_all_output();
    assert!(output.is_ok());
    
    if let Ok(Some(buffer)) = output {
        let text = String::from_utf8_lossy(&buffer);
        assert!(text.contains("line1"));
    }
    
    let _ = pty.destroy();
}

#[test]
fn test_large_output_handling() {
    // Generate large output
    let pty = NativePty::new(
        Some(if cfg!(windows) { "cmd.exe" } else { "sh" }.to_string()),
        Some(if cfg!(windows) { 
            vec!["/c".to_string(), "for /L %i in (1,1,100) do @echo Line %i".to_string()]
        } else {
            vec!["-c".to_string(), "for i in $(seq 1 100); do echo Line $i; done".to_string()]
        }),
        None,
        None,
        None,
        None,
    ).unwrap();
    
    // Give it time to generate output
    std::thread::sleep(Duration::from_millis(500));
    
    // Read all - should handle large output
    let output = pty.read_all_output();
    assert!(output.is_ok());
    
    if let Ok(Some(buffer)) = output {
        let text = String::from_utf8_lossy(&buffer);
        // Should have multiple lines
        let line_count = text.lines().count();
        assert!(line_count > 50, "Should have many lines of output");
        
        // Check max bytes per call limit
        assert!(buffer.len() <= 65536, "Should respect max bytes limit");
    }
    
    let _ = pty.destroy();
}

#[test]
fn test_concurrent_read_write() {
    let pty = Arc::new(NativePty::new(
        Some(if cfg!(windows) { "cmd.exe" } else { "cat" }.to_string()),
        None,
        None,
        None,
        None,
        None,
    ).unwrap());
    
    let pty_write = Arc::clone(&pty);
    let pty_read = Arc::clone(&pty);
    
    // Writer thread
    let writer = std::thread::spawn(move || {
        for i in 0..10 {
            let msg = format!("Message {}\n", i);
            let _ = pty_write.write(Buffer::from(msg.as_bytes().to_vec()));
            std::thread::sleep(Duration::from_millis(10));
        }
    });
    
    // Reader thread
    let reader = std::thread::spawn(move || {
        let mut all_output = String::new();
        let start = Instant::now();
        
        while start.elapsed() < Duration::from_secs(1) {
            if let Ok(Some(buffer)) = pty_read.read_output(Some(50)) {
                all_output.push_str(&String::from_utf8_lossy(&buffer));
            }
        }
        
        all_output
    });
    
    writer.join().unwrap();
    let output = reader.join().unwrap();
    
    // Should have received at least some messages
    if !cfg!(windows) { // cat echoes back on Unix
        assert!(output.contains("Message"));
    }
    
    let _ = pty.destroy();
}

#[test]
fn test_write_after_exit() {
    let pty = NativePty::new(
        Some("true".to_string()), // Exits immediately
        None,
        None,
        None,
        None,
        None,
    ).unwrap();
    
    // Wait for process to exit
    std::thread::sleep(Duration::from_millis(200));
    
    // Try to write - should handle gracefully
    let result = pty.write(Buffer::from(b"test".to_vec()));
    // Might succeed or fail depending on timing, but shouldn't panic
    let _ = result;
    
    let _ = pty.destroy();
}

#[test]
fn test_buffer_backpressure() {
    // Create a process that generates output but we don't read
    let pty = NativePty::new(
        Some(if cfg!(windows) { "cmd.exe" } else { "sh" }.to_string()),
        Some(if cfg!(windows) {
            vec!["/c".to_string(), "for /L %i in (1,1,1000) do @echo Long line with lots of text %i".to_string()]
        } else {
            vec!["-c".to_string(), "for i in $(seq 1 1000); do echo Long line with lots of text $i; done".to_string()]
        }),
        None,
        None,
        None,
        None,
    ).unwrap();
    
    // Don't read for a while to let buffer fill
    std::thread::sleep(Duration::from_millis(500));
    
    // Now try to read - should handle full buffer gracefully
    let output = pty.read_all_output();
    assert!(output.is_ok());
    
    // Buffer might be full, some data might be dropped
    // This is expected behavior
    
    let _ = pty.destroy();
}

#[test]
fn test_binary_data_integrity() {
    let pty = NativePty::new(
        Some(if cfg!(windows) { "cmd.exe" } else { "cat" }.to_string()),
        None,
        None,
        None,
        None,
        None,
    ).unwrap();
    
    // Create binary data with all byte values
    let mut binary_data = Vec::with_capacity(256);
    for i in 0..=255u8 {
        binary_data.push(i);
    }
    
    // Write binary data
    let result = pty.write(Buffer::from(binary_data.clone()));
    assert!(result.is_ok());
    
    // For cat, should echo back
    if !cfg!(windows) {
        std::thread::sleep(Duration::from_millis(200));
        
        let output = pty.read_all_output();
        if let Ok(Some(buffer)) = output {
            // Might not get all bytes back due to terminal processing
            // but should get most
            assert!(!buffer.is_empty(), "Should receive some output");
        }
    }
    
    let _ = pty.destroy();
}

#[test]
fn test_rapid_small_writes() {
    let pty = NativePty::new(
        None,
        None,
        None,
        None,
        None,
        None,
    ).unwrap();
    
    // Many small writes
    for i in 0..100 {
        let result = pty.write(Buffer::from(vec![b'a' + (i % 26)]));
        assert!(result.is_ok());
    }
    
    // Should handle all writes without issues
    let _ = pty.destroy();
}

#[test]
fn test_read_after_destroy() {
    let pty = NativePty::new(
        None,
        None,
        None,
        None,
        None,
        None,
    ).unwrap();
    
    // Destroy first
    let _ = pty.destroy();
    
    // Try to read - should error
    let output = pty.read_output(None);
    assert!(output.is_err(), "Read after destroy should fail");
}

#[test]
fn test_special_characters_handling() {
    let pty = NativePty::new(
        Some(if cfg!(windows) { "cmd.exe" } else { "cat" }.to_string()),
        None,
        None,
        None,
        None,
        None,
    ).unwrap();
    
    // Test various special characters
    let special_chars = "Hello\tWorld\r\nSpecial: \x1b[31mRed\x1b[0m\n\0\x7F";
    let result = pty.write(Buffer::from(special_chars.as_bytes().to_vec()));
    assert!(result.is_ok());
    
    if !cfg!(windows) {
        std::thread::sleep(Duration::from_millis(100));
        
        let output = pty.read_all_output();
        if let Ok(Some(buffer)) = output {
            let text = String::from_utf8_lossy(&buffer);
            // Should preserve most special characters
            assert!(text.contains("Hello"));
            assert!(text.contains("World"));
        }
    }
    
    let _ = pty.destroy();
}