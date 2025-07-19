use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use vibetunnel_pty_core::activity::*;
use vibetunnel_pty_core::protocol::*;
use vibetunnel_pty_core::pty::*;
use vibetunnel_pty_core::session::*;

#[test]
fn test_full_pty_lifecycle() {
    // Create PTY with echo command
    let config = PtyConfig {
        shell: Some("/bin/sh".to_string()),
        args: vec!["-c".to_string(), "echo 'Integration test' && sleep 0.1 && exit 0".to_string()],
        ..Default::default()
    };

    let mut pty = create_pty(&config).expect("Failed to create PTY");

    // Read output
    let mut output = Vec::new();
    thread::sleep(Duration::from_millis(200));

    let mut buffer = vec![0u8; 1024];
    let bytes_read = pty.reader.read(&mut buffer).expect("Failed to read");
    output.extend_from_slice(&buffer[..bytes_read]);

    let output_str = String::from_utf8_lossy(&output);
    assert!(output_str.contains("Integration test"));

    // Wait for process to exit
    thread::sleep(Duration::from_millis(100));
    let status = pty.child.try_wait().expect("Failed to get exit status");
    assert!(status.is_some());
}

#[test]
fn test_protocol_with_pty_output() {
    // Create a PTY that outputs data
    let config = PtyConfig {
        shell: Some("/bin/sh".to_string()),
        args: vec!["-c".to_string(), "echo 'Protocol test data' && exit".to_string()],
        ..Default::default()
    };

    let mut pty = create_pty(&config).expect("Failed to create PTY");

    // Read PTY output
    thread::sleep(Duration::from_millis(100));
    let mut buffer = vec![0u8; 1024];
    let bytes_read = pty.reader.read(&mut buffer).expect("Failed to read");

    // Encode as protocol message
    let encoded = encode_message(MessageType::StdoutData, &buffer[..bytes_read]);

    // Decode and verify
    let decoded = decode_message(&encoded).expect("Failed to decode").expect("No message");
    assert_eq!(decoded.0, MessageType::StdoutData);

    let output = String::from_utf8_lossy(&decoded.1);
    assert!(output.contains("Protocol test data"));
}

#[test]
fn test_session_management_with_pty() {
    let mut store = MemorySessionStore::new();

    // Create PTY
    let config = PtyConfig { shell: Some("/bin/sh".to_string()), ..Default::default() };

    let pty = create_pty(&config).expect("Failed to create PTY");

    // Create session info
    let session = SessionInfo {
        id: "test-session".to_string(),
        name: "Integration Test Session".to_string(),
        command: vec!["/bin/sh".to_string()],
        pid: Some(pty.pid),
        created_at: chrono::Utc::now(),
        status: "running".to_string(),
        working_dir: std::env::current_dir().unwrap().to_string_lossy().to_string(),
        cols: config.cols,
        rows: config.rows,
        exit_code: None,
        title_mode: None,
        is_external_terminal: false,
    };

    // Store session
    store.create_session(session.clone()).expect("Failed to create session");

    // Verify retrieval
    let retrieved = store.get_session("test-session");
    assert!(retrieved.is_some());
    assert_eq!(retrieved.unwrap().pid, Some(pty.pid));

    // Clean up
    drop(pty); // This should terminate the PTY process
}

#[test]
fn test_activity_detection_with_real_output() {
    let detector = ActivityDetector::new().expect("Failed to create detector");

    // Create PTY that outputs activity
    let config = PtyConfig {
        shell: Some("/bin/sh".to_string()),
        args: vec!["-c".to_string(), "echo '✻ Running command (test.sh)' && exit".to_string()],
        ..Default::default()
    };

    let mut pty = create_pty(&config).expect("Failed to create PTY");

    // Read output
    thread::sleep(Duration::from_millis(100));
    let mut buffer = vec![0u8; 1024];
    let bytes_read = pty.reader.read(&mut buffer).expect("Failed to read");

    // Detect activity
    let activity = detector.detect(&buffer[..bytes_read]);
    assert!(activity.is_some());

    let activity = activity.unwrap();
    assert_eq!(activity.status, "Running command");
    assert_eq!(activity.details, Some("test.sh".to_string()));
}

#[test]
fn test_concurrent_pty_operations() {
    let results = Arc::new(Mutex::new(Vec::new()));
    let mut handles = vec![];

    // Spawn multiple PTYs concurrently
    for i in 0..3 {
        let results_clone = Arc::clone(&results);
        let handle = thread::spawn(move || {
            let config = PtyConfig {
                shell: Some("/bin/sh".to_string()),
                args: vec!["-c".to_string(), format!("echo 'Thread {i}' && exit")],
                ..Default::default()
            };

            let mut pty = create_pty(&config).expect("Failed to create PTY");

            // Read output
            thread::sleep(Duration::from_millis(100));
            let mut buffer = vec![0u8; 1024];
            let bytes_read = pty.reader.read(&mut buffer).expect("Failed to read");

            let output = String::from_utf8_lossy(&buffer[..bytes_read]).to_string();
            results_clone.lock().unwrap().push((i, output));
        });
        handles.push(handle);
    }

    // Wait for all threads
    for handle in handles {
        handle.join().expect("Thread panicked");
    }

    // Verify results
    let results = results.lock().unwrap();
    assert_eq!(results.len(), 3);

    for (i, output) in results.iter() {
        assert!(output.contains(&format!("Thread {i}")));
    }
}

#[test]
fn test_pty_input_output_flow() {
    let config = PtyConfig { shell: Some("/bin/sh".to_string()), ..Default::default() };

    let mut pty = create_pty(&config).expect("Failed to create PTY");

    // Test multiple command sequences
    let test_sequences = vec![
        ("echo 'First'\n", "First"),
        ("echo 'Second'\n", "Second"),
        ("echo 'Third'\n", "Third"),
    ];

    for (input, expected) in test_sequences {
        // Send input
        pty.writer.write_all(input.as_bytes()).expect("Failed to write");
        pty.writer.flush().expect("Failed to flush");

        // Read output
        thread::sleep(Duration::from_millis(100));
        let mut buffer = vec![0u8; 1024];
        let bytes_read = pty.reader.read(&mut buffer).expect("Failed to read");

        let output = String::from_utf8_lossy(&buffer[..bytes_read]);
        assert!(output.contains(expected), "Expected '{}' in output: {}", expected, output);
    }

    // Clean exit
    pty.writer.write_all(b"exit\n").expect("Failed to write exit");
    pty.writer.flush().expect("Failed to flush");
}

#[test]
fn test_pty_resize_integration() {
    let config =
        PtyConfig { shell: Some("/bin/sh".to_string()), cols: 80, rows: 24, ..Default::default() };

    let pty = create_pty(&config).expect("Failed to create PTY");

    // Initial size
    assert!(resize_pty(pty.master.as_ref(), 80, 24).is_ok());

    // Resize to different sizes
    let sizes = vec![(120, 40), (60, 20), (100, 30)];

    for (cols, rows) in sizes {
        let result = resize_pty(pty.master.as_ref(), cols, rows);
        assert!(result.is_ok(), "Failed to resize to {}x{}", cols, rows);
        thread::sleep(Duration::from_millis(50)); // Give PTY time to process
    }

    // Clean up
    drop(pty);
}

#[test]
fn test_protocol_message_streaming() {
    // Simulate streaming protocol messages
    let mut buffer = Vec::new();

    // Add multiple messages to buffer
    buffer.extend_from_slice(&encode_message(MessageType::StdinData, b"input1"));
    buffer.extend_from_slice(&encode_message(MessageType::StdoutData, b"output1"));
    buffer.extend_from_slice(&encode_message(MessageType::StatusUpdate, b"connected"));
    buffer.extend_from_slice(&encode_message(MessageType::Error, b"test error"));

    // Process messages from buffer
    let mut offset = 0;
    let mut messages = Vec::new();

    while offset < buffer.len() {
        if let Some((msg_type, payload, consumed)) = decode_message(&buffer[offset..]).unwrap() {
            messages.push((msg_type, String::from_utf8_lossy(&payload).to_string()));
            offset += consumed;
        } else {
            break;
        }
    }

    // Verify all messages were decoded
    assert_eq!(messages.len(), 4);
    assert_eq!(messages[0], (MessageType::StdinData, "input1".to_string()));
    assert_eq!(messages[1], (MessageType::StdoutData, "output1".to_string()));
    assert_eq!(messages[2], (MessageType::StatusUpdate, "connected".to_string()));
    assert_eq!(messages[3], (MessageType::Error, "test error".to_string()));
}

#[test]
#[cfg(feature = "cli")]
fn test_with_tokio_runtime() {
    use tokio::runtime::Runtime;

    // Test that our code works with tokio runtime (for CLI feature)
    let rt = Runtime::new().expect("Failed to create runtime");

    rt.block_on(async {
        let config = PtyConfig {
            shell: Some("/bin/sh".to_string()),
            args: vec!["-c".to_string(), "echo 'Tokio test' && exit".to_string()],
            ..Default::default()
        };

        let mut pty = create_pty(&config).expect("Failed to create PTY");

        // Use tokio sleep
        tokio::time::sleep(Duration::from_millis(100)).await;

        let mut buffer = vec![0u8; 1024];
        let bytes_read = pty.reader.read(&mut buffer).expect("Failed to read");

        let output = String::from_utf8_lossy(&buffer[..bytes_read]);
        assert!(output.contains("Tokio test"));
    });
}
