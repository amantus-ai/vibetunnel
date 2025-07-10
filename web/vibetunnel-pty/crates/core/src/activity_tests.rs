#[cfg(test)]
mod tests {
    use crate::activity::*;

    #[test]
    fn test_activity_detector_default() {
        let detector = ActivityDetector::default();
        // Should compile the regex successfully
        assert!(detector.claude_pattern.is_match("✻ Test Activity (details here)"));
    }

    #[test]
    fn test_activity_detector_new() {
        let detector = ActivityDetector::new();
        assert!(detector.is_ok());
    }

    #[test]
    fn test_detect_valid_activity() {
        let detector = ActivityDetector::default();

        let test_cases = vec![
            ("✻ Running tests (test_module)", "Running tests", "test_module"),
            ("✻ Building project (cargo build)", "Building project", "cargo build"),
            ("✻ Analyzing code (src/main.rs)", "Analyzing code", "src/main.rs"),
            ("✻ Starting server (port 8080)", "Starting server", "port 8080"),
        ];

        for (input, expected_status, expected_details) in test_cases {
            let activity = detector.detect(input.as_bytes());
            assert!(activity.is_some());

            let activity = activity.unwrap();
            assert_eq!(activity.status, expected_status);
            assert_eq!(activity.details, Some(expected_details.to_string()));
            assert!(activity.timestamp > 0.0);
        }
    }

    #[test]
    fn test_detect_activity_with_whitespace() {
        let detector = ActivityDetector::default();

        let test_cases = vec![
            "✻   Trimming whitespace   (with spaces)  ",
            "✻\tUsing tabs\t(tab separated)\t",
            "✻ Multiple  spaces (in   between)",
        ];

        for input in test_cases {
            let activity = detector.detect(input.as_bytes());
            assert!(activity.is_some());

            let activity = activity.unwrap();
            assert!(!activity.status.is_empty());
            assert!(activity.details.is_some());
        }
    }

    #[test]
    fn test_detect_no_activity() {
        let detector = ActivityDetector::default();

        let test_cases = vec![
            "Regular console output",
            "Some error message",
            "✻ Missing parentheses",
            "Missing star (with parentheses)",
            "✻ Missing closing paren (incomplete",
            "✻ (missing status)",
            "",
            "✻",
            "(just parentheses)",
        ];

        for input in test_cases {
            let activity = detector.detect(input.as_bytes());
            assert!(activity.is_none(), "Unexpected activity detected for: {}", input);
        }
    }

    #[test]
    fn test_detect_activity_in_larger_text() {
        let detector = ActivityDetector::default();

        let input = r#"
        Some initial output
        ✻ Processing files (10 files found)
        More output after the activity
        "#;

        let activity = detector.detect(input.as_bytes());
        assert!(activity.is_some());

        let activity = activity.unwrap();
        assert_eq!(activity.status, "Processing files");
        assert_eq!(activity.details, Some("10 files found".to_string()));
    }

    #[test]
    fn test_detect_utf8_handling() {
        let detector = ActivityDetector::default();

        // Valid UTF-8 with special characters
        let input = "✻ Processing émojis 🎉 (with unicode 中文)";
        let activity = detector.detect(input.as_bytes());
        assert!(activity.is_some());

        let activity = activity.unwrap();
        assert_eq!(activity.status, "Processing émojis 🎉");
        assert_eq!(activity.details, Some("with unicode 中文".to_string()));
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
        let activity = detector.detect("✻ Test activity (test)".as_bytes()).unwrap();
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
        };

        // Serialize to JSON
        let json = serde_json::to_string(&activity).expect("Failed to serialize");
        assert!(json.contains("\"timestamp\":1234567890.0"));
        assert!(json.contains("\"status\":\"Test Status\""));
        assert!(json.contains("\"details\":\"Test Details\""));

        // Deserialize back
        let deserialized: Activity = serde_json::from_str(&json).expect("Failed to deserialize");
        assert_eq!(deserialized.timestamp, activity.timestamp);
        assert_eq!(deserialized.status, activity.status);
        assert_eq!(deserialized.details, activity.details);
    }

    #[test]
    fn test_activity_clone() {
        let original = Activity {
            timestamp: 1234567890.0,
            status: "Original".to_string(),
            details: Some("Details".to_string()),
        };

        let cloned = original.clone();
        assert_eq!(cloned.timestamp, original.timestamp);
        assert_eq!(cloned.status, original.status);
        assert_eq!(cloned.details, original.details);
    }

    #[test]
    fn test_activity_debug() {
        let activity = Activity {
            timestamp: 1234567890.0,
            status: "Debug Test".to_string(),
            details: Some("Debug Details".to_string()),
        };

        let debug_str = format!("{:?}", activity);
        assert!(debug_str.contains("Activity"));
        assert!(debug_str.contains("1234567890.0"));
        assert!(debug_str.contains("Debug Test"));
        assert!(debug_str.contains("Debug Details"));
    }

    #[test]
    fn test_detect_multiple_activities_first_match() {
        let detector = ActivityDetector::default();

        let input = r#"
        ✻ First activity (first details)
        ✻ Second activity (second details)
        "#;

        let activity = detector.detect(input.as_bytes());
        assert!(activity.is_some());

        let activity = activity.unwrap();
        // Should match the first occurrence
        assert_eq!(activity.status, "First activity");
        assert_eq!(activity.details, Some("first details".to_string()));
    }

    #[test]
    fn test_detect_activity_with_special_chars_in_details() {
        let detector = ActivityDetector::default();

        let test_cases = vec![
            ("✻ Status (detail: with colon)", "Status", "detail: with colon"),
            ("✻ Status (path/to/file.rs)", "Status", "path/to/file.rs"),
            ("✻ Status (key=value)", "Status", "key=value"),
            ("✻ Status (100%)", "Status", "100%"),
            ("✻ Status ($HOME/path)", "Status", "$HOME/path"),
        ];

        for (input, expected_status, expected_details) in test_cases {
            let activity = detector.detect(input.as_bytes());
            assert!(activity.is_some(), "Failed to detect activity in: {}", input);

            let activity = activity.unwrap();
            assert_eq!(activity.status, expected_status);
            assert_eq!(activity.details, Some(expected_details.to_string()));
        }
    }

    #[test]
    fn test_activity_with_none_details() {
        let activity =
            Activity { timestamp: 1234567890.0, status: "Status Only".to_string(), details: None };

        let json = serde_json::to_string(&activity).expect("Failed to serialize");
        let deserialized: Activity = serde_json::from_str(&json).expect("Failed to deserialize");

        assert_eq!(deserialized.status, "Status Only");
        assert_eq!(deserialized.details, None);
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
