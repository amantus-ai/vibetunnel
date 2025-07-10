use napi::bindgen_prelude::*;
use pretty_assertions::assert_eq;
use test_case::test_case;
use vibetunnel_native_pty::{Activity, ActivityDetector};

/// Helper to create a Buffer from a string
fn str_to_buffer(s: &str) -> Buffer {
    Buffer::from(s.as_bytes().to_vec())
}

#[test]
fn test_activity_detector_creation() {
    let detector = ActivityDetector::new();
    assert!(detector.is_ok(), "ActivityDetector should be created successfully");
}

#[test_case("✻ Crafting… (205s · ↑ 6.0k tokens · esc to interrupt)", "✻ Crafting", Some("205s, ↑6.0k"); "standard format with tokens")]
#[test_case("✻ Measuring… (6s ·  100 tokens · esc to interrupt)", "✻ Measuring", Some("6s,  100"); "format with space before token count")]
#[test_case("⏺ Calculating… (0s)", "⏺ Calculating", Some("0s"); "simple format without tokens")]
#[test_case("✳ Measuring… (120s · ⚒ 671 tokens · esc to interrupt)", "✳ Measuring", Some("120s, ⚒671"); "format with hammer symbol")]
#[test_case("● Thinking… (42s · ↓ 2.5k tokens · ctrl-c to interrupt)", "● Thinking", Some("42s, ↓2.5k"); "format with down arrow and k suffix")]
fn test_activity_detection_patterns(input: &str, expected_status: &str, expected_details: Option<&str>) {
    let detector = ActivityDetector::new().unwrap();
    let buffer = str_to_buffer(input);
    
    let activity = detector.detect(buffer);
    assert!(activity.is_some(), "Should detect activity in: {}", input);
    
    let activity = activity.unwrap();
    assert_eq!(activity.status, expected_status, "Status mismatch for: {}", input);
    assert_eq!(
        activity.details.as_deref(),
        expected_details,
        "Details mismatch for: {}", input
    );
    
    // Timestamp should be recent (within last second)
    let now = chrono::Utc::now().timestamp_millis() as f64;
    assert!(
        (now - activity.timestamp).abs() < 1000.0,
        "Timestamp should be recent"
    );
}

#[test]
fn test_ansi_code_stripping() {
    let detector = ActivityDetector::new().unwrap();
    
    // Status with ANSI color codes
    let colored_input = "\x1b[32m✻ Crafting…\x1b[0m \x1b[1m(205s · ↑ 6.0k tokens · esc to interrupt)\x1b[0m";
    let buffer = str_to_buffer(colored_input);
    
    let activity = detector.detect(buffer);
    assert!(activity.is_some(), "Should detect activity despite ANSI codes");
    
    let activity = activity.unwrap();
    assert_eq!(activity.status, "✻ Crafting");
    assert_eq!(activity.details.as_deref(), Some("205s, ↑6.0k"));
}

#[test]
fn test_multiple_statuses_in_buffer() {
    let detector = ActivityDetector::new().unwrap();
    
    // Buffer with multiple lines, only last one is a status
    let multi_line = "Some normal output\n✻ Old status… (100s)\nMore output\n⏺ Calculating… (5s)";
    let buffer = str_to_buffer(multi_line);
    
    let activity = detector.detect(buffer);
    assert!(activity.is_some(), "Should detect at least one activity");
    
    // Note: Current implementation only returns first match
    // This is a limitation we might want to address
    let activity = activity.unwrap();
    assert_eq!(activity.status, "✻ Old status");
}

#[test]
fn test_no_activity_detection() {
    let detector = ActivityDetector::new().unwrap();
    
    let test_cases = vec![
        "Normal terminal output",
        "✻ Not a status (missing ellipsis)",
        "Crafting… (no indicator)",
        "✻ Crafting (no ellipsis or duration)",
        "✻ Crafting… no parentheses",
        "✻ Crafting… (not a number)",
        "",
    ];
    
    for input in test_cases {
        let buffer = str_to_buffer(input);
        let activity = detector.detect(buffer);
        assert!(activity.is_none(), "Should not detect activity in: '{}'", input);
    }
}

#[test]
fn test_edge_cases() {
    let detector = ActivityDetector::new().unwrap();
    
    // Very long action name
    let long_action = "✻ VeryLongActionNameThatGoesOnAndOnAndOn… (10s)";
    let buffer = str_to_buffer(long_action);
    let activity = detector.detect(buffer);
    assert!(activity.is_some());
    
    // Very large duration
    let large_duration = "✻ Processing… (999999s · ↑ 999.9k tokens · esc to interrupt)";
    let buffer = str_to_buffer(large_duration);
    let activity = detector.detect(buffer);
    assert!(activity.is_some());
    assert_eq!(activity.unwrap().details.as_deref(), Some("999999s, ↑999.9k"));
    
    // Unicode in action name
    let unicode_action = "✻ Analyzing文字… (5s)";
    let buffer = str_to_buffer(unicode_action);
    let activity = detector.detect(buffer);
    assert!(activity.is_some());
}

#[test]
fn test_partial_buffer_handling() {
    let detector = ActivityDetector::new().unwrap();
    
    // Status split across potential buffer boundary
    let partial1 = "Some output ✻ Craft";
    let partial2 = "ing… (10s)";
    
    // First part shouldn't match
    let buffer1 = str_to_buffer(partial1);
    assert!(detector.detect(buffer1).is_none());
    
    // Second part alone shouldn't match either
    let buffer2 = str_to_buffer(partial2);
    assert!(detector.detect(buffer2).is_none());
    
    // But combined should match
    let combined = format!("{}{}", partial1, partial2);
    let buffer_combined = str_to_buffer(&combined);
    let activity = detector.detect(buffer_combined);
    assert!(activity.is_some());
}

#[test]
fn test_invalid_utf8_handling() {
    let detector = ActivityDetector::new().unwrap();
    
    // Create invalid UTF-8 sequence
    let mut invalid_bytes = "✻ Crafting… (10s)".as_bytes().to_vec();
    invalid_bytes.insert(5, 0xFF); // Insert invalid byte
    
    let buffer = Buffer::from(invalid_bytes);
    // Should handle gracefully (not panic)
    let _activity = detector.detect(buffer);
}

#[test]
fn test_empty_buffer() {
    let detector = ActivityDetector::new().unwrap();
    
    let empty_buffer = Buffer::from(vec![]);
    let activity = detector.detect(empty_buffer);
    assert!(activity.is_none());
}

#[test]
fn test_various_indicators() {
    let detector = ActivityDetector::new().unwrap();
    
    let indicators = vec!["✻", "⏺", "✳", "●", "◆", "▶", "★", "✓", "⚡"];
    
    for indicator in indicators {
        let input = format!("{} Testing… (1s)", indicator);
        let buffer = str_to_buffer(&input);
        let activity = detector.detect(buffer);
        assert!(
            activity.is_some(),
            "Should detect activity with indicator: {}",
            indicator
        );
        assert_eq!(
            activity.unwrap().status,
            format!("{} Testing", indicator)
        );
    }
}

#[test]
fn test_performance_large_buffer() {
    let detector = ActivityDetector::new().unwrap();
    
    // Create a large buffer with status at the end
    let mut large_text = String::with_capacity(1_000_000);
    for _ in 0..10000 {
        large_text.push_str("This is some normal terminal output that doesn't match\n");
    }
    large_text.push_str("✻ Processing… (42s · ↑ 100k tokens · esc to interrupt)");
    
    let buffer = str_to_buffer(&large_text);
    
    let start = std::time::Instant::now();
    let activity = detector.detect(buffer);
    let duration = start.elapsed();
    
    assert!(activity.is_some());
    assert!(
        duration.as_millis() < 100,
        "Detection should be fast even on large buffers: {:?}",
        duration
    );
}

#[test]
fn test_complex_ansi_sequences() {
    let detector = ActivityDetector::new().unwrap();
    
    // Complex ANSI with cursor movements, colors, styles
    let complex_ansi = "\x1b[2J\x1b[H\x1b[32;1m✻\x1b[0m \x1b[33mCrafting…\x1b[0m \x1b[?25l\x1b[36m(205s\x1b[0m · \x1b[31m↑\x1b[0m \x1b[35;1m6.0k\x1b[0m tokens · esc to interrupt)\x1b[?25h";
    let buffer = str_to_buffer(complex_ansi);
    
    let activity = detector.detect(buffer);
    assert!(activity.is_some(), "Should handle complex ANSI sequences");
    assert_eq!(activity.unwrap().status, "✻ Crafting");
}

#[test]
fn test_activity_struct_fields() {
    // Test that Activity struct has all expected fields
    let activity = Activity {
        timestamp: 1234567890.0,
        status: "✻ Testing".to_string(),
        details: Some("10s".to_string()),
    };
    
    assert_eq!(activity.timestamp, 1234567890.0);
    assert_eq!(activity.status, "✻ Testing");
    assert_eq!(activity.details, Some("10s".to_string()));
    
    // Test with None details
    let activity_no_details = Activity {
        timestamp: 0.0,
        status: String::new(),
        details: None,
    };
    assert!(activity_no_details.details.is_none());
}