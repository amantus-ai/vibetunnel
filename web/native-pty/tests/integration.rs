use napi::bindgen_prelude::*;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use vibetunnel_native_pty::{ActivityDetector, NativePty};

#[test]
fn test_activity_detection_through_pty() {
    // Create PTY that outputs Claude-like status
    let pty = NativePty::new(
        Some("echo".to_string()),
        Some(vec!["✻ Processing… (42s · ↑ 2.5k tokens · esc to interrupt)".to_string()]),
        None,
        None,
        None,
        None,
    ).unwrap();
    
    // Create activity detector
    let detector = ActivityDetector::new().unwrap();
    
    // Give echo time to output
    std::thread::sleep(Duration::from_millis(100));
    
    // Read PTY output
    if let Ok(Some(buffer)) = pty.read_all_output() {
        // Detect activity in the output
        let activity = detector.detect(buffer);
        assert!(activity.is_some(), "Should detect Claude activity in PTY output");
        
        let activity = activity.unwrap();
        assert_eq!(activity.status, "✻ Processing");
        assert_eq!(activity.details.as_deref(), Some("42s, ↑2.5k"));
    }
    
    let _ = pty.destroy();
}

#[test]
fn test_streaming_activity_detection() {
    // Simulate a shell session with periodic Claude status updates
    let pty = NativePty::new(
        Some(if cfg!(windows) { "cmd.exe" } else { "sh" }.to_string()),
        Some(if cfg!(windows) {
            vec!["/c".to_string(), r#"echo Normal output && echo. && echo ✻ Thinking… (1s) && timeout /t 1 >nul && echo. && echo ⏺ Calculating… (2s)"#.to_string()]
        } else {
            vec!["-c".to_string(), r#"echo 'Normal output' && echo && echo '✻ Thinking… (1s)' && sleep 0.1 && echo && echo '⏺ Calculating… (2s)'"#.to_string()]
        }),
        None,
        None,
        None,
        None,
    ).unwrap();
    
    let detector = ActivityDetector::new().unwrap();
    let mut activities = Vec::new();
    
    // Read output in chunks over time
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(2) {
        if let Ok(Some(buffer)) = pty.read_output(Some(50)) {
            if let Some(activity) = detector.detect(buffer) {
                activities.push(activity);
            }
        }
    }
    
    // Should have detected at least one activity
    assert!(!activities.is_empty(), "Should detect activities in streaming output");
    
    // Check first activity
    if let Some(first) = activities.first() {
        assert!(first.status.contains("Thinking") || first.status.contains("Calculating"));
    }
    
    let _ = pty.destroy();
}

#[test]
fn test_ansi_colored_activity_through_pty() {
    // Many terminals add ANSI codes
    let colored_status = "\x1b[32m✻ Crafting…\x1b[0m \x1b[1m(100s · ↑ 5.2k tokens · esc to interrupt)\x1b[0m";
    
    let pty = NativePty::new(
        Some("echo".to_string()),
        Some(vec![colored_status.to_string()]),
        None,
        None,
        None,
        None,
    ).unwrap();
    
    let detector = ActivityDetector::new().unwrap();
    
    std::thread::sleep(Duration::from_millis(100));
    
    if let Ok(Some(buffer)) = pty.read_all_output() {
        let activity = detector.detect(buffer);
        assert!(activity.is_some(), "Should detect activity despite ANSI codes from PTY");
        
        let activity = activity.unwrap();
        assert_eq!(activity.status, "✻ Crafting");
        assert_eq!(activity.details.as_deref(), Some("100s, ↑5.2k"));
    }
    
    let _ = pty.destroy();
}

#[test]
fn test_multiple_pty_sessions_with_activity() {
    let detectors: Vec<_> = (0..3).map(|_| ActivityDetector::new().unwrap()).collect();
    
    // Create multiple PTYs with different activities
    let statuses = vec![
        "✻ Thinking… (10s)",
        "⏺ Processing… (20s · ↓ 1.5k tokens · esc to interrupt)",
        "✳ Analyzing… (30s)",
    ];
    
    let ptys: Vec<_> = statuses.iter().enumerate().map(|(i, status)| {
        NativePty::new(
            Some("echo".to_string()),
            Some(vec![format!("Session {}: {}", i, status)]),
            None,
            None,
            None,
            None,
        ).unwrap()
    }).collect();
    
    // Give all PTYs time to output
    std::thread::sleep(Duration::from_millis(200));
    
    // Check each PTY for its activity
    for (i, (pty, detector)) in ptys.iter().zip(detectors.iter()).enumerate() {
        if let Ok(Some(buffer)) = pty.read_all_output() {
            let text = String::from_utf8_lossy(&buffer);
            println!("PTY {} output: {}", i, text); // Debug
            
            let activity = detector.detect(buffer);
            assert!(
                activity.is_some(),
                "Should detect activity in PTY {} output: {}",
                i,
                text
            );
        }
    }
    
    // Clean up
    for pty in ptys {
        let _ = pty.destroy();
    }
}

#[test]
fn test_activity_detection_performance() {
    let detector = ActivityDetector::new().unwrap();
    
    // Create a PTY that generates lots of output
    let pty = NativePty::new(
        Some(if cfg!(windows) { "cmd.exe" } else { "sh" }.to_string()),
        Some(if cfg!(windows) {
            vec!["/c".to_string(), "for /L %i in (1,1,100) do @echo Line %i && echo ✻ Status… (%is)".to_string()]
        } else {
            vec!["-c".to_string(), r#"for i in $(seq 1 100); do echo "Line $i" && echo "✻ Status… (${i}s)"; done"#.to_string()]
        }),
        None,
        None,
        None,
        None,
    ).unwrap();
    
    let mut total_detections = 0;
    let start = std::time::Instant::now();
    
    // Process output for up to 1 second
    while start.elapsed() < Duration::from_secs(1) {
        if let Ok(Some(buffer)) = pty.read_output(Some(10)) {
            if detector.detect(buffer).is_some() {
                total_detections += 1;
            }
        }
    }
    
    println!("Detected {} activities in {:?}", total_detections, start.elapsed());
    
    // Should process many detections quickly
    assert!(total_detections > 0, "Should detect some activities");
    
    let _ = pty.destroy();
}

#[test]
fn test_partial_activity_across_reads() {
    // This tests a tricky case where activity status is split across PTY reads
    let pty = NativePty::new(
        Some(if cfg!(windows) { "cmd.exe" } else { "sh" }.to_string()),
        Some(if cfg!(windows) {
            vec!["/c".to_string(), r#"echo ✻ Craft && echo ing… (50s)"#.to_string()]
        } else {
            vec!["-c".to_string(), r#"printf '✻ Craft' && sleep 0.1 && echo 'ing… (50s)'"#.to_string()]
        }),
        None,
        None,
        None,
        None,
    ).unwrap();
    
    let detector = ActivityDetector::new().unwrap();
    let mut full_output = Vec::new();
    
    // Read in small chunks
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_millis(500) {
        if let Ok(Some(buffer)) = pty.read_output(Some(10)) {
            full_output.extend_from_slice(&buffer);
            
            // Try detecting on partial buffer
            let _ = detector.detect(buffer);
        }
    }
    
    // Now try on full buffer
    let activity = detector.detect(Buffer::from(full_output));
    // May or may not detect depending on how output was split
    
    let _ = pty.destroy();
}

#[test]
fn test_real_world_scenario() {
    // Simulate a more realistic scenario with mixed output
    let script = if cfg!(windows) {
        r#"echo Starting task... && echo. && timeout /t 1 >nul && echo ✻ Initializing… (0s) && echo Loading files... && echo Progress: 50% && timeout /t 1 >nul && echo ✻ Processing… (1s · ↑ 0.5k tokens · esc to interrupt) && echo Done!"#
    } else {
        r#"echo 'Starting task...' && echo && sleep 0.1 && echo '✻ Initializing… (0s)' && echo 'Loading files...' && echo 'Progress: 50%' && sleep 0.1 && echo '✻ Processing… (1s · ↑ 0.5k tokens · esc to interrupt)' && echo 'Done!'"#
    };
    
    let pty = NativePty::new(
        Some(if cfg!(windows) { "cmd.exe" } else { "sh" }.to_string()),
        Some(vec![(if cfg!(windows) { "/c" } else { "-c" }).to_string(), script.to_string()]),
        None,
        None,
        None,
        None,
    ).unwrap();
    
    let detector = ActivityDetector::new().unwrap();
    let activities = Arc::new(Mutex::new(Vec::new()));
    let all_output = Arc::new(Mutex::new(String::new()));
    
    // Read all output and detect activities
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(2) {
        if let Ok(Some(buffer)) = pty.read_output(Some(50)) {
            let text = String::from_utf8_lossy(&buffer);
            all_output.lock().unwrap().push_str(&text);
            
            if let Some(activity) = detector.detect(buffer) {
                activities.lock().unwrap().push(activity);
            }
        }
    }
    
    let activities = activities.lock().unwrap();
    let output = all_output.lock().unwrap();
    
    println!("Full output:\n{}", output);
    println!("Detected {} activities", activities.len());
    
    // Should detect at least one activity
    assert!(!activities.is_empty(), "Should detect Claude activities in mixed output");
    
    // Should have both regular output and activities
    assert!(output.contains("Starting task"));
    assert!(output.contains("Loading files"));
    
    let _ = pty.destroy();
}