use std::fmt;

/// Backend server errors
#[derive(Debug)]
pub enum BackendError {
    /// Server executable not found
    ExecutableNotFound(String),
    /// Failed to spawn process
    SpawnFailed(std::io::Error),
    /// Server crashed with exit code
    ServerCrashed(i32),
    /// Port already in use
    PortInUse(u16),
    /// Authentication failed
    AuthenticationFailed,
    /// Invalid configuration
    InvalidConfig(String),
    /// Timeout waiting for server to start
    StartupTimeout,
    /// Network error
    NetworkError(String),
    /// Generic error with message
    Other(String),
}

impl fmt::Display for BackendError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ExecutableNotFound(path) => {
                write!(f, "vibetunnel executable not found at: {path}")
            }
            Self::SpawnFailed(err) => {
                write!(f, "Failed to spawn server process: {err}")
            }
            Self::ServerCrashed(code) => {
                write!(f, "Server crashed with exit code: {code}")
            }
            Self::PortInUse(port) => {
                write!(f, "Port {port} is already in use")
            }
            Self::AuthenticationFailed => {
                write!(f, "Authentication failed")
            }
            Self::InvalidConfig(msg) => {
                write!(f, "Invalid configuration: {msg}")
            }
            Self::StartupTimeout => {
                write!(f, "Server failed to start within timeout period")
            }
            Self::NetworkError(msg) => {
                write!(f, "Network error: {msg}")
            }
            Self::Other(msg) => {
                write!(f, "{msg}")
            }
        }
    }
}

impl std::error::Error for BackendError {}

impl From<std::io::Error> for BackendError {
    fn from(err: std::io::Error) -> Self {
        Self::SpawnFailed(err)
    }
}

/// Convert `BackendError` to a user-friendly error message
impl BackendError {
    pub fn user_message(&self) -> String {
        match self {
            Self::ExecutableNotFound(_) => {
                "The VibeTunnel server executable was not found. Please reinstall the application.".to_string()
            }
            Self::SpawnFailed(_) => {
                "Failed to start the server process. Please check your system permissions.".to_string()
            }
            Self::ServerCrashed(code) => {
                match code {
                    9 => "The server port is already in use. Please choose a different port in settings.".to_string(),
                    127 => "Server executable or dependencies are missing. Please reinstall the application.".to_string(),
                    _ => format!("The server crashed unexpectedly (code {code}). Check the logs for details.")
                }
            }
            Self::PortInUse(port) => {
                format!("Port {port} is already in use. Please choose a different port in settings.")
            }
            Self::AuthenticationFailed => {
                "Authentication failed. Please check your credentials.".to_string()
            }
            Self::InvalidConfig(msg) => {
                format!("Invalid configuration: {msg}")
            }
            Self::StartupTimeout => {
                "The server took too long to start. Please try again.".to_string()
            }
            Self::NetworkError(_) => {
                "Network error occurred. Please check your connection.".to_string()
            }
            Self::Other(msg) => msg.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_display_trait() {
        // Test ExecutableNotFound
        let err = BackendError::ExecutableNotFound("/path/to/exe".to_string());
        assert_eq!(
            format!("{}", err),
            "vibetunnel executable not found at: /path/to/exe"
        );

        // Test SpawnFailed
        let io_err = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "Permission denied");
        let err = BackendError::SpawnFailed(io_err);
        assert!(format!("{}", err).contains("Failed to spawn server process"));

        // Test ServerCrashed
        let err = BackendError::ServerCrashed(42);
        assert_eq!(format!("{}", err), "Server crashed with exit code: 42");

        // Test PortInUse
        let err = BackendError::PortInUse(8080);
        assert_eq!(format!("{}", err), "Port 8080 is already in use");

        // Test AuthenticationFailed
        let err = BackendError::AuthenticationFailed;
        assert_eq!(format!("{}", err), "Authentication failed");

        // Test InvalidConfig
        let err = BackendError::InvalidConfig("missing field".to_string());
        assert_eq!(format!("{}", err), "Invalid configuration: missing field");

        // Test StartupTimeout
        let err = BackendError::StartupTimeout;
        assert_eq!(
            format!("{}", err),
            "Server failed to start within timeout period"
        );

        // Test NetworkError
        let err = BackendError::NetworkError("connection refused".to_string());
        assert_eq!(format!("{}", err), "Network error: connection refused");

        // Test Other
        let err = BackendError::Other("Custom error message".to_string());
        assert_eq!(format!("{}", err), "Custom error message");
    }

    #[test]
    fn test_user_message() {
        // Test ExecutableNotFound
        let err = BackendError::ExecutableNotFound("/some/path".to_string());
        assert_eq!(
            err.user_message(),
            "The VibeTunnel server executable was not found. Please reinstall the application."
        );

        // Test SpawnFailed
        let io_err = std::io::Error::new(std::io::ErrorKind::Other, "test");
        let err = BackendError::SpawnFailed(io_err);
        assert_eq!(
            err.user_message(),
            "Failed to start the server process. Please check your system permissions."
        );

        // Test ServerCrashed with special exit codes
        let err = BackendError::ServerCrashed(9);
        assert_eq!(
            err.user_message(),
            "The server port is already in use. Please choose a different port in settings."
        );

        let err = BackendError::ServerCrashed(127);
        assert_eq!(
            err.user_message(),
            "Server executable or dependencies are missing. Please reinstall the application."
        );

        let err = BackendError::ServerCrashed(1);
        assert_eq!(
            err.user_message(),
            "The server crashed unexpectedly (code 1). Check the logs for details."
        );

        // Test PortInUse
        let err = BackendError::PortInUse(3000);
        assert_eq!(
            err.user_message(),
            "Port 3000 is already in use. Please choose a different port in settings."
        );

        // Test AuthenticationFailed
        let err = BackendError::AuthenticationFailed;
        assert_eq!(
            err.user_message(),
            "Authentication failed. Please check your credentials."
        );

        // Test InvalidConfig
        let err = BackendError::InvalidConfig("port out of range".to_string());
        assert_eq!(
            err.user_message(),
            "Invalid configuration: port out of range"
        );

        // Test StartupTimeout
        let err = BackendError::StartupTimeout;
        assert_eq!(
            err.user_message(),
            "The server took too long to start. Please try again."
        );

        // Test NetworkError
        let err = BackendError::NetworkError("DNS resolution failed".to_string());
        assert_eq!(
            err.user_message(),
            "Network error occurred. Please check your connection."
        );

        // Test Other
        let err = BackendError::Other("Something went wrong".to_string());
        assert_eq!(err.user_message(), "Something went wrong");
    }

    #[test]
    fn test_from_io_error() {
        let io_error = std::io::Error::new(std::io::ErrorKind::NotFound, "file not found");
        let backend_error: BackendError = io_error.into();

        match backend_error {
            BackendError::SpawnFailed(err) => {
                assert_eq!(err.kind(), std::io::ErrorKind::NotFound);
            }
            _ => panic!("Expected SpawnFailed variant"),
        }
    }

    #[test]
    fn test_error_trait_impl() {
        // Verify BackendError implements std::error::Error
        fn assert_error<E: std::error::Error>() {}
        assert_error::<BackendError>();
    }

    #[test]
    fn test_debug_trait() {
        let err = BackendError::PortInUse(8080);
        let debug_str = format!("{:?}", err);
        assert!(debug_str.contains("PortInUse"));
        assert!(debug_str.contains("8080"));
    }

    #[test]
    fn test_all_variants_have_user_messages() {
        // Create one instance of each variant to ensure they all have user messages
        let errors = vec![
            BackendError::ExecutableNotFound("test".to_string()),
            BackendError::SpawnFailed(std::io::Error::new(std::io::ErrorKind::Other, "test")),
            BackendError::ServerCrashed(1),
            BackendError::PortInUse(8080),
            BackendError::AuthenticationFailed,
            BackendError::InvalidConfig("test".to_string()),
            BackendError::StartupTimeout,
            BackendError::NetworkError("test".to_string()),
            BackendError::Other("test".to_string()),
        ];

        for err in errors {
            // Ensure user_message() doesn't panic and returns a non-empty string
            let msg = err.user_message();
            assert!(!msg.is_empty());
        }
    }

    #[test]
    fn test_special_exit_codes() {
        // Test all special exit codes in ServerCrashed
        let special_codes = vec![
            (9, "already in use"),
            (127, "executable or dependencies are missing"),
        ];

        for (code, expected_substr) in special_codes {
            let err = BackendError::ServerCrashed(code);
            let msg = err.user_message();
            assert!(
                msg.contains(expected_substr),
                "Exit code {} should produce message containing '{}', got: '{}'",
                code,
                expected_substr,
                msg
            );
        }

        // Test non-special exit code
        let err = BackendError::ServerCrashed(42);
        let msg = err.user_message();
        assert!(msg.contains("crashed unexpectedly"));
        assert!(msg.contains("42"));
    }

    #[test]
    fn test_error_messages_are_helpful() {
        // Ensure all user messages provide actionable guidance
        let err = BackendError::ExecutableNotFound("path".to_string());
        assert!(err.user_message().contains("reinstall"));

        let err = BackendError::SpawnFailed(std::io::Error::new(std::io::ErrorKind::Other, ""));
        assert!(err.user_message().contains("permissions"));

        let err = BackendError::PortInUse(8080);
        assert!(err.user_message().contains("different port"));

        let err = BackendError::AuthenticationFailed;
        assert!(err.user_message().contains("credentials"));

        let err = BackendError::StartupTimeout;
        assert!(err.user_message().contains("try again"));
    }
}
