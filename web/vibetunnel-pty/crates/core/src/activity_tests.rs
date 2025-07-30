#[cfg(test)]
mod tests {
    use crate::activity::*;

    #[test]
    fn test_activity_detector_default() {
        let detector = ActivityDetector::default();
        // Should compile the regex successfully
        assert!(detector
            .claude_pattern
            .is_match("✻ Crafting… (205s · ↑ 6.0k tokens · press esc to interrupt)"));
    }

    #[test]
    fn test_activity_detector_new() {
        let detector = ActivityDetector::new();
        assert!(detector.is_ok());
    }

    #[test]
    fn test_detect_claude_activity_formats() {
        let detector = ActivityDetector::default();

        let test_cases = vec![
            // Format 1: Full format with tokens and prefix
            (
                "✻ Crafting… (205s · ↑ 6.0k tokens · press esc to interrupt)",
                "Crafting",
                Some("✻"),
                Some(205),
                Some("↑6.0"),
            ),
            // Format 2: Simple format with tokens
            (
                "✻ Measuring… (6s · 100 tokens · esc to interrupt)",
                "Measuring",
                Some("✻"),
                Some(6),
                Some("100"),
            ),
            // Format 3: Simple format without tokens
            ("⏺ Calculating… (0s)", "Calculating", Some("⏺"), Some(0), None),
            // Format 4: With hammer symbol
            (
                "✳ Measuring… (120s · ⚒ 671 tokens · esc to interrupt)",
                "Measuring",
                Some("✳"),
                Some(120),
                Some("⚒671"),
            ),
            // Various indicators
            (
                "● Thinking… (15s · 2.5k tokens · ctrl+c to interrupt)",
                "Thinking",
                Some("●"),
                Some(15),
                Some("2.5"),
            ),
            ("▶ Processing… (3s)", "Processing", Some("▶"), Some(3), None),
        ];

        for (input, expected_status, expected_indicator, expected_duration, expected_tokens) in
            test_cases
        {
            let activity = detector.detect(input.as_bytes());
            assert!(activity.is_some(), "Failed to detect activity in: {}", input);

            let activity = activity.unwrap();
            assert_eq!(activity.status, expected_status);
            assert_eq!(activity.indicator, expected_indicator.map(|s| s.to_string()));
            assert_eq!(activity.duration, expected_duration);
            if let Some(expected_token_str) = expected_tokens {
                assert!(activity.tokens.is_some());
                assert!(activity.tokens.as_ref().unwrap().contains(expected_token_str));
            } else {
                assert!(activity.tokens.is_none());
            }
            assert!(activity.timestamp > 0.0);
        }
    }

    #[test]
    fn test_detect_activity_with_whitespace() {
        let detector = ActivityDetector::default();

        let test_cases = vec![
            ("✻   Trimming whitespace…   (10s)  ", "Trimming whitespace"),
            ("✻\tUsing tabs…\t(5s)\t", "Using tabs"),
            ("✻ Multiple  spaces… (3s)", "Multiple  spaces"),
        ];

        for (input, expected_status) in test_cases {
            let activity = detector.detect(input.as_bytes());
            assert!(activity.is_some(), "Failed to detect activity in: {}", input);

            let activity = activity.unwrap();
            assert_eq!(activity.status.trim(), expected_status.trim());
            assert!(activity.duration.is_some());
        }
    }

    #[test]
    fn test_detect_no_activity() {
        let detector = ActivityDetector::default();

        let test_cases = vec![
            "Regular console output",
            "Some error message",
            "✻ Missing ellipsis and parentheses",
            "Missing star … (with parentheses)",
            "✻ Missing closing paren… (incomplete",
            "✻ … (missing duration)",
            "",
            "✻",
            "(just parentheses)",
            "✻ Not Claude format (different format)",
        ];

        for input in test_cases {
            let activity = detector.detect(input.as_bytes());
            assert!(activity.is_none(), "Unexpected activity detected for: {}", input);
        }
    }

    #[test]
    fn test_detect_activity_with_ansi_codes() {
        let detector = ActivityDetector::default();

        // Activity with ANSI color codes
        let input = "\x1b[32m✻ Processing… (15s · 1.2k tokens · esc to interrupt)\x1b[0m";
        let activity = detector.detect(input.as_bytes());
        assert!(activity.is_some());

        let activity = activity.unwrap();
        assert_eq!(activity.status, "Processing");
        assert_eq!(activity.duration, Some(15));
    }

    #[test]
    fn test_filter_status() {
        let detector = ActivityDetector::default();

        let input = "Before\n✻ Processing… (10s)\nAfter";
        let filtered = detector.filter_status(input);
        assert_eq!(filtered.trim(), "Before\n\nAfter");

        // Test with ANSI codes
        let input_ansi =
            "\x1b[32mBefore\n✻ Processing… (10s · 500 tokens · esc to interrupt)\nAfter\x1b[0m";
        let filtered_ansi = detector.filter_status(input_ansi);
        assert_eq!(filtered_ansi.trim(), "Before\n\nAfter");
    }

    #[test]
    fn test_detect_utf8_handling() {
        let detector = ActivityDetector::default();

        // Valid UTF-8 with special characters - must match Claude format
        let input = "✻ Processing émojis 🎉… (10s · 2.5k tokens · esc to interrupt)";
        let activity = detector.detect(input.as_bytes());
        assert!(activity.is_some());

        let activity = activity.unwrap();
        assert_eq!(activity.status, "Processing émojis 🎉");
        assert_eq!(activity.duration, Some(10));
        assert_eq!(activity.tokens, Some("2.5k".to_string()));
    }

    #[test]
    fn test_detect_invalid_utf8() {
        let detector = ActivityDetector::default();

        // Invalid UTF-8 sequence
        let invalid_utf8 = vec![0xFF, 0xFE, 0xFD];
        let activity = detector.detect(&invalid_utf8);
        assert!(activity.is_none());
    }

    #[test]
    fn test_activity_timestamp() {
        let detector = ActivityDetector::default();

        let before = chrono::Utc::now().timestamp_millis() as f64;
        let activity = detector.detect("✻ Test activity… (5s)".as_bytes()).unwrap();
        let after = chrono::Utc::now().timestamp_millis() as f64;

        assert!(activity.timestamp >= before);
        assert!(activity.timestamp <= after);
    }

    #[test]
    fn test_activity_serialization() {
        let activity = Activity {
            timestamp: 1234567890.0,
            status: "Test Status".to_string(),
            details: Some("Test Details".to_string()),
            indicator: Some("✻".to_string()),
            duration: Some(10),
            tokens: Some("1.5k".to_string()),
        };

        // Serialize to JSON
        let json = serde_json::to_string(&activity).expect("Failed to serialize");
        assert!(json.contains("\"timestamp\":1234567890.0"));
        assert!(json.contains("\"status\":\"Test Status\""));
        assert!(json.contains("\"details\":\"Test Details\""));
        assert!(json.contains("\"indicator\":\"✻\""));
        assert!(json.contains("\"duration\":10"));
        assert!(json.contains("\"tokens\":\"1.5k\""));

        // Deserialize back
        let deserialized: Activity = serde_json::from_str(&json).expect("Failed to deserialize");
        assert_eq!(deserialized.timestamp, activity.timestamp);
        assert_eq!(deserialized.status, activity.status);
        assert_eq!(deserialized.details, activity.details);
        assert_eq!(deserialized.indicator, activity.indicator);
        assert_eq!(deserialized.duration, activity.duration);
        assert_eq!(deserialized.tokens, activity.tokens);
    }

    #[test]
    fn test_activity_clone() {
        let original = Activity {
            timestamp: 1234567890.0,
            status: "Original".to_string(),
            details: Some("Details".to_string()),
            indicator: None,
            duration: None,
            tokens: None,
        };

        let cloned = original.clone();
        assert_eq!(cloned.timestamp, original.timestamp);
        assert_eq!(cloned.status, original.status);
        assert_eq!(cloned.details, original.details);
        assert_eq!(cloned.indicator, original.indicator);
        assert_eq!(cloned.duration, original.duration);
        assert_eq!(cloned.tokens, original.tokens);
    }

    #[test]
    fn test_activity_debug() {
        let activity = Activity {
            timestamp: 1234567890.0,
            status: "Debug Test".to_string(),
            details: Some("Debug Details".to_string()),
            indicator: Some("●".to_string()),
            duration: Some(15),
            tokens: None,
        };

        let debug_str = format!("{activity:?}");
        assert!(debug_str.contains("Activity"));
        assert!(debug_str.contains("1234567890.0"));
        assert!(debug_str.contains("Debug Test"));
        assert!(debug_str.contains("Debug Details"));
        assert!(debug_str.contains("indicator"));
        assert!(debug_str.contains("duration"));
        assert!(debug_str.contains("tokens"));
    }

    #[test]
    fn test_detect_multiple_activities_first_match() {
        let detector = ActivityDetector::default();

        let input = "Some output\n✻ First activity… (5s)\n✻ Second activity… (10s · 1.2k tokens · esc to interrupt)\nMore output";

        let activity = detector.detect(input.as_bytes());
        assert!(activity.is_some());

        let activity = activity.unwrap();
        // Should match the first occurrence
        assert_eq!(activity.status, "First activity");
        assert_eq!(activity.duration, Some(5));
        assert!(activity.tokens.is_none()); // First one doesn't have tokens
    }

    #[test]
    fn test_detect_activity_with_special_chars_in_details() {
        let detector = ActivityDetector::default();

        // Test that status text can contain special characters
        let test_cases = vec![
            ("✻ Processing file.rs… (5s)", "Processing file.rs", 5),
            (
                "✻ Building key=value… (10s · 1.5k tokens · esc to interrupt)",
                "Building key=value",
                10,
            ),
            ("✻ Loading 100%… (2s)", "Loading 100%", 2),
            (
                "✻ Scanning $HOME/path… (15s · 3k tokens · esc to interrupt)",
                "Scanning $HOME/path",
                15,
            ),
        ];

        for (input, expected_status, expected_duration) in test_cases {
            let activity = detector.detect(input.as_bytes());
            assert!(activity.is_some(), "Failed to detect activity in: {input}");

            let activity = activity.unwrap();
            assert_eq!(activity.status, expected_status);
            assert_eq!(activity.duration, Some(expected_duration));
        }
    }

    #[test]
    fn test_activity_with_none_details() {
        let activity = Activity {
            timestamp: 1234567890.0,
            status: "Status Only".to_string(),
            details: None,
            indicator: None,
            duration: None,
            tokens: None,
        };

        let json = serde_json::to_string(&activity).expect("Failed to serialize");
        let deserialized: Activity = serde_json::from_str(&json).expect("Failed to deserialize");

        assert_eq!(deserialized.status, "Status Only");
        assert_eq!(deserialized.details, None);
        assert_eq!(deserialized.indicator, None);
        assert_eq!(deserialized.duration, None);
        assert_eq!(deserialized.tokens, None);
    }

    #[test]
    fn test_empty_status_or_details() {
        let detector = ActivityDetector::default();

        // The regex should not match empty groups
        let test_cases = vec![
            "✻  (empty status)",
            "✻ Status ()", // empty details
        ];

        for input in test_cases {
            let activity = detector.detect(input.as_bytes());
            if let Some(act) = activity {
                // If matched, ensure we don't have truly empty strings
                assert!(
                    !act.status.trim().is_empty()
                        || act.details.as_ref().map_or(true, |d| !d.trim().is_empty())
                );
            }
        }
    }
}
